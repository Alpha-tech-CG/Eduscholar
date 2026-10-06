-- =============================================================================
-- B-11 / B-12 — Durcissement après revue de sécurité
--
--  1. La complétion du profil (dont la déclaration d'âge) devient vérifiable en
--     base : private.is_onboarded(). Un compte créé par appel direct à l'API
--     d'authentification ne publie rien tant qu'il ne l'a pas faite.
--  2. La suppression d'un compte est journalisée ; une suppression en cascade
--     n'est plus attribuée à un tiers.
--  3. Le contrôle préalable à la suppression d'un compte se fait en base, sous
--     la session de l'utilisateur : compte actif, pas dernier administrateur.
--  4. Les référentiels ne sont plus lisibles par un visiteur anonyme tant
--     qu'aucune page publique n'en a besoin : c'était la seule surface de
--     requête ouverte sans compte.
--  5. Contraintes : longueur réelle du nom d'établissement, cohérence de la
--     complétion.
--
-- Réversibilité : recréer la politique profile_public_update_own et les
-- politiques *_select_anon de la migration 20261006000500 ; supprimer les
-- fonctions et le déclencheur ajoutés ici.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profil complété
-- -----------------------------------------------------------------------------
create function private.is_onboarded()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.onboarded_at is not null
  );
$$;
revoke all on function private.is_onboarded() from public, anon;
grant execute on function private.is_onboarded() to authenticated;

-- Rien ne se publie avant la complétion du profil.
drop policy profile_public_update_own on public.profile_public;
create policy profile_public_update_own on public.profile_public
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_account_active())
    and (select private.is_onboarded())
  )
  with check (user_id = (select auth.uid()));

-- La complétion suppose le profil minimal : il ne peut plus être vidé ensuite.
alter table public.profiles
  add constraint profiles_onboarded_requires_minimum check (
    onboarded_at is null
    or (country_code is not null
        and level_code is not null
        and program_code is not null
        and age_confirmed_at is not null)
  );

-- Longueur réelle bornée, sans caractère de contrôle.
alter table public.profiles
  drop constraint profiles_institution_name_check,
  add constraint profiles_institution_name_check check (
    institution_name is null
    or (char_length(institution_name) <= 200
        and char_length(btrim(institution_name)) >= 2
        and institution_name !~ '[[:cntrl:]]')
  );

-- Pas d'objectif en double. Une contrainte CHECK n'accepte pas de sous-requête :
-- le contrôle passe par une fonction immuable.
create function private.has_distinct_values(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p_values) = (select count(distinct v) from unnest(p_values) as u (v));
$$;
revoke all on function private.has_distinct_values(text[]) from public, anon;
-- La contrainte est évaluée avec les droits de l'utilisateur qui écrit.
grant execute on function private.has_distinct_values(text[]) to authenticated;

alter table public.profiles
  add constraint profiles_goals_distinct check (private.has_distinct_values(goals));

-- -----------------------------------------------------------------------------
-- 2. Journal d'audit : suppression de compte, acteur d'une suppression
-- -----------------------------------------------------------------------------
create function private.audit_account_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    'security', 'account.deleted', null, old.user_id, null,
    'profiles', old.user_id::text, '{}'::jsonb
  );
  return old;
end
$$;

create trigger profiles_audit_delete
  after delete on public.profiles
  for each row execute function private.audit_account_deleted();

-- Pour une suppression, l'acteur n'est jamais déduit de la ligne supprimée :
-- la personne qui avait invité un membre n'est pas celle qui le retire.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_metadata jsonb := '{}'::jsonb;
  v_column text;
  v_index integer;
begin
  for v_index in 1 .. tg_nargs - 1 loop
    v_column := tg_argv[v_index];
    if not (v_row ? v_column) then
      raise exception 'Colonne % absente de %.%.', v_column, tg_table_schema, tg_table_name;
    end if;
    if tg_op = 'UPDATE' then
      if v_new -> v_column is distinct from v_old -> v_column then
        v_metadata := v_metadata || jsonb_build_object(
          v_column, jsonb_build_object('old', v_old -> v_column, 'new', v_new -> v_column)
        );
      end if;
    else
      v_metadata := v_metadata || jsonb_build_object(v_column, v_row -> v_column);
    end if;
  end loop;

  if tg_op = 'UPDATE' and v_metadata = '{}'::jsonb then
    return new;
  end if;

  perform private.write_audit(
    tg_argv[0],
    tg_table_name || '.' || lower(tg_op),
    case
      when tg_op = 'DELETE' then null
      else coalesce(
        v_row ->> 'granted_by', v_row ->> 'changed_by', v_row ->> 'invited_by',
        v_row ->> 'updated_by', v_row ->> 'created_by'
      )::uuid
    end,
    (v_row ->> 'user_id')::uuid,
    coalesce(
      v_row ->> 'organization_id',
      case
        when tg_table_schema = 'public' and tg_table_name = 'organizations' then v_row ->> 'id'
      end
    )::uuid,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    v_metadata
  );

  return coalesce(new, old);
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Contrôle préalable à la suppression de son compte
-- -----------------------------------------------------------------------------
-- Appelée sous la session de l'utilisateur, avant l'opération serveur qui
-- supprime le compte. Un compte suspendu ne peut pas effacer sa suspension en
-- se supprimant ; le dernier administrateur d'une organisation doit d'abord
-- transmettre l'administration. Le déclencheur protect_last_org_admin reste la
-- barrière en cas d'accès concurrent.
create function private.account_deletion_check()
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

  perform private.write_audit(
    'security', 'account.deletion_requested', v_uid, v_uid, null,
    'profiles', v_uid::text, '{}'::jsonb
  );
  return 'ok';
end
$$;

-- Enveloppe dans le schéma exposé : SECURITY INVOKER, elle n'ajoute aucun droit.
create function public.account_deletion_check()
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.account_deletion_check();
$$;

revoke all on function private.account_deletion_check() from public, anon;
revoke all on function public.account_deletion_check() from public, anon;
grant execute on function private.account_deletion_check() to authenticated;
grant execute on function public.account_deletion_check() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Référentiels : plus de lecture anonyme pour l'instant
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'countries', 'languages', 'education_levels', 'academic_domains',
    'academic_programs', 'program_specialties', 'subjects'
  ] loop
    execute format('drop policy %I on public.%I', v_table || '_select_anon', v_table);
    execute format('revoke all on public.%I from anon', v_table);
  end loop;
end
$$;
