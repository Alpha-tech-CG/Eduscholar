-- =============================================================================
-- C-01 : projet de recherche privé (cahier §6.7 ; modèle d'autorisation §5.3)
-- =============================================================================
-- Un projet n'a d'autre lecteur que son propriétaire. Aucun rôle de plateforme,
-- de modération ou d'organisation n'y donne accès, et le rôle serveur ne le lit
-- pas. Le partage avec un encadreur viendra en Phase 4, par une table de membres.
--
-- Lecture par RLS. Écriture par fonctions nommées : elles fixent le
-- propriétaire, tiennent le plafond et appliquent la suppression logique.
-- Rien n'est écrit au journal d'audit : il est lisible par l'administration, et
-- l'existence du projet d'une personne ne la regarde pas.
--
-- Réversibilité : supprimer les fonctions, la table et les deux fonctions d'appui.
-- =============================================================================

-- Texte long saisi par l'utilisateur : sauts de ligne admis, pas les autres
-- caractères de contrôle ni les caractères de format invisibles.
create function private.is_clean_long_text(p_value text, p_max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
    or (char_length(p_value) <= p_max_length
        and char_length(btrim(p_value)) > 0
        and p_value !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
        and p_value !~ '[\u0080-\u009F​-‏‪-‮⁦-⁩]');
$$;
revoke all on function private.is_clean_long_text(text, integer) from public, anon;
grant execute on function private.is_clean_long_text(text, integer) to authenticated;

create table public.research_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  title text not null
    constraint research_projects_title_check check (private.is_clean_text_array(array[title], 1, 300)),
  program_code text references public.academic_programs (code) on update restrict on delete restrict,
  status text not null default 'draft'
    constraint research_projects_status_check
      check (status in ('draft', 'in_progress', 'completed', 'archived')),
  due_date date,
  supervisor_name text
    constraint research_projects_supervisor_name_check
      check (supervisor_name is null or private.is_clean_text_array(array[supervisor_name], 1, 200)),

  -- Fiche du projet (cahier §6.7).
  context text
    constraint research_projects_context_check check (private.is_clean_long_text(context, 5000)),
  problem_statement text
    constraint research_projects_problem_statement_check check (private.is_clean_long_text(problem_statement, 5000)),
  main_question text
    constraint research_projects_main_question_check check (private.is_clean_long_text(main_question, 1000)),
  secondary_questions text[] not null default '{}'
    constraint research_projects_secondary_questions_check
      check (private.is_clean_text_array(secondary_questions, 20, 1000)),
  hypotheses text[] not null default '{}'
    constraint research_projects_hypotheses_check check (private.is_clean_text_array(hypotheses, 20, 1000)),
  general_objective text
    constraint research_projects_general_objective_check check (private.is_clean_long_text(general_objective, 1000)),
  specific_objectives text[] not null default '{}'
    constraint research_projects_specific_objectives_check
      check (private.is_clean_text_array(specific_objectives, 20, 1000)),
  theoretical_framework text
    constraint research_projects_theoretical_framework_check
      check (private.is_clean_long_text(theoretical_framework, 5000)),
  methodology text
    constraint research_projects_methodology_check check (private.is_clean_long_text(methodology, 5000)),
  fieldwork text
    constraint research_projects_fieldwork_check check (private.is_clean_long_text(fieldwork, 2000)),
  population_sample text
    constraint research_projects_population_sample_check check (private.is_clean_long_text(population_sample, 2000)),
  outline text
    constraint research_projects_outline_check check (private.is_clean_long_text(outline, 10000)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Suppression logique : le projet cesse aussitôt d'être lisible ; la purge
  -- définitive intervient après un délai.
  deleted_at timestamptz
);

comment on table public.research_projects is
  'Projets de recherche. Privés : lisibles de leur seul propriétaire.';
comment on column public.research_projects.supervisor_name is
  'Nom de l''encadreur, saisi librement. Ne donne aucun accès : le partage relève d''une table de membres.';

create index research_projects_owner_idx on public.research_projects (owner_id) where deleted_at is null;

create trigger research_projects_set_updated_at
  before update on public.research_projects
  for each row execute function private.set_updated_at();
create trigger research_projects_prevent_key_change
  before update on public.research_projects
  for each row execute function private.prevent_key_change('id', 'owner_id');

alter table public.research_projects enable row level security;
alter table public.research_projects force row level security;
revoke all on public.research_projects from public, anon, authenticated, service_role;
grant select on public.research_projects to authenticated;

create policy research_projects_select on public.research_projects
  for select to authenticated
  using (
    (select private.is_account_active())
    and owner_id = (select auth.uid())
    and deleted_at is null
  );

-- Fonction d'appui des tables enfants (modèle d'autorisation §7.4).
create function private.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active()
    and exists (
      select 1 from public.research_projects p
      where p.id = p_project_id
        and p.owner_id = (select auth.uid())
        and p.deleted_at is null
    );
$$;
revoke all on function private.is_project_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_project_owner(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Fonctions
-- -----------------------------------------------------------------------------
-- Champs acceptés : title, program_code, status, due_date, supervisor_name,
-- context, problem_statement, main_question, secondary_questions, hypotheses,
-- general_objective, specific_objectives, theoretical_framework, methodology,
-- fieldwork, population_sample, outline. Tout autre champ est ignoré.

create function private.create_project(p jsonb)
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

create function private.update_project(p_project_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;

  update public.research_projects r
  set title = btrim(normalize(coalesce(p ->> 'title', ''), NFC)),
      program_code = nullif(p ->> 'program_code', ''),
      status = coalesce(nullif(p ->> 'status', ''), 'draft'),
      due_date = nullif(p ->> 'due_date', '')::date,
      supervisor_name = nullif(btrim(normalize(coalesce(p ->> 'supervisor_name', ''), NFC)), ''),
      context = nullif(btrim(normalize(coalesce(p ->> 'context', ''), NFC)), ''),
      problem_statement = nullif(btrim(normalize(coalesce(p ->> 'problem_statement', ''), NFC)), ''),
      main_question = nullif(btrim(normalize(coalesce(p ->> 'main_question', ''), NFC)), ''),
      secondary_questions = private.text_array(p -> 'secondary_questions'),
      hypotheses = private.text_array(p -> 'hypotheses'),
      general_objective = nullif(btrim(normalize(coalesce(p ->> 'general_objective', ''), NFC)), ''),
      specific_objectives = private.text_array(p -> 'specific_objectives'),
      theoretical_framework = nullif(btrim(normalize(coalesce(p ->> 'theoretical_framework', ''), NFC)), ''),
      methodology = nullif(btrim(normalize(coalesce(p ->> 'methodology', ''), NFC)), ''),
      fieldwork = nullif(btrim(normalize(coalesce(p ->> 'fieldwork', ''), NFC)), ''),
      population_sample = nullif(btrim(normalize(coalesce(p ->> 'population_sample', ''), NFC)), ''),
      outline = nullif(btrim(normalize(coalesce(p ->> 'outline', ''), NFC)), '')
  where r.id = p_project_id and r.owner_id = v_uid and r.deleted_at is null;
  -- « Introuvable » et « pas à vous » donnent la même réponse.
  if not found then
    perform private.fail('not_found');
  end if;
end
$$;

-- Suppression logique.
create function private.delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  update public.research_projects r
  set deleted_at = now()
  where r.id = p_project_id and r.owner_id = v_uid and r.deleted_at is null;
  if not found then
    perform private.fail('not_found');
  end if;
end
$$;

create function public.create_project(payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.create_project(payload); $$;

create function public.update_project(project_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.update_project(project_id, payload); $$;

create function public.delete_project(project_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_project(project_id); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'create_project(jsonb)',
    'update_project(uuid, jsonb)',
    'delete_project(uuid)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
