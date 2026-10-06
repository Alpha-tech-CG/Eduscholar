-- =============================================================================
-- C-04 : corrections de la revue de sécurité du plan du mémoire
-- =============================================================================
-- 1. Volume : le texte d'une section est borné aussi en octets, et le texte
--    total d'un compte, projets supprimés compris, à trois millions de
--    caractères.
-- 2. Conflit d'édition : déplacer une section ne change plus sa date de
--    modification ; seul un changement de titre, de niveau ou de texte compte.
-- 3. Fins de ligne : le texte est stocké avec des sauts de ligne simples.
-- 4. Un projet supprimé pendant l'opération n'est plus modifiable : sa ligne
--    est verrouillée au contrôle de propriété.
-- 5. Cent sources citées au plus par section.
--
-- Réversibilité : rétablir les définitions de la migration 002500 et supprimer
-- la contrainte.
-- =============================================================================

alter table public.thesis_sections
  add constraint thesis_sections_body_bytes_check
    check (body is null or octet_length(body) <= 90000);

-- La date de modification ne suit que le contenu.
drop trigger thesis_sections_set_updated_at on public.thesis_sections;
create trigger thesis_sections_set_updated_at
  before update on public.thesis_sections
  for each row
  when ((old.title, old.level, old.body) is distinct from (new.title, new.level, new.body))
  execute function private.set_updated_at();

create or replace function private.require_own_section(p_section_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_project uuid;
begin
  -- La ligne du projet est verrouillée en partage : il ne peut pas être
  -- supprimé avant la fin de l'opération.
  select s.project_id into v_project
  from public.thesis_sections s
  join public.research_projects r on r.id = s.project_id
  where s.id = p_section_id and r.owner_id = v_uid and r.deleted_at is null
  for share of r;
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

create or replace function private.update_thesis_section(p_section_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expected text;
  v_updated_at timestamptz;
  v_body text;
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

  if p ? 'body' then
    -- Sauts de ligne simples ; espaces de début et de fin retirés, paragraphes conservés.
    v_body := nullif(btrim(
      replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
      E' \t\n'), '');

    -- Texte total du compte, projets supprimés compris : trois millions de
    -- caractères, soit plus de mille pages.
    perform pg_advisory_xact_lock(hashtextextended('section_quota:' || v_uid::text, 0));
    if coalesce(char_length(v_body), 0) + coalesce((
      select sum(char_length(s.body))
      from public.thesis_sections s
      join public.research_projects r on r.id = s.project_id
      where r.owner_id = v_uid and s.id <> p_section_id
    ), 0) > 3000000 then
      perform private.fail('limit_reached');
    end if;
  end if;

  update public.thesis_sections s
  set title = case when p ? 'title' then coalesce(private.clean_line(p ->> 'title'), '') else s.title end,
      level = case when p ? 'level' then (p ->> 'level')::smallint else s.level end,
      body = case when p ? 'body' then v_body else s.body end
  where s.id = p_section_id;
end
$$;

create or replace function private.set_section_citation(
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

  -- Cent sources citées au plus par section ; mettre à jour les pages d'une
  -- source déjà citée reste possible.
  if (select count(*) from public.section_citations c where c.section_id = p_section_id) >= 100
     and not exists (
       select 1 from public.section_citations c
       where c.section_id = p_section_id and c.source_id = p_source_id
     ) then
    perform private.fail('limit_reached');
  end if;

  insert into public.section_citations (section_id, source_id, pages)
  values (p_section_id, p_source_id, private.clean_line(p_pages))
  on conflict (section_id, source_id) do update set pages = excluded.pages;
end
$$;
