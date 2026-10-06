-- =============================================================================
-- C-01 : corrections de la revue de sécurité des projets de recherche
-- =============================================================================
-- 1. Purge : un projet supprimé est effacé définitivement après trente jours
--    (politique de confidentialité). La fonction est appelée par une tâche
--    planifiée, avec le rôle serveur.
-- 2. Plafond : vingt créations par jour, projets supprimés compris, pour qu'une
--    boucle de créations et de suppressions ne remplisse pas la table.
-- 3. Modification : seuls les champs présents dans la requête sont écrits ; une
--    fiche modifiée entre-temps n'est pas écrasée (« conflict »).
-- 4. Échéance : format et bornes contrôlés avant toute conversion.
-- 5. Caractères invisibles : classe étendue ; listes normalisées (NFC).
-- 6. Fonction d'appui des tables enfants : my_project_ids().
--
-- Réversibilité : rétablir les définitions de la migration 002100 ; supprimer
-- purge_deleted_projects, my_project_ids, nfc_text_array et la contrainte.
-- =============================================================================

create or replace function private.is_clean_long_text(p_value text, p_max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
    or (char_length(p_value) <= p_max_length
        and char_length(btrim(p_value)) > 0
        and p_value !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
        -- Contrôles C1, trait d'union conditionnel, caractères de format et
        -- séparateurs invisibles.
        and p_value !~ '[\u0080-\u009F­​-‏ -‮⁠-⁩﻿]');
$$;
-- Elle ne sert qu'aux contraintes : aucun rôle de l'API n'a à l'appeler.
revoke all on function private.is_clean_long_text(text, integer)
  from public, anon, authenticated, service_role;

alter table public.research_projects
  add constraint research_projects_due_date_check
    check (due_date is null or due_date between date '2000-01-01' and date '2100-12-31');

-- Liste de textes, chaque élément nettoyé de ses espaces et normalisé.
create function private.nfc_text_array(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then '{}'::text[]
    when jsonb_typeof(p_value) <> 'array' then null
    else coalesce(
      (select array_agg(btrim(normalize(e.value #>> '{}', NFC)) order by e.ordinality)
       from jsonb_array_elements(p_value) with ordinality as e
       where jsonb_typeof(e.value) = 'string'),
      '{}'::text[]
    )
  end;
$$;
revoke all on function private.nfc_text_array(jsonb) from public, anon, authenticated, service_role;

-- Projets de l'appelant, pour les politiques des tables enfants : évaluée une
-- fois par requête, elle exclut les projets supprimés et les comptes inactifs.
create function private.my_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.research_projects p
  where p.owner_id = (select auth.uid())
    and p.deleted_at is null
    and private.is_account_active();
$$;
revoke all on function private.my_project_ids() from public, anon, authenticated, service_role;
grant execute on function private.my_project_ids() to authenticated;

create or replace function private.create_project(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_id uuid;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('projects:' || v_uid::text, 0));
  if (
    select count(*) from public.research_projects r
    where r.owner_id = v_uid and r.deleted_at is null
  ) >= 20 then
    perform private.fail('limit_reached');
  end if;
  -- Projets supprimés compris : créer puis supprimer en boucle ne contourne rien.
  if (
    select count(*) from public.research_projects r
    where r.owner_id = v_uid and r.created_at > now() - interval '1 day'
  ) >= 20 then
    perform private.fail('rate_limited');
  end if;

  insert into public.research_projects (owner_id, title, program_code)
  values (
    v_uid,
    btrim(normalize(coalesce(p ->> 'title', ''), NFC)),
    nullif(p ->> 'program_code', '')
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Seuls les champs présents dans la requête sont écrits. `expected_updated_at`,
-- s'il est fourni, doit être la date de modification lue par l'appelant.
create or replace function private.update_project(p_project_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_updated_at timestamptz;
  v_expected text := p ->> 'expected_updated_at';
  v_due text := p ->> 'due_date';
begin
  -- Propriété d'abord : « introuvable » et « pas à vous » donnent la même
  -- réponse, avant tout examen de la requête.
  select r.updated_at into v_updated_at
  from public.research_projects r
  where r.id = p_project_id and r.owner_id = v_uid and r.deleted_at is null
  for update;
  if not found then
    perform private.fail('not_found');
  end if;

  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if v_expected is not null then
    if v_expected !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    if v_expected::timestamptz is distinct from v_updated_at then
      perform private.fail('conflict', '40001');
    end if;
  end if;
  if p ? 'due_date' and coalesce(v_due, '') <> '' and v_due !~ '^\d{4}-\d{2}-\d{2}$' then
    perform private.fail('invalid_date', '22007');
  end if;

  update public.research_projects r
  set title = case when p ? 'title'
        then btrim(normalize(coalesce(p ->> 'title', ''), NFC)) else r.title end,
      program_code = case when p ? 'program_code'
        then nullif(p ->> 'program_code', '') else r.program_code end,
      status = case when p ? 'status' then p ->> 'status' else r.status end,
      due_date = case when p ? 'due_date' then nullif(v_due, '')::date else r.due_date end,
      supervisor_name = case when p ? 'supervisor_name'
        then nullif(btrim(normalize(coalesce(p ->> 'supervisor_name', ''), NFC)), '') else r.supervisor_name end,
      context = case when p ? 'context'
        then nullif(btrim(normalize(coalesce(p ->> 'context', ''), NFC)), '') else r.context end,
      problem_statement = case when p ? 'problem_statement'
        then nullif(btrim(normalize(coalesce(p ->> 'problem_statement', ''), NFC)), '') else r.problem_statement end,
      main_question = case when p ? 'main_question'
        then nullif(btrim(normalize(coalesce(p ->> 'main_question', ''), NFC)), '') else r.main_question end,
      secondary_questions = case when p ? 'secondary_questions'
        then private.nfc_text_array(p -> 'secondary_questions') else r.secondary_questions end,
      hypotheses = case when p ? 'hypotheses'
        then private.nfc_text_array(p -> 'hypotheses') else r.hypotheses end,
      general_objective = case when p ? 'general_objective'
        then nullif(btrim(normalize(coalesce(p ->> 'general_objective', ''), NFC)), '') else r.general_objective end,
      specific_objectives = case when p ? 'specific_objectives'
        then private.nfc_text_array(p -> 'specific_objectives') else r.specific_objectives end,
      theoretical_framework = case when p ? 'theoretical_framework'
        then nullif(btrim(normalize(coalesce(p ->> 'theoretical_framework', ''), NFC)), '') else r.theoretical_framework end,
      methodology = case when p ? 'methodology'
        then nullif(btrim(normalize(coalesce(p ->> 'methodology', ''), NFC)), '') else r.methodology end,
      fieldwork = case when p ? 'fieldwork'
        then nullif(btrim(normalize(coalesce(p ->> 'fieldwork', ''), NFC)), '') else r.fieldwork end,
      population_sample = case when p ? 'population_sample'
        then nullif(btrim(normalize(coalesce(p ->> 'population_sample', ''), NFC)), '') else r.population_sample end,
      outline = case when p ? 'outline'
        then nullif(btrim(normalize(coalesce(p ->> 'outline', ''), NFC)), '') else r.outline end
  where r.id = p_project_id;
end
$$;

-- Effacement définitif des projets supprimés depuis plus de trente jours.
-- Renvoie le nombre de projets effacés, sans autre détail.
create function private.purge_deleted_projects()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if ((select auth.jwt()) ->> 'role') is distinct from 'service_role' then
    perform private.fail('forbidden', '42501');
  end if;

  delete from public.research_projects r
  where r.deleted_at is not null and r.deleted_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create function public.purge_deleted_projects() returns integer
language sql security invoker set search_path = ''
as $$ select private.purge_deleted_projects(); $$;

revoke all on function private.purge_deleted_projects() from public, anon, authenticated, service_role;
revoke all on function public.purge_deleted_projects() from public, anon, authenticated, service_role;
grant execute on function private.purge_deleted_projects() to service_role;
grant execute on function public.purge_deleted_projects() to service_role;

comment on function public.purge_deleted_projects() is
  'Purge des projets supprimés depuis plus de trente jours. Tâche planifiée, rôle serveur uniquement.';
