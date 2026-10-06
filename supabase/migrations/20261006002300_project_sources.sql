-- =============================================================================
-- C-02 : sources d'un projet et fiches de lecture (cahier §6.8)
-- =============================================================================
-- Une source appartient à un projet. Elle est saisie par l'étudiant, ou reprise
-- d'une fiche publiée du catalogue : dans les deux cas, rien n'est inventé ni
-- complété par la plateforme. Une fiche de lecture accompagne chaque source.
--
-- Accès : par le projet parent seulement (private.my_project_ids), jamais par
-- une colonne recopiée. Un projet supprimé rend aussitôt ses sources illisibles.
-- Écriture par fonctions nommées : la propriété est vérifiée avant tout examen
-- de la requête, et « introuvable » vaut pour la source d'autrui comme pour une
-- source inexistante.
--
-- Réversibilité : supprimer les fonctions, puis literature_notes et project_sources.
-- =============================================================================

create table public.project_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  -- Fiche du catalogue d'où la source a été reprise, s'il y en a une.
  resource_id uuid references public.resources (id) on delete set null,

  source_type text not null default 'other'
    constraint project_sources_type_check
      check (source_type in ('article', 'book', 'chapter', 'thesis', 'report', 'conference', 'web', 'other')),
  title text not null
    constraint project_sources_title_check check (private.is_clean_text_array(array[title], 1, 500)),
  authors text[] not null default '{}'
    constraint project_sources_authors_check check (private.is_clean_text_array(authors, 50, 200)),
  publication_year smallint
    constraint project_sources_year_check check (publication_year between 1400 and 2100),
  -- Revue, ouvrage collectif, actes, site.
  container_title text
    constraint project_sources_container_check
      check (container_title is null or private.is_clean_text_array(array[container_title], 1, 300)),
  publisher text
    constraint project_sources_publisher_check
      check (publisher is null or private.is_clean_text_array(array[publisher], 1, 200)),
  volume text
    constraint project_sources_volume_check check (volume is null or private.is_clean_text_array(array[volume], 1, 50)),
  issue text
    constraint project_sources_issue_check check (issue is null or private.is_clean_text_array(array[issue], 1, 50)),
  pages text
    constraint project_sources_pages_check check (pages is null or private.is_clean_text_array(array[pages], 1, 50)),
  doi text
    constraint project_sources_doi_check
      check (doi is null or (char_length(doi) <= 255 and doi ~ '^10\.[0-9]{4,9}/[^[:space:][:cntrl:]]+$')),
  url text
    constraint project_sources_url_check
      check (url is null
             or (char_length(url) <= 2000
                 and url ~ '^https?://[^[:space:][:cntrl:]<>"@]+$')),
  accessed_on date
    constraint project_sources_accessed_on_check
      check (accessed_on is null or accessed_on between date '1990-01-01' and date '2100-12-31'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.project_sources is
  'Sources bibliographiques d''un projet de recherche. Privées, comme le projet.';
comment on column public.project_sources.resource_id is
  'Fiche du catalogue reprise. La source garde sa propre copie des métadonnées : elle survit au retrait de la fiche.';

create index project_sources_project_idx on public.project_sources (project_id, created_at);
create index project_sources_resource_idx on public.project_sources (resource_id) where resource_id is not null;
-- Une même fiche du catalogue n'est reprise qu'une fois par projet.
create unique index project_sources_project_resource_idx
  on public.project_sources (project_id, resource_id) where resource_id is not null;

create table public.literature_notes (
  source_id uuid primary key references public.project_sources (id) on delete cascade,
  problem text
    constraint literature_notes_problem_check check (private.is_clean_long_text(problem, 3000)),
  concepts text
    constraint literature_notes_concepts_check check (private.is_clean_long_text(concepts, 3000)),
  method text
    constraint literature_notes_method_check check (private.is_clean_long_text(method, 3000)),
  population_field text
    constraint literature_notes_population_field_check check (private.is_clean_long_text(population_field, 3000)),
  results text
    constraint literature_notes_results_check check (private.is_clean_long_text(results, 3000)),
  limits text
    constraint literature_notes_limits_check check (private.is_clean_long_text(limits, 3000)),
  -- Citation recopiée par l'étudiant, avec ses pages.
  useful_quote text
    constraint literature_notes_useful_quote_check check (private.is_clean_long_text(useful_quote, 2000)),
  quote_pages text
    constraint literature_notes_quote_pages_check
      check (quote_pages is null or private.is_clean_text_array(array[quote_pages], 1, 50)),
  project_link text
    constraint literature_notes_project_link_check check (private.is_clean_long_text(project_link, 3000)),
  target_chapter text
    constraint literature_notes_target_chapter_check
      check (target_chapter is null or private.is_clean_text_array(array[target_chapter], 1, 200)),
  updated_at timestamptz not null default now()
);

comment on table public.literature_notes is
  'Fiche de lecture d''une source (cahier §6.8). Une par source.';

create trigger project_sources_set_updated_at
  before update on public.project_sources
  for each row execute function private.set_updated_at();
create trigger project_sources_prevent_key_change
  before update on public.project_sources
  for each row execute function private.prevent_key_change('id', 'project_id');
create trigger literature_notes_set_updated_at
  before update on public.literature_notes
  for each row execute function private.set_updated_at();
create trigger literature_notes_prevent_key_change
  before update on public.literature_notes
  for each row execute function private.prevent_key_change('source_id');

-- -----------------------------------------------------------------------------
-- Droits et RLS
-- -----------------------------------------------------------------------------
alter table public.project_sources enable row level security;
alter table public.project_sources force row level security;
alter table public.literature_notes enable row level security;
alter table public.literature_notes force row level security;

revoke all on public.project_sources, public.literature_notes
  from public, anon, authenticated, service_role;
grant select on public.project_sources, public.literature_notes to authenticated;

-- Sources des projets de l'appelant, pour la politique des fiches de lecture.
create function private.my_source_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.project_sources s
  where s.project_id in (select private.my_project_ids());
$$;
revoke all on function private.my_source_ids() from public, anon, authenticated, service_role;
grant execute on function private.my_source_ids() to authenticated;

create policy project_sources_select on public.project_sources
  for select to authenticated
  using (
    (select private.is_account_active())
    and project_id in (select private.my_project_ids())
  );

create policy literature_notes_select on public.literature_notes
  for select to authenticated
  using (
    (select private.is_account_active())
    and source_id in (select private.my_source_ids())
  );

-- -----------------------------------------------------------------------------
-- Fonctions
-- -----------------------------------------------------------------------------
create function private.clean_line(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(normalize(coalesce(p_value, ''), NFC)), '');
$$;
revoke all on function private.clean_line(text) from public, anon, authenticated, service_role;

-- Identifiant du projet si l'appelant en est propriétaire ; sinon « introuvable ».
create function private.require_own_project(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  perform 1 from public.research_projects r
  where r.id = p_project_id and r.owner_id = v_uid and r.deleted_at is null
  for share;
  if not found then
    perform private.fail('not_found');
  end if;
  return p_project_id;
end
$$;
revoke all on function private.require_own_project(uuid) from public, anon, authenticated, service_role;

-- Projet d'une source de l'appelant ; sinon « introuvable ».
create function private.require_own_source(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_project uuid;
begin
  select s.project_id into v_project
  from public.project_sources s
  join public.research_projects r on r.id = s.project_id
  where s.id = p_source_id and r.owner_id = v_uid and r.deleted_at is null
  for update of s;
  if not found then
    perform private.fail('not_found');
  end if;
  return v_project;
end
$$;
revoke all on function private.require_own_source(uuid) from public, anon, authenticated, service_role;

-- Contrôles de forme faits avant toute conversion, pour un message stable.
create function private.check_source_payload(p jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'publication_year' and coalesce(p ->> 'publication_year', '') <> ''
     and (p ->> 'publication_year') !~ '^\d{4}$' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'accessed_on' and coalesce(p ->> 'accessed_on', '') <> ''
     and (p ->> 'accessed_on') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform private.fail('invalid_date', '22007');
  end if;
end
$$;
revoke all on function private.check_source_payload(jsonb) from public, anon, authenticated, service_role;

-- Champs acceptés : source_type, title, authors, publication_year,
-- container_title, publisher, volume, issue, pages, doi, url, accessed_on.
create function private.add_project_source(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_project(p_project_id);
  v_id uuid;
begin
  perform private.check_source_payload(p);
  perform pg_advisory_xact_lock(hashtextextended('project_sources:' || v_project::text, 0));
  if (select count(*) from public.project_sources s where s.project_id = v_project) >= 300 then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_sources (
    project_id, source_type, title, authors, publication_year, container_title, publisher,
    volume, issue, pages, doi, url, accessed_on
  )
  values (
    v_project,
    coalesce(nullif(p ->> 'source_type', ''), 'other'),
    coalesce(private.clean_line(p ->> 'title'), ''),
    private.nfc_text_array(p -> 'authors'),
    nullif(p ->> 'publication_year', '')::smallint,
    private.clean_line(p ->> 'container_title'),
    private.clean_line(p ->> 'publisher'),
    private.clean_line(p ->> 'volume'),
    private.clean_line(p ->> 'issue'),
    private.clean_line(p ->> 'pages'),
    nullif(lower(btrim(coalesce(p ->> 'doi', ''))), ''),
    nullif(btrim(coalesce(p ->> 'url', '')), ''),
    nullif(p ->> 'accessed_on', '')::date
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Reprend une fiche publiée du catalogue. Une fiche cachée et une fiche
-- inexistante donnent la même réponse. Reprise deux fois, la même source est
-- renvoyée.
create function private.add_project_source_from_resource(p_project_id uuid, p_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_project(p_project_id);
  v_resource public.resources;
  v_id uuid;
begin
  select * into v_resource
  from public.resources r
  where r.id = p_resource_id and r.editorial_status = 'published' and r.visibility = 'public';
  if not found then
    perform private.fail('not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sources:' || v_project::text, 0));
  select s.id into v_id
  from public.project_sources s
  where s.project_id = v_project and s.resource_id = p_resource_id;
  if v_id is not null then
    return v_id;
  end if;
  if (select count(*) from public.project_sources s where s.project_id = v_project) >= 300 then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_sources (
    project_id, resource_id, source_type, title, authors, publication_year, publisher, doi, url
  )
  values (
    v_project,
    v_resource.id,
    case v_resource.type_code
      when 'article' then 'article'
      when 'book' then 'book'
      when 'thesis' then 'thesis'
      else 'other'
    end,
    v_resource.title,
    v_resource.authors,
    v_resource.publication_year,
    v_resource.institution_name,
    v_resource.doi,
    -- Une adresse comportant un « @ » n'est pas reprise : la source ne l'admet pas.
    case when v_resource.official_url ~ '^https?://[^[:space:][:cntrl:]<>"@]+$' then v_resource.official_url end
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Seuls les champs présents dans la requête sont écrits.
create function private.update_project_source(p_source_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_source(p_source_id);
  perform private.check_source_payload(p);

  update public.project_sources s
  set source_type = case when p ? 'source_type' then p ->> 'source_type' else s.source_type end,
      title = case when p ? 'title' then coalesce(private.clean_line(p ->> 'title'), '') else s.title end,
      authors = case when p ? 'authors' then private.nfc_text_array(p -> 'authors') else s.authors end,
      publication_year = case when p ? 'publication_year'
        then nullif(p ->> 'publication_year', '')::smallint else s.publication_year end,
      container_title = case when p ? 'container_title'
        then private.clean_line(p ->> 'container_title') else s.container_title end,
      publisher = case when p ? 'publisher' then private.clean_line(p ->> 'publisher') else s.publisher end,
      volume = case when p ? 'volume' then private.clean_line(p ->> 'volume') else s.volume end,
      issue = case when p ? 'issue' then private.clean_line(p ->> 'issue') else s.issue end,
      pages = case when p ? 'pages' then private.clean_line(p ->> 'pages') else s.pages end,
      doi = case when p ? 'doi' then nullif(lower(btrim(coalesce(p ->> 'doi', ''))), '') else s.doi end,
      url = case when p ? 'url' then nullif(btrim(coalesce(p ->> 'url', '')), '') else s.url end,
      accessed_on = case when p ? 'accessed_on' then nullif(p ->> 'accessed_on', '')::date else s.accessed_on end
  where s.id = p_source_id;
end
$$;

create function private.delete_project_source(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_source(p_source_id);
  delete from public.project_sources s where s.id = p_source_id;
end
$$;

-- Champs acceptés : problem, concepts, method, population_field, results,
-- limits, useful_quote, quote_pages, project_link, target_chapter.
create function private.save_literature_note(p_source_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_source(p_source_id);
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;

  insert into public.literature_notes (source_id) values (p_source_id)
  on conflict (source_id) do nothing;

  update public.literature_notes n
  set problem = case when p ? 'problem' then private.clean_line(p ->> 'problem') else n.problem end,
      concepts = case when p ? 'concepts' then private.clean_line(p ->> 'concepts') else n.concepts end,
      method = case when p ? 'method' then private.clean_line(p ->> 'method') else n.method end,
      population_field = case when p ? 'population_field'
        then private.clean_line(p ->> 'population_field') else n.population_field end,
      results = case when p ? 'results' then private.clean_line(p ->> 'results') else n.results end,
      limits = case when p ? 'limits' then private.clean_line(p ->> 'limits') else n.limits end,
      useful_quote = case when p ? 'useful_quote'
        then private.clean_line(p ->> 'useful_quote') else n.useful_quote end,
      quote_pages = case when p ? 'quote_pages' then private.clean_line(p ->> 'quote_pages') else n.quote_pages end,
      project_link = case when p ? 'project_link'
        then private.clean_line(p ->> 'project_link') else n.project_link end,
      target_chapter = case when p ? 'target_chapter'
        then private.clean_line(p ->> 'target_chapter') else n.target_chapter end
  where n.source_id = p_source_id;
end
$$;

create function public.add_project_source(project_id uuid, payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.add_project_source(project_id, payload); $$;

create function public.add_project_source_from_resource(project_id uuid, resource_id uuid) returns uuid
language sql security invoker set search_path = ''
as $$ select private.add_project_source_from_resource(project_id, resource_id); $$;

create function public.update_project_source(source_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.update_project_source(source_id, payload); $$;

create function public.delete_project_source(source_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_project_source(source_id); $$;

create function public.save_literature_note(source_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.save_literature_note(source_id, payload); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'add_project_source(uuid, jsonb)',
    'add_project_source_from_resource(uuid, uuid)',
    'update_project_source(uuid, jsonb)',
    'delete_project_source(uuid)',
    'save_literature_note(uuid, jsonb)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
