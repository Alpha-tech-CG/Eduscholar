-- =============================================================================
-- B-12 — Référentiels
--
-- Références : docs/product/taxonomy-pilot.md ; authorization-model §4 (classe A)
-- et §5.1 (lecture publique, modification par l'administration) ; cahier §14.
--
-- Chaque entrée a un code stable, jamais affiché, et des libellés par langue
-- dans une colonne jsonb. Le français et l'anglais sont obligatoires ; une
-- langue s'ajoute sans changer le schéma. Une entrée ne se supprime pas : elle
-- se désactive.
--
-- Ces tables sont lisibles par tous, visiteurs compris : ce sont les seules.
-- Aucune écriture par l'API ; les données arrivent par migration, et
-- l'administration des référentiels viendra avec les fonctions nommées (D-01).
--
-- Réversibilité : supprimer les tables dans l'ordre inverse de leur création,
-- après avoir retiré les clés étrangères qui les référencent.
-- =============================================================================

-- Les libellés français et anglais sont présents et non vides.
create function private.has_required_labels(p_labels jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_labels) = 'object'
    and char_length(btrim(coalesce(p_labels ->> 'fr', ''))) between 1 and 200
    and char_length(btrim(coalesce(p_labels ->> 'en', ''))) between 1 and 200;
$$;
revoke all on function private.has_required_labels(jsonb) from public, anon, authenticated;

create table public.countries (
  code text primary key
    constraint countries_code_format check (code ~ '^[A-Z]{2}$'),
  labels jsonb not null
    constraint countries_labels_check check (private.has_required_labels(labels)),
  is_active boolean not null default true
);
comment on table public.countries is 'Pays, codes ISO 3166-1 alpha-2.';

create table public.languages (
  code text primary key
    constraint languages_code_format check (code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  labels jsonb not null
    constraint languages_labels_check check (private.has_required_labels(labels)),
  is_interface boolean not null default false,
  is_active boolean not null default true
);
comment on table public.languages is
  'Langues (BCP 47). is_interface : langue de l''interface ; sinon langue de contenu seulement.';

create table public.education_levels (
  code text primary key
    constraint education_levels_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  labels jsonb not null
    constraint education_levels_labels_check check (private.has_required_labels(labels)),
  isced_level smallint
    constraint education_levels_isced_check check (isced_level between 0 and 8),
  position integer not null default 0,
  is_active boolean not null default true
);
comment on table public.education_levels is
  'Niveaux d''études, rattachés à la classification internationale CITE (ISCED).';

create table public.academic_domains (
  code text primary key
    constraint academic_domains_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  labels jsonb not null
    constraint academic_domains_labels_check check (private.has_required_labels(labels)),
  is_active boolean not null default true
);

create table public.academic_programs (
  code text primary key
    constraint academic_programs_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  domain_code text not null references public.academic_domains (code) on update restrict on delete restrict,
  labels jsonb not null
    constraint academic_programs_labels_check check (private.has_required_labels(labels)),
  is_active boolean not null default true
);
comment on table public.academic_programs is 'Filières.';
create index academic_programs_domain_code_idx on public.academic_programs (domain_code);

create table public.program_specialties (
  program_code text not null references public.academic_programs (code) on update restrict on delete restrict,
  code text not null
    constraint program_specialties_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  labels jsonb not null
    constraint program_specialties_labels_check check (private.has_required_labels(labels)),
  position integer not null default 0,
  is_active boolean not null default true,
  primary key (program_code, code)
);

create table public.subjects (
  program_code text not null references public.academic_programs (code) on update restrict on delete restrict,
  code text not null
    constraint subjects_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  labels jsonb not null
    constraint subjects_labels_check check (private.has_required_labels(labels)),
  position integer not null default 0,
  is_active boolean not null default true,
  primary key (program_code, code)
);
comment on table public.subjects is 'Matières d''une filière.';

-- Un code ne change jamais.
create trigger countries_prevent_key_change before update on public.countries
  for each row execute function private.prevent_key_change('code');
create trigger languages_prevent_key_change before update on public.languages
  for each row execute function private.prevent_key_change('code');
create trigger education_levels_prevent_key_change before update on public.education_levels
  for each row execute function private.prevent_key_change('code');
create trigger academic_domains_prevent_key_change before update on public.academic_domains
  for each row execute function private.prevent_key_change('code');
create trigger academic_programs_prevent_key_change before update on public.academic_programs
  for each row execute function private.prevent_key_change('code');
create trigger program_specialties_prevent_key_change before update on public.program_specialties
  for each row execute function private.prevent_key_change('program_code', 'code');
create trigger subjects_prevent_key_change before update on public.subjects
  for each row execute function private.prevent_key_change('program_code', 'code');

-- Droits : lecture seule, pour tous. Les privilèges par défaut de la plateforme
-- sont retirés explicitement.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'countries', 'languages', 'education_levels', 'academic_domains',
    'academic_programs', 'program_specialties', 'subjects'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated, service_role', v_table);
    execute format('grant select on public.%I to anon, authenticated, service_role', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'create policy %I on public.%I for select to anon using (is_active)',
      v_table || '_select_anon', v_table
    );
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (is_active and (select private.is_account_active()))',
      v_table || '_select_authenticated', v_table
    );
  end loop;
end
$$;
