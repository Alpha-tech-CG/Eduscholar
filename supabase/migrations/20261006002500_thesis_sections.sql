-- =============================================================================
-- C-04 : plan du mémoire — chapitres, sections et sources citées (cahier §6.9)
-- =============================================================================
-- Version simple de l'éditeur académique : une liste ordonnée de sections, sur
-- trois niveaux de titres, chacune avec son texte. Chaque section désigne les
-- sources du projet qu'elle cite, avec leurs pages.
--
-- Accès par le projet parent seulement. Écriture par fonctions nommées : la
-- propriété est vérifiée avant tout examen de la requête, et une section ne peut
-- citer qu'une source du même projet. Un texte modifié entre-temps (autre
-- onglet, autre appareil) n'est pas écrasé.
--
-- Réversibilité : supprimer les fonctions, puis section_citations et thesis_sections.
-- =============================================================================

create table public.thesis_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  -- Rang dans le document. Deux sections d'un projet n'ont jamais le même.
  position integer not null
    constraint thesis_sections_position_check check (position >= 1),
  -- 1 : chapitre ; 2 : section ; 3 : sous-section.
  level smallint not null default 1
    constraint thesis_sections_level_check check (level between 1 and 3),
  title text not null
    constraint thesis_sections_title_check check (private.is_clean_text_array(array[title], 1, 300)),
  body text
    constraint thesis_sections_body_check check (private.is_clean_long_text(body, 30000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thesis_sections_project_position_key unique (project_id, position) deferrable initially deferred
);

comment on table public.thesis_sections is
  'Chapitres et sections d''un mémoire, dans l''ordre du document. Privés, comme le projet.';

create table public.section_citations (
  section_id uuid not null references public.thesis_sections (id) on delete cascade,
  source_id uuid not null references public.project_sources (id) on delete cascade,
  -- Pages ou sections citées de la source.
  pages text
    constraint section_citations_pages_check
      check (pages is null or private.is_clean_text_array(array[pages], 1, 50)),
  created_at timestamptz not null default now(),
  primary key (section_id, source_id)
);

comment on table public.section_citations is
  'Sources du projet citées dans une section, avec leurs pages.';

create index section_citations_source_idx on public.section_citations (source_id);

create trigger thesis_sections_set_updated_at
  before update on public.thesis_sections
  for each row execute function private.set_updated_at();
create trigger thesis_sections_prevent_key_change
  before update on public.thesis_sections
  for each row execute function private.prevent_key_change('id', 'project_id');

-- -----------------------------------------------------------------------------
-- Droits et RLS
-- -----------------------------------------------------------------------------
alter table public.thesis_sections enable row level security;
alter table public.thesis_sections force row level security;
alter table public.section_citations enable row level security;
alter table public.section_citations force row level security;

revoke all on public.thesis_sections, public.section_citations
  from public, anon, authenticated, service_role;
grant select on public.thesis_sections, public.section_citations to authenticated;

create function private.my_section_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.thesis_sections s
  where s.project_id in (select private.my_project_ids());
$$;
revoke all on function private.my_section_ids() from public, anon, authenticated, service_role;
grant execute on function private.my_section_ids() to authenticated;

create policy thesis_sections_select on public.thesis_sections
  for select to authenticated
  using (
    (select private.is_account_active())
    and project_id in (select private.my_project_ids())
  );

create policy section_citations_select on public.section_citations
  for select to authenticated
  using (
    (select private.is_account_active())
    and section_id in (select private.my_section_ids())
  );

-- -----------------------------------------------------------------------------
-- Fonctions
-- -----------------------------------------------------------------------------
-- Projet d'une section de l'appelant ; sinon « introuvable ». Le verrou porte
-- sur le projet : les opérations sur le plan d'un projet passent une par une.
create function private.require_own_section(p_section_id uuid)
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
  from public.thesis_sections s
  join public.research_projects r on r.id = s.project_id
  where s.id = p_section_id and r.owner_id = v_uid and r.deleted_at is null;
  if not found then
    perform private.fail('not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('thesis_sections:' || v_project::text, 0));
  -- La section peut avoir été supprimée pendant l'attente du verrou.
  perform 1 from public.thesis_sections s where s.id = p_section_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  return v_project;
end
$$;
revoke all on function private.require_own_section(uuid) from public, anon, authenticated, service_role;

-- Champs acceptés : title, level. La section est ajoutée à la fin du plan.
create function private.add_thesis_section(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_project(p_project_id);
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'level' and coalesce(p ->> 'level', '') !~ '^[1-3]$' then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Deux cents sections créées par jour et par compte, projets supprimés compris.
  perform pg_advisory_xact_lock(hashtextextended('section_quota:' || v_uid::text, 0));
  if (
    select count(*)
    from public.thesis_sections s
    join public.research_projects r on r.id = s.project_id
    where r.owner_id = v_uid and s.created_at > now() - interval '1 day'
  ) >= 200 then
    perform private.fail('rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('thesis_sections:' || v_project::text, 0));
  if (select count(*) from public.thesis_sections s where s.project_id = v_project) >= 60 then
    perform private.fail('limit_reached');
  end if;

  insert into public.thesis_sections (project_id, position, level, title)
  values (
    v_project,
    coalesce((select max(s.position) from public.thesis_sections s where s.project_id = v_project), 0) + 1,
    coalesce(nullif(p ->> 'level', '')::smallint, 1),
    coalesce(private.clean_line(p ->> 'title'), '')
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Champs acceptés : title, level, body, expected_updated_at. Seuls les champs
-- présents sont écrits. `expected_updated_at`, s'il est fourni, doit être la
-- date de modification lue par l'appelant.
create function private.update_thesis_section(p_section_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_updated_at timestamptz;
begin
  perform private.require_own_section(p_section_id);
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'level' and coalesce(p ->> 'level', '') !~ '^[1-3]$' then
    perform private.fail('invalid_payload', '22023');
  end if;

  v_expected := p ->> 'expected_updated_at';
  if v_expected is not null then
    if v_expected !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    select s.updated_at into v_updated_at from public.thesis_sections s where s.id = p_section_id;
    if v_expected::timestamptz is distinct from v_updated_at then
      perform private.fail('conflict', '40001');
    end if;
  end if;

  update public.thesis_sections s
  set title = case when p ? 'title' then coalesce(private.clean_line(p ->> 'title'), '') else s.title end,
      level = case when p ? 'level' then (p ->> 'level')::smallint else s.level end,
      -- Le texte garde ses sauts de ligne ; seuls les espaces de début et de fin sont retirés.
      body = case when p ? 'body'
        then nullif(btrim(normalize(coalesce(p ->> 'body', ''), NFC), E' \t\r\n'), '') else s.body end
  where s.id = p_section_id;
end
$$;

-- Déplace une section d'un rang vers le haut ou vers le bas.
create function private.move_thesis_section(p_section_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_section(p_section_id);
  v_position integer;
  v_other_id uuid;
  v_other_position integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    perform private.fail('invalid_payload', '22023');
  end if;

  select s.position into v_position from public.thesis_sections s where s.id = p_section_id;

  if p_direction = 'up' then
    select s.id, s.position into v_other_id, v_other_position
    from public.thesis_sections s
    where s.project_id = v_project and s.position < v_position
    order by s.position desc limit 1;
  else
    select s.id, s.position into v_other_id, v_other_position
    from public.thesis_sections s
    where s.project_id = v_project and s.position > v_position
    order by s.position asc limit 1;
  end if;
  -- Déjà en tête ou en queue : rien à faire.
  if v_other_id is null then
    return;
  end if;

  -- L'unicité du rang est vérifiée en fin de transaction : l'échange est permis.
  update public.thesis_sections s set position = v_other_position where s.id = p_section_id;
  update public.thesis_sections s set position = v_position where s.id = v_other_id;
end
$$;

create function private.delete_thesis_section(p_section_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_section(p_section_id);
  delete from public.thesis_sections s where s.id = p_section_id;
end
$$;

-- Ajoute, met à jour ou retire la citation d'une source dans une section. La
-- source doit appartenir au même projet que la section : sinon « introuvable »,
-- qu'elle soit celle d'un autre de ses projets, celle d'autrui ou inexistante.
create function private.set_section_citation(
  p_section_id uuid, p_source_id uuid, p_present boolean, p_pages text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_section(p_section_id);
begin
  if p_source_id is null or p_present is null then
    perform private.fail('invalid_payload', '22023');
  end if;

  if not p_present then
    delete from public.section_citations c
    where c.section_id = p_section_id and c.source_id = p_source_id;
    return;
  end if;

  perform 1 from public.project_sources s where s.id = p_source_id and s.project_id = v_project;
  if not found then
    perform private.fail('not_found');
  end if;

  insert into public.section_citations (section_id, source_id, pages)
  values (p_section_id, p_source_id, private.clean_line(p_pages))
  on conflict (section_id, source_id) do update set pages = excluded.pages;
end
$$;

create function public.add_thesis_section(project_id uuid, payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.add_thesis_section(project_id, payload); $$;

create function public.update_thesis_section(section_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.update_thesis_section(section_id, payload); $$;

create function public.move_thesis_section(section_id uuid, direction text) returns void
language sql security invoker set search_path = ''
as $$ select private.move_thesis_section(section_id, direction); $$;

create function public.delete_thesis_section(section_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_thesis_section(section_id); $$;

create function public.set_section_citation(section_id uuid, source_id uuid, present boolean, pages text default null)
returns void
language sql security invoker set search_path = ''
as $$ select private.set_section_citation(section_id, source_id, present, pages); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'add_thesis_section(uuid, jsonb)',
    'update_thesis_section(uuid, jsonb)',
    'move_thesis_section(uuid, text)',
    'delete_thesis_section(uuid)',
    'set_section_citation(uuid, uuid, boolean, text)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
