-- =============================================================================
-- D-19 : une session fermée cesse d'agir immédiatement
-- =============================================================================
-- Un jeton d'accès reste valable dix minutes après son émission, même si la
-- session dont il vient a été fermée entre-temps (déconnexion, changement de
-- mot de passe, refus d'un code, usage d'un code de secours). L'application le refusait déjà — elle interroge le service
-- d'authentification à chaque requête —, mais pas la base : pendant ces dix
-- minutes, le jeton permettait encore de lire et d'écrire par appel direct.
--
-- La base vérifie désormais que la session nommée par le jeton existe encore.
-- Le contrôle est placé dans `private.is_account_active()`, que citent toutes
-- les politiques de lecture et toutes les fonctions d'écriture : il vaut
-- partout, pas seulement pour quelques opérations choisies.
--
-- Un jeton sans identifiant de session n'est pas refusé par ce contrôle : le
-- service d'authentification n'en émet pas pour un utilisateur, et qui pourrait
-- en forger un détiendrait la clé de signature — donc tous les rôles.
--
-- Réversibilité : rétablir `is_account_active` (migration 000900),
-- `my_report_ids` (002700) et `redeem_recovery_code` (003100), puis supprimer
-- `private.is_session_live`.
-- =============================================================================

create function private.is_session_live()
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
    )
  end;
$$;

revoke all on function private.is_session_live() from public, anon, authenticated, service_role;

comment on function private.is_session_live() is
  'Vrai si la session nommée par le jeton existe encore. Appelée par is_account_active.';

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
    and (private.is_session_aal2() or not private.has_verified_factor())
    -- La session du jeton n'a pas été fermée depuis son émission.
    and private.is_session_live();
$$;

-- Ses propres signalements : même règle.
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
    and private.is_session_live();
$$;

-- Lever le second facteur par un code de secours : la fonction ne passe pas
-- par is_account_active (elle s'adresse à une session qui n'a pas présenté le
-- second facteur) ; le contrôle y est donc écrit.
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
     or private.is_session_aal2()
     -- Une session fermée ne lève pas le second facteur (D-19).
     or not private.is_session_live() then
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
