-- =============================================================================
-- Second facteur d'authentification (modèle de menaces M-48, dette D-02)
--
-- Un compte qui a activé un second facteur ne dispose de ses droits que dans
-- une session où ce facteur a été vérifié (aal2). Sans cette règle, le second
-- facteur ne protégerait que l'application : un appel direct à l'API avec une
-- session ouverte par le seul mot de passe passerait.
--
-- Les rôles privilégiés exigeaient déjà aal2 (has_platform_role, has_org_role).
-- La règle est étendue à tout compte qui a un facteur vérifié.
--
-- Réversibilité : recréer private.is_account_active() dans sa version de la
-- migration 20261006000200.
-- =============================================================================

create function private.has_verified_factor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.mfa_factors f
    where f.user_id = (select auth.uid())
      and f.status = 'verified'
  );
$$;
revoke all on function private.has_verified_factor() from public, anon;
grant execute on function private.has_verified_factor() to authenticated;

create or replace function private.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and not exists (
      select 1
      from private.account_status s
      where s.user_id = (select auth.uid())
        and s.status = 'suspended'
    )
    -- Second facteur activé : la session doit l'avoir vérifié.
    and (private.is_session_aal2() or not private.has_verified_factor());
$$;

-- État du second facteur pour l'utilisateur courant, lisible même en session
-- aal1 : l'application s'en sert pour demander le code.
create function public.second_factor_status()
returns table (has_verified_factor boolean, session_verified boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_verified_factor(), private.is_session_aal2();
$$;
revoke all on function public.second_factor_status() from public, anon;
grant execute on function public.second_factor_status() to authenticated;
