-- =============================================================================
-- D-01, D-02, D-16 : corrections de la revue de sécurité de l'administration
-- =============================================================================
-- 1. Rétablissement : une suspension décidée par un rang supérieur ne se lève
--    pas par un rang inférieur.
-- 2. Pas d'opération sans trace : suspendre un compte déjà suspendu, ou rétablir
--    un compte actif, est refusé — le motif et l'auteur d'origine ne s'écrasent pas.
-- 3. Limites tenues en base : recherches et suspensions par administrateur.
-- 4. Retrait d'un rôle : seulement à un compte de rang strictement inférieur.
-- 5. Attribution et suspension d'un même compte passent une par une.
-- 6. Dernier super-administrateur : la garde est aussi un déclencheur, et ne
--    compte que les super-administrateurs effectifs.
-- 7. Réattribuer un rôle le renouvelle (date et auteur).
--
-- Réversibilité : rétablir les définitions de la migration 002800 ; supprimer
-- le déclencheur, sa fonction et la colonne.
-- =============================================================================

alter table private.account_status
  add column suspended_by_rank smallint
    constraint account_status_suspended_by_rank_check
      check (suspended_by_rank is null or suspended_by_rank between 2 and 3);

comment on column private.account_status.suspended_by_rank is
  'Rang de l''administrateur qui a suspendu le compte. Un rang inférieur ne rétablit pas.';

-- Super-administrateurs effectifs : non suspendus, second facteur antérieur au rôle.
create function private.effective_super_admin_count(p_except uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.platform_roles r
  where r.role = 'super_admin'
    and r.user_id is distinct from p_except
    and not exists (
      select 1 from private.account_status s where s.user_id = r.user_id and s.status = 'suspended'
    )
    and exists (
      select 1 from auth.mfa_factors f
      where f.user_id = r.user_id and f.status = 'verified' and f.created_at <= r.granted_at
    );
$$;
revoke all on function private.effective_super_admin_count(uuid) from public, anon, authenticated, service_role;

-- Le dernier super-administrateur effectif ne disparaît pas, quel que soit le
-- chemin : retrait du rôle ou suppression du compte en cascade. Seule une
-- session directe du propriétaire de la base (maintenance, procédure à deux
-- personnes) passe outre.
create function private.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'super_admin' and session_user <> 'postgres' then
    perform pg_advisory_xact_lock(hashtextextended('last_super_admin', 0));
    if private.effective_super_admin_count(old.user_id) = 0 then
      raise exception 'last_super_admin' using errcode = '23514';
    end if;
  end if;
  return old;
end
$$;
revoke all on function private.protect_last_super_admin() from public, anon, authenticated, service_role;

create trigger platform_roles_protect_last_super_admin
  before delete on public.platform_roles
  for each row execute function private.protect_last_super_admin();

create or replace function private.account_deletion_check()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_account_active() then
    return 'forbidden';
  end if;

  if exists (
    select 1
    from public.organization_members m
    where m.user_id = v_uid
      and m.role = 'org_admin'
      and not exists (
        select 1
        from public.organization_members o
        where o.organization_id = m.organization_id
          and o.role = 'org_admin'
          and o.user_id <> v_uid
      )
  ) then
    return 'last_org_admin';
  end if;

  if exists (select 1 from public.platform_roles r where r.user_id = v_uid and r.role = 'super_admin')
     and private.effective_super_admin_count(v_uid) = 0 then
    return 'last_super_admin';
  end if;

  perform private.write_audit(
    'security', 'account.deletion_requested', v_uid, v_uid, null,
    'profiles', v_uid::text, '{}'::jsonb
  );
  return 'ok';
end
$$;

create or replace function private.admin_find_user(p_email text)
returns table (
  user_id uuid, email text, created_at timestamptz, confirmed boolean,
  roles text[], suspended boolean, suspension_reason text, has_second_factor boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid := (select auth.uid());
  v_user uuid;
  v_matches integer;
begin
  perform private.require_admin();
  if char_length(v_email) not between 3 and 320 then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Soixante recherches par quart d'heure et par administrateur, comptées en
  -- base : un appel direct à l'API n'y échappe pas.
  perform pg_advisory_xact_lock(hashtextextended('admin_lookup:' || v_uid::text, 0));
  if (
    select count(*) from public.audit_logs a
    where a.actor_id = v_uid and a.action = 'user.lookup'
      and a.occurred_at > now() - interval '15 minutes'
  ) >= 60 then
    perform private.fail('rate_limited');
  end if;

  select count(*), min(u.id::text)::uuid into v_matches, v_user
  from auth.users u
  where lower(u.email) = v_email and not coalesce(u.is_sso_user, false);
  -- Deux comptes de même adresse : aucun n'est rendu, pour ne pas agir sur le mauvais.
  if v_matches > 1 then
    v_user := null;
  end if;

  perform private.write_audit(
    'platform', 'user.lookup', v_uid, v_user, null, 'account',
    coalesce(v_user::text, 'unknown'), jsonb_build_object('found', v_user is not null)
  );
  if v_user is null then
    return;
  end if;

  return query
  select u.id, u.email::text, u.created_at, u.email_confirmed_at is not null,
         coalesce((select array_agg(r.role order by r.role) from public.platform_roles r where r.user_id = u.id), '{}'),
         exists (select 1 from private.account_status s where s.user_id = u.id and s.status = 'suspended'),
         (select s.reason from private.account_status s where s.user_id = u.id and s.status = 'suspended'),
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
  from auth.users u
  where u.id = v_user;
end
$$;

create or replace function private.admin_set_role(p_user uuid, p_role text, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer := private.require_admin();
  v_uid uuid := (select auth.uid());
begin
  if p_user is null or p_grant is null or p_role is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- `super_admin` ne se gère pas par l'application ; `platform_admin` est
  -- réservé au super-administrateur.
  if p_role not in ('moderator', 'platform_admin')
     or (p_role = 'platform_admin' and v_rank < 3) then
    perform private.fail('forbidden', '42501');
  end if;
  if p_user = v_uid then
    perform private.fail('own_account', '42501');
  end if;

  -- Attribution, retrait et suspension d'un même compte passent une par une.
  perform pg_advisory_xact_lock(hashtextextended('admin:' || p_user::text, 0));
  perform 1 from auth.users u where u.id = p_user;
  if not found then
    perform private.fail('not_found');
  end if;

  if not p_grant then
    -- On ne retire un rôle qu'à un compte de rang strictement inférieur au sien.
    if private.highest_role_rank(p_user) >= v_rank then
      perform private.fail('forbidden', '42501');
    end if;
    delete from public.platform_roles r where r.user_id = p_user and r.role = p_role;
    return;
  end if;

  if exists (select 1 from private.account_status s where s.user_id = p_user and s.status = 'suspended') then
    perform private.fail('account_suspended', '42501');
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    perform private.fail('forbidden', '42501');
  end if;
  -- Un rôle sans second facteur serait sans effet : il n'est pas attribué.
  if not exists (
    select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified'
  ) then
    perform private.fail('second_factor_missing', '42501');
  end if;

  -- Réattribuer renouvelle la date : un rôle devenu sans effet (second facteur
  -- remplacé depuis) redevient effectif par un acte explicite et journalisé.
  insert into public.platform_roles (user_id, role, granted_by)
  values (p_user, p_role, v_uid)
  on conflict (user_id, role) do update
    set granted_by = excluded.granted_by, granted_at = now();
end
$$;

create or replace function private.admin_set_account_status(p_user uuid, p_suspended boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer := private.require_admin();
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current private.account_status;
begin
  if p_user is null or p_suspended is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p_user = v_uid then
    perform private.fail('own_account', '42501');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin:' || p_user::text, 0));
  perform 1 from auth.users u where u.id = p_user;
  if not found then
    perform private.fail('not_found');
  end if;
  -- On n'agit que sur un compte de rang strictement inférieur au sien.
  if private.highest_role_rank(p_user) >= v_rank then
    perform private.fail('forbidden', '42501');
  end if;

  select * into v_current from private.account_status s where s.user_id = p_user;

  if p_suspended then
    -- Déjà suspendu : le motif et l'auteur d'origine ne s'écrasent pas.
    if v_current.status = 'suspended' then
      perform private.fail('invalid_transition', '22023');
    end if;
    if v_reason is null then
      perform private.fail('reason_required', '22023');
    end if;
    if not private.is_clean_long_text(v_reason, 500) then
      perform private.fail('invalid_payload', '22023');
    end if;

    -- Trente suspensions par heure et par administrateur.
    perform pg_advisory_xact_lock(hashtextextended('admin_suspend:' || v_uid::text, 0));
    if (
      select count(*) from private.account_status s
      where s.changed_by = v_uid and s.status = 'suspended' and s.changed_at > now() - interval '1 hour'
    ) >= 30 then
      perform private.fail('rate_limited');
    end if;

    insert into private.account_status (user_id, status, reason, changed_by, changed_at, suspended_by_rank)
    values (p_user, 'suspended', v_reason, v_uid, now(), v_rank)
    on conflict (user_id) do update
      set status = excluded.status, reason = excluded.reason, changed_by = excluded.changed_by,
          changed_at = excluded.changed_at, suspended_by_rank = excluded.suspended_by_rank;
    return;
  end if;

  if v_current.status is distinct from 'suspended' then
    perform private.fail('invalid_transition', '22023');
  end if;
  -- Une suspension décidée par un rang supérieur ne se lève pas par un rang inférieur.
  if coalesce(v_current.suspended_by_rank, 3) > v_rank then
    perform private.fail('forbidden', '42501');
  end if;

  update private.account_status s
  set status = 'active', reason = null, changed_by = v_uid, changed_at = now(), suspended_by_rank = null
  where s.user_id = p_user;
end
$$;
