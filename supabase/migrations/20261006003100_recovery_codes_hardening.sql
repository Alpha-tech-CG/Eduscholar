-- =============================================================================
-- D-17 : corrections de la revue de sécurité des codes de secours
-- =============================================================================
-- 1. Codes de seize signes (quatre-vingts bits) : hors de portée d'une attaque
--    hors ligne si la table venait à fuir.
-- 2. Chaque code est lié au second facteur pour lequel il a été généré : un
--    facteur retiré ou remplacé emporte ses codes, sans dépendre d'un appel de
--    l'application.
-- 3. Un code ne s'utilise que dans la session ouverte par le mot de passe : une
--    session qui a présenté le second facteur dispose de la désactivation normale.
-- 4. Le dernier super-administrateur effectif n'utilise pas de code de secours :
--    la plateforme ne reste jamais sans super-administrateur.
-- 5. Rôle d'administrateur d'organisation : comme pour les rôles de plateforme,
--    le second facteur doit être antérieur à l'attribution du rôle. Un facteur
--    recréé après une levée ne rend pas le rôle.
-- 6. Journal : blocage après cinq essais erronés, abandon de codes.
--
-- Réversibilité : rétablir les définitions des migrations 001400 et 003000 ;
-- supprimer les colonnes et le déclencheur.
-- =============================================================================

-- Les codes existants, de dix signes, ne sont pas liés à un facteur : ils sont
-- retirés. Leurs titulaires en génèrent de nouveaux.
delete from private.second_factor_recovery_codes;

alter table private.second_factor_recovery_codes
  add column factor_id uuid not null;
comment on column private.second_factor_recovery_codes.factor_id is
  'Second facteur pour lequel le code a été généré. Sans clé étrangère : le schéma auth n''appartient pas à l''application.';

-- Date d'attribution du rôle dans une organisation.
alter table public.organization_members
  add column role_granted_at timestamptz not null default now();
update public.organization_members set role_granted_at = created_at;

create function private.touch_role_granted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    new.role_granted_at := now();
  end if;
  return new;
end
$$;
revoke all on function private.touch_role_granted_at() from public, anon, authenticated, service_role;

create trigger organization_members_touch_role_granted_at
  before update on public.organization_members
  for each row execute function private.touch_role_granted_at();

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active()
    and exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and m.role = any (p_roles)
        and o.status <> 'suspended'
        and (m.role <> 'org_admin'
             or (private.is_session_aal2()
                 and exists (
                   select 1 from auth.mfa_factors f
                   where f.user_id = m.user_id and f.status = 'verified'
                     and f.created_at <= m.role_granted_at
                 )))
    );
$$;

create or replace function private.my_org_ids(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.role = any (p_roles)
    and o.status <> 'suspended'
    and (m.role <> 'org_admin'
         or (private.is_session_aal2()
             and exists (
               select 1 from auth.mfa_factors f
               where f.user_id = m.user_id and f.status = 'verified'
                 and f.created_at <= m.role_granted_at
             )))
    and private.is_account_active();
$$;

-- Seuls comptent les codes du second facteur encore en place.
create or replace function private.recovery_codes_status()
returns table (remaining integer, generated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where c.used_at is null)::integer, max(c.created_at)
  from private.second_factor_recovery_codes c
  where c.user_id = (select auth.uid())
    and private.is_account_active()
    and exists (
      select 1 from auth.mfa_factors f
      where f.id = c.factor_id and f.user_id = c.user_id and f.status = 'verified'
    );
$$;

drop function public.generate_recovery_codes();
drop function private.generate_recovery_codes();

create function private.generate_recovery_codes()
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  -- Trente-deux signes sans ambiguïté de lecture : ni I, ni O, ni 0, ni 1.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_factor uuid;
  v_bytes bytea;
  v_code text;
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select f.id into v_factor
  from auth.mfa_factors f
  where f.user_id = v_uid and f.status = 'verified'
  order by f.created_at desc
  limit 1;
  if v_factor is null then
    perform private.fail('forbidden', '42501');
  end if;
  if not private.has_recent_second_factor() then
    perform private.fail('recent_second_factor_required', '42501');
  end if;

  delete from private.second_factor_recovery_codes c where c.user_id = v_uid;
  delete from private.recovery_code_attempts a where a.user_id = v_uid;

  for v_index in 1 .. 10 loop
    -- Seize signes tirés au hasard : quatre-vingts bits par code.
    v_bytes := extensions.gen_random_bytes(16);
    v_code := '';
    for v_position in 0 .. 15 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_position) % 32) + 1, 1);
    end loop;
    insert into private.second_factor_recovery_codes (user_id, code_hash, factor_id)
    values (v_uid, private.recovery_code_hash(v_uid, v_code), v_factor);
    return next substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-'
      || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
  end loop;

  perform private.write_audit(
    'security', 'second_factor.recovery_codes_generated', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
  );
end
$$;

create function public.generate_recovery_codes() returns setof text
language sql security invoker set search_path = ''
as $$ select private.generate_recovery_codes(); $$;

revoke all on function private.generate_recovery_codes() from public, anon, service_role;
revoke all on function public.generate_recovery_codes() from public, anon, service_role;
grant execute on function private.generate_recovery_codes() to authenticated;
grant execute on function public.generate_recovery_codes() to authenticated;

create or replace function private.discard_recovery_codes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  delete from private.second_factor_recovery_codes c where c.user_id = v_uid;
  get diagnostics v_count = row_count;
  delete from private.recovery_code_attempts a where a.user_id = v_uid;
  if v_count > 0 then
    perform private.write_audit(
      'security', 'second_factor.recovery_codes_discarded', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
    );
  end if;
end
$$;

create or replace function private.redeem_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := private.normalize_recovery_code(p_code);
  v_attempts private.recovery_code_attempts;
  v_failures integer;
  v_id uuid;
begin
  if v_uid is null
     or ((select auth.jwt()) ->> 'is_anonymous') is not distinct from 'true'
     or exists (select 1 from private.account_status s where s.user_id = v_uid and s.status = 'suspended')
     or not private.has_verified_factor()
     -- Une session qui a présenté le second facteur le désactive par la voie
     -- normale, qui redemande un code et prévient le titulaire.
     or private.is_session_aal2() then
    perform private.fail('forbidden', '42501');
  end if;
  -- La plateforme ne reste jamais sans super-administrateur effectif.
  if exists (select 1 from public.platform_roles r where r.user_id = v_uid and r.role = 'super_admin')
     and private.effective_super_admin_count(v_uid) = 0 then
    perform private.fail('last_super_admin', '42501');
  end if;

  -- Les essais d'un même compte passent un par un.
  perform pg_advisory_xact_lock(hashtextextended('recovery_code:' || v_uid::text, 0));
  select * into v_attempts from private.recovery_code_attempts a where a.user_id = v_uid;
  if v_attempts.window_start is not null and v_attempts.window_start < now() - interval '15 minutes' then
    delete from private.recovery_code_attempts a where a.user_id = v_uid;
    v_attempts.failures := 0;
  end if;
  if coalesce(v_attempts.failures, 0) >= 5 then
    perform private.fail('rate_limited');
  end if;

  if char_length(v_code) = 16 then
    update private.second_factor_recovery_codes c
    set used_at = now()
    where c.user_id = v_uid
      and c.used_at is null
      and c.code_hash = private.recovery_code_hash(v_uid, v_code)
      -- Le code ne vaut que pour le second facteur encore en place.
      and exists (
        select 1 from auth.mfa_factors f
        where f.id = c.factor_id and f.user_id = v_uid and f.status = 'verified'
      )
    returning c.id into v_id;
  end if;

  if v_id is null then
    -- L'échec est compté : la fonction rend faux au lieu de lever une erreur,
    -- pour que le compteur soit bien enregistré.
    insert into private.recovery_code_attempts (user_id, window_start, failures)
    values (v_uid, now(), 1)
    on conflict (user_id) do update set failures = private.recovery_code_attempts.failures + 1
    returning failures into v_failures;
    if v_failures = 5 then
      perform private.write_audit(
        'security', 'second_factor.recovery_code_blocked', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
      );
    end if;
    return false;
  end if;

  delete from private.recovery_code_attempts a where a.user_id = v_uid;
  perform private.write_audit(
    'security', 'second_factor.recovery_code_used', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
  );
  return true;
end
$$;

-- Dernier usage d'un code de secours par l'appelant : l'application en avertit
-- son titulaire à l'écran, faute de pouvoir lui écrire.
create function private.last_recovery_code_use()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(a.occurred_at)
  from public.audit_logs a
  where a.action = 'second_factor.recovery_code_used'
    and a.actor_id = (select auth.uid())
    and a.occurred_at > now() - interval '30 days'
    and private.is_account_active();
$$;

create function public.last_recovery_code_use() returns timestamptz
language sql security invoker set search_path = ''
as $$ select private.last_recovery_code_use(); $$;

revoke all on function private.last_recovery_code_use() from public, anon, service_role;
revoke all on function public.last_recovery_code_use() from public, anon, service_role;
grant execute on function private.last_recovery_code_use() to authenticated;
grant execute on function public.last_recovery_code_use() to authenticated;
