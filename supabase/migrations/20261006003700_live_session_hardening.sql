-- =============================================================================
-- D-19 : corrections de la revue de sécurité du contrôle de session
-- =============================================================================
--   - une session dont la date de fin est passée n'est plus tenue pour ouverte ;
--   - `my_report_ids` applique la règle entière du compte actif (suspension,
--     second facteur, session), comme `my_submission_ids` ;
--   - `must_keep_second_factor` ne répond plus à une session fermée : elle
--     disait encore si le compte détient un rôle.
--
-- `second_factor_status` répond toujours : elle sert à la session qui n'a pas
-- encore présenté son second facteur, et ne dit que l'état de son propre compte.
--
-- Réversibilité : rétablir les fonctions des migrations 003600 et 001400.
-- =============================================================================

create or replace function private.is_session_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when ((select auth.jwt()) ->> 'session_id') is null then true
    when ((select auth.jwt()) ->> 'session_id')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else exists (
      select 1
      from auth.sessions s
      where s.id = ((select auth.jwt()) ->> 'session_id')::uuid
        and s.user_id = (select auth.uid())
        and (s.not_after is null or s.not_after > now())
    )
  end;
$$;

create or replace function private.my_report_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.id
  from public.resource_reports x
  where x.reporter_id = (select auth.uid())
    and private.is_account_active();
$$;

create or replace function private.must_keep_second_factor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_session_live()
    and (
      exists (
        select 1 from public.platform_roles r where r.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.organization_members m
        where m.user_id = (select auth.uid()) and m.role = 'org_admin'
      )
    );
$$;
