-- =============================================================================
-- LOT 1 : catalogue public, correction du lint de la base (ADR-0014)
-- =============================================================================
-- `private.public_search_resources` est `stable` : elle n'appelle plus
-- `private.fail`, fonction volatile, mais lève l'exception elle-même. Même
-- code (`invalid_payload`), même état SQL (22023), même comportement ; les
-- droits ne changent pas (`create or replace` les conserve).
--
-- Réversibilité : rétablir la fonction de la migration 008300.
-- =============================================================================

create or replace function private.public_search_resources(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_page_size constant integer := 20;
  c_cap constant integer := 5000;
  v_empty constant jsonb := jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'capped', false);
  v_terms text[];
  v_query tsquery;
  v_type text;
  v_language text;
  v_access text;
  v_level text;
  v_program text;
  v_country text;
  v_page integer;
  v_total integer;
  v_items jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object'
     or coalesce(p ->> 'page', '1') !~ '^[0-9]{1,3}$'
     or (p ? 'terms' and jsonb_typeof(p -> 'terms') not in ('array', 'null')) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  -- Les filtres sont des chaînes courtes ou rien.
  if exists (
    select 1 from unnest(array['type', 'language', 'access', 'level', 'program', 'country']) as k (key)
    where p ? k.key
      and (jsonb_typeof(p -> k.key) not in ('string', 'null') or char_length(p ->> k.key) > 80)
  ) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'terms') = 'array' and (
       jsonb_array_length(p -> 'terms') > 8
       or exists (select 1 from jsonb_array_elements(p -> 'terms') as e (item) where jsonb_typeof(e.item) <> 'string')
     ) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_page := coalesce(p ->> 'page', '1')::integer;
  if v_page not between 1 and c_cap / c_page_size then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  select coalesce(array_agg(t.term), '{}') into v_terms
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'terms') = 'array' then p -> 'terms' else '[]'::jsonb end) as t (term);
  if exists (
    select 1 from unnest(v_terms) as t (term)
    where t.term !~ '^[^[:space:][:punct:][:cntrl:]]{1,40}$'
  ) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  -- Un filtre absent du référentiel ne trouve rien, et ne fait rien parcourir.
  v_type := nullif(p ->> 'type', '');
  v_language := nullif(p ->> 'language', '');
  v_access := nullif(p ->> 'access', '');
  v_level := nullif(p ->> 'level', '');
  v_program := nullif(p ->> 'program', '');
  v_country := nullif(p ->> 'country', '');
  if (v_type is not null and not exists (select 1 from public.resource_types x where x.code = v_type and x.is_active))
     or (v_language is not null and not exists (select 1 from public.languages x where x.code = v_language and x.is_active))
     or (v_level is not null and not exists (select 1 from public.education_levels x where x.code = v_level and x.is_active))
     or (v_program is not null and not exists (select 1 from public.academic_programs x where x.code = v_program and x.is_active))
     or (v_country is not null and not exists (select 1 from public.countries x where x.code = v_country and x.is_active))
     or (v_access is not null and v_access not in
           ('open_access', 'free_link', 'preview_only', 'institutional_access', 'paid')) then
    return v_empty;
  end if;

  if cardinality(v_terms) > 0 then
    select to_tsquery('simple', string_agg(
      quote_literal(t.term) || case when char_length(t.term) >= 3 then ':*' else '' end, ' & '
    )) into v_query
    from unnest(v_terms) as t (term);
  end if;

  if v_query is not null then
    -- Les fiches trouvées, cinq mille au plus, classées par pertinence.
    with hits as materialized (
      select r.id, r.published_at, ts_rank(r.search_vector, v_query) as score
      from public.resources r
      where r.editorial_status = 'published' and r.visibility = 'public'
        and r.search_vector @@ v_query
        and (v_type is null or r.type_code = v_type)
        and (v_language is null or r.language_code = v_language)
        and (v_access is null or r.access_status = v_access)
        and (v_level is null or r.level_codes @> array[v_level])
        and (v_program is null or r.program_code = v_program)
        and (v_country is null or r.country_code = v_country)
      limit c_cap + 1
    ),
    page as (
      select h.id, h.score, h.published_at
      from hits h
      order by h.score desc, h.published_at desc, h.id
      offset (v_page - 1) * c_page_size
      limit c_page_size
    )
    select (select count(*) from hits)::integer,
           coalesce((
             select jsonb_agg(private.public_resource_object(r) order by pg.score desc, pg.published_at desc, pg.id)
             from page pg
             join public.resources r on r.id = pg.id
           ), '[]'::jsonb)
    into v_total, v_items;
  else
    -- Sans mot cherché : les plus récemment publiées d'abord.
    select count(*)::integer into v_total from (
      select 1
      from public.resources r
      where r.editorial_status = 'published' and r.visibility = 'public'
        and (v_type is null or r.type_code = v_type)
        and (v_language is null or r.language_code = v_language)
        and (v_access is null or r.access_status = v_access)
        and (v_level is null or r.level_codes @> array[v_level])
        and (v_program is null or r.program_code = v_program)
        and (v_country is null or r.country_code = v_country)
      limit c_cap + 1
    ) counted;
    if v_total = 0 then
      return v_empty;
    end if;

    select coalesce(jsonb_agg(private.public_resource_object(s.r) order by (s.r).published_at desc, (s.r).id), '[]'::jsonb)
    into v_items
    from (
      select r
      from public.resources r
      where r.editorial_status = 'published' and r.visibility = 'public'
        and (v_type is null or r.type_code = v_type)
        and (v_language is null or r.language_code = v_language)
        and (v_access is null or r.access_status = v_access)
        and (v_level is null or r.level_codes @> array[v_level])
        and (v_program is null or r.program_code = v_program)
        and (v_country is null or r.country_code = v_country)
      order by r.published_at desc, r.id
      offset (v_page - 1) * c_page_size
      limit c_page_size
    ) s;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'total', least(v_total, c_cap),
    'capped', v_total > c_cap
  );
end
$$;
