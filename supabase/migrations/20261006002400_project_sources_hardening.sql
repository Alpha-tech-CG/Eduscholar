-- =============================================================================
-- C-02 : corrections de la revue de sécurité des sources de projet
-- =============================================================================
-- 1. Plafond quotidien : six cents sources ajoutées par jour et par compte,
--    projets supprimés compris, pour qu'une boucle de créations et de
--    suppressions de projets ne remplisse pas la base.
-- 2. Reprise du catalogue : l'institution d'une fiche n'est reprise comme
--    établissement que pour une thèse ; ailleurs, elle n'est pas l'éditeur.
-- 3. Caractères invisibles : les champs d'une ligne refusent la même classe
--    que les textes longs.
--
-- Réversibilité : rétablir les définitions des migrations 001400 et 002300.
-- =============================================================================

create or replace function private.is_clean_text_array(p_values text[], p_max_items integer, p_max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select array_ndims(p_values) is not distinct from case when cardinality(p_values) = 0 then null else 1 end
    and cardinality(p_values) <= p_max_items
    and not exists (
      select 1
      from unnest(p_values) as u (v)
      where v is null
        or char_length(v) > p_max_length
        or char_length(btrim(v)) = 0
        or v ~ '[[:cntrl:]]'
        -- Contrôles C1, trait d'union conditionnel, caractères de format et
        -- séparateurs invisibles : la même classe que private.is_clean_long_text.
        or v ~ '[\u0080-\u009F­​-‏ -‮⁠-⁩﻿]'
    )
    and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as u (v));
$$;

-- Plafond quotidien d'ajouts, tous projets de l'appelant confondus.
create function private.check_daily_source_quota(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('source_quota:' || p_owner::text, 0));
  if (
    select count(*)
    from public.project_sources s
    join public.research_projects r on r.id = s.project_id
    where r.owner_id = p_owner and s.created_at > now() - interval '1 day'
  ) >= 600 then
    perform private.fail('rate_limited');
  end if;
end
$$;
revoke all on function private.check_daily_source_quota(uuid) from public, anon, authenticated, service_role;

create or replace function private.add_project_source(p_project_id uuid, p jsonb)
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
  perform private.check_daily_source_quota((select auth.uid()));
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

create or replace function private.add_project_source_from_resource(p_project_id uuid, p_resource_id uuid)
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
  perform private.check_daily_source_quota((select auth.uid()));
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
    -- L'institution d'une fiche est l'établissement de soutenance d'une thèse ;
    -- pour un article ou un livre, elle n'est pas l'éditeur : rien n'est repris.
    case when v_resource.type_code = 'thesis' then v_resource.institution_name end,
    v_resource.doi,
    -- Une adresse comportant un « @ » n'est pas reprise : la source ne l'admet pas.
    case when v_resource.official_url ~ '^https?://[^[:space:][:cntrl:]<>"@]+$' then v_resource.official_url end
  )
  returning id into v_id;
  return v_id;
end
$$;
