-- =============================================================================
-- D-01, D-02, D-16 : administration des rôles et des comptes
-- =============================================================================
-- Jusqu'ici, un rôle s'attribuait à la main, en base. Les opérations
-- d'administration passent désormais par des fonctions exécutées sous la
-- session de l'administrateur (modèle d'autorisation §5.6) :
--
--   - rôle de l'appelant vérifié en base, second facteur présenté (aal2) ;
--   - second facteur présenté récemment : dix minutes au plus ;
--   - personne n'agit sur son propre compte ;
--   - un rôle ne s'attribue qu'à un compte qui a déjà un second facteur vérifié ;
--   - `super_admin` ne s'attribue, ne se retire et ne se suspend pas par
--     l'application ;
--   - chaque opération est journalisée, y compris la recherche d'un compte.
--
-- Le rôle serveur perd l'écriture sur `platform_roles` : plus aucun chemin
-- applicatif n'attribue un rôle hors de ces fonctions.
--
-- Réversibilité : supprimer les fonctions ; rendre insert, update et delete
-- sur platform_roles à service_role ; rétablir account_deletion_check (000800).
-- =============================================================================

revoke insert, update, delete on public.platform_roles from service_role;

-- Le second facteur a-t-il été présenté dans les dix dernières minutes ?
create function private.has_recent_second_factor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_session_aal2()
    and coalesce((
      select max((entry ->> 'timestamp')::bigint)
      from jsonb_array_elements(
        case when jsonb_typeof((select auth.jwt()) -> 'amr') = 'array'
             then (select auth.jwt()) -> 'amr' else '[]'::jsonb end
      ) as entry
      where entry ->> 'method' in ('totp', 'mfa/totp')
        and (entry ->> 'timestamp') ~ '^\d{9,11}$'
    ), 0) > extract(epoch from now())::bigint - 600;
$$;
revoke all on function private.has_recent_second_factor() from public, anon, authenticated, service_role;
grant execute on function private.has_recent_second_factor() to authenticated;

-- Rang du rôle le plus élevé d'un compte : 0 aucun, 1 modération, 2
-- administration, 3 super-administration.
create function private.highest_role_rank(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(case r.role
    when 'super_admin' then 3 when 'platform_admin' then 2 when 'moderator' then 1 else 0 end), 0)
  from public.platform_roles r
  where r.user_id = p_user;
$$;
revoke all on function private.highest_role_rank(uuid) from public, anon, authenticated, service_role;

-- Contrôle commun : administrateur actif, second facteur récent. Renvoie le
-- rang de l'appelant (2 ou 3).
create function private.require_admin()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer;
begin
  if private.has_platform_role(array['super_admin']) then
    v_rank := 3;
  elsif private.has_platform_role(array['platform_admin']) then
    v_rank := 2;
  else
    perform private.fail('forbidden', '42501');
  end if;
  if not private.has_recent_second_factor() then
    perform private.fail('recent_second_factor_required', '42501');
  end if;
  return v_rank;
end
$$;
revoke all on function private.require_admin() from public, anon, authenticated, service_role;

-- État de la session d'administration, pour l'écran : rôle le plus élevé de
-- l'appelant et fraîcheur de son second facteur.
create function private.admin_session()
returns table (role_rank integer, recent boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when private.has_platform_role(array['super_admin']) then 3
      when private.has_platform_role(array['platform_admin']) then 2
      else 0
    end,
    private.has_recent_second_factor();
$$;

-- Recherche d'un compte par son adresse exacte. Pas de liste des comptes, pas
-- de recherche partielle. La recherche est journalisée, sans l'adresse.
create function private.admin_find_user(p_email text)
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
  v_user uuid;
begin
  perform private.require_admin();
  if char_length(v_email) not between 3 and 320 then
    perform private.fail('invalid_payload', '22023');
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email limit 1;
  perform private.write_audit(
    'platform', 'user.lookup', (select auth.uid()), v_user, null, 'account',
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

-- Comptes détenant un rôle, et comptes suspendus : listes courtes, que
-- l'administration doit pouvoir relire.
create function private.admin_list_accounts()
returns table (user_id uuid, email text, roles text[], suspended boolean, suspension_reason text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select u.id, u.email::text,
         coalesce((select array_agg(r.role order by r.role) from public.platform_roles r where r.user_id = u.id), '{}'),
         coalesce(s.status = 'suspended', false),
         case when s.status = 'suspended' then s.reason end
  from auth.users u
  left join private.account_status s on s.user_id = u.id
  where exists (select 1 from public.platform_roles r where r.user_id = u.id)
     or s.status = 'suspended'
  order by u.email
  limit 500;
end
$$;

-- Attribue ou retire un rôle. `p_grant` : vrai pour attribuer.
create function private.admin_set_role(p_user uuid, p_role text, p_grant boolean)
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
  perform 1 from auth.users u where u.id = p_user for share;
  if not found then
    perform private.fail('not_found');
  end if;

  if not p_grant then
    delete from public.platform_roles r where r.user_id = p_user and r.role = p_role;
    return;
  end if;

  if exists (select 1 from private.account_status s where s.user_id = p_user and s.status = 'suspended') then
    perform private.fail('account_suspended', '42501');
  end if;
  -- Un rôle sans second facteur serait sans effet : il n'est pas attribué.
  if not exists (
    select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified'
  ) then
    perform private.fail('second_factor_missing', '42501');
  end if;

  insert into public.platform_roles (user_id, role, granted_by)
  values (p_user, p_role, v_uid)
  on conflict (user_id, role) do nothing;
end
$$;

-- Suspend ou rétablit un compte.
create function private.admin_set_account_status(p_user uuid, p_suspended boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer := private.require_admin();
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_user is null or p_suspended is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p_user = v_uid then
    perform private.fail('own_account', '42501');
  end if;
  perform 1 from auth.users u where u.id = p_user for share;
  if not found then
    perform private.fail('not_found');
  end if;
  -- On n'agit que sur un compte de rang strictement inférieur au sien.
  if private.highest_role_rank(p_user) >= v_rank then
    perform private.fail('forbidden', '42501');
  end if;
  if p_suspended and v_reason is null then
    perform private.fail('reason_required', '22023');
  end if;
  if v_reason is not null and not private.is_clean_long_text(v_reason, 500) then
    perform private.fail('invalid_payload', '22023');
  end if;

  insert into private.account_status (user_id, status, reason, changed_by, changed_at)
  values (p_user, case when p_suspended then 'suspended' else 'active' end,
          case when p_suspended then v_reason end, v_uid, now())
  on conflict (user_id) do update
    set status = excluded.status, reason = excluded.reason,
        changed_by = excluded.changed_by, changed_at = excluded.changed_at;
end
$$;

-- D-16 : le dernier super-administrateur ne supprime pas son compte.
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
     and not exists (
       select 1 from public.platform_roles r where r.role = 'super_admin' and r.user_id <> v_uid
     ) then
    return 'last_super_admin';
  end if;

  perform private.write_audit(
    'security', 'account.deletion_requested', v_uid, v_uid, null,
    'profiles', v_uid::text, '{}'::jsonb
  );
  return 'ok';
end
$$;

-- Enveloppes exposées par l'API.
create function public.admin_session()
returns table (role_rank integer, recent boolean)
language sql security invoker set search_path = ''
as $$ select * from private.admin_session(); $$;

create function public.admin_find_user(email text)
returns table (
  user_id uuid, email text, created_at timestamptz, confirmed boolean,
  roles text[], suspended boolean, suspension_reason text, has_second_factor boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.admin_find_user(email); $$;

create function public.admin_list_accounts()
returns table (user_id uuid, email text, roles text[], suspended boolean, suspension_reason text)
language sql security invoker set search_path = ''
as $$ select * from private.admin_list_accounts(); $$;

create function public.admin_set_role(target_user uuid, role text, grant_role boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.admin_set_role(target_user, role, grant_role); $$;

create function public.admin_set_account_status(target_user uuid, suspended boolean, reason text default null)
returns void
language sql security invoker set search_path = ''
as $$ select private.admin_set_account_status(target_user, suspended, reason); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'admin_session()',
    'admin_find_user(text)',
    'admin_list_accounts()',
    'admin_set_role(uuid, text, boolean)',
    'admin_set_account_status(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
