-- =============================================================================
-- D-21 : corrections de la revue de sécurité de la fonction de recherche
-- =============================================================================
--   - un mot d'une ou deux lettres n'est plus cherché par son début : « a »
--     développait tous les mots commençant par « a », soit presque tout
--     l'index, à chaque appel. Il est cherché tel quel ;
--   - un filtre qui n'appartient pas au référentiel rend une page vide sans
--     rien parcourir : par appel direct, une valeur inventée faisait lire tout
--     le catalogue deux fois ;
--   - la forme de la demande est vérifiée avant toute lecture : nombre et
--     nature des mots, page écrite en chiffres ordinaires ;
--   - les mots sont refusés pour ce qu'ils ne doivent pas contenir — espace,
--     ponctuation, caractère de commande — plutôt qu'admis pour ce qu'ils sont :
--     la règle ne dépend plus de la langue de la base ;
--   - l'index de recherche ne couvre plus que les fiches publiées et publiques :
--     le temps d'une recherche ne dépend plus des fiches que l'appelant ne peut
--     pas lire, et l'index est plus petit. La file de modération, courte, ne
--     s'en servait pas.
--
-- Non retenu : un délai propre à la fonction. Un réglage posé sur une fonction
-- ne borne pas la requête qui l'appelle ; le délai du rôle (huit secondes)
-- reste la borne.
--
-- Réversibilité : rétablir la fonction de la migration 006400 et l'index de la
-- migration 001700.
-- =============================================================================

drop index public.resources_search_vector_idx;
create index resources_public_search_idx
  on public.resources using gin (search_vector)
  where editorial_status = 'published' and visibility = 'public';

create or replace function private.search_resources(p jsonb)
returns table (id uuid, total integer, capped boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page_size constant integer := 20;
  c_cap constant integer := 5000;
  v_terms text[];
  v_query tsquery;
  v_type text;
  v_language text;
  v_access text;
  v_level text;
  v_subject text;
  v_page integer;
  v_total integer;
begin
  if (select auth.uid()) is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or coalesce(p ->> 'page', '1') !~ '^[0-9]{1,3}$'
     or (p ? 'terms' and jsonb_typeof(p -> 'terms') not in ('array', 'null')) then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Huit mots au plus, tous des chaînes : vérifié avant de les lire.
  if jsonb_typeof(p -> 'terms') = 'array' and (
       jsonb_array_length(p -> 'terms') > 8
       or exists (select 1 from jsonb_array_elements(p -> 'terms') as e (item) where jsonb_typeof(e.item) <> 'string')
     ) then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_page := coalesce(p ->> 'page', '1')::integer;
  if v_page not between 1 and c_cap / c_page_size then
    perform private.fail('invalid_payload', '22023');
  end if;

  select coalesce(array_agg(t.term), '{}') into v_terms
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'terms') = 'array' then p -> 'terms' else '[]'::jsonb end) as t (term);
  -- Ni espace, ni ponctuation, ni caractère de commande : rien qui puisse
  -- passer pour un opérateur, dans quelque langue que soit réglée la base.
  if exists (
    select 1 from unnest(v_terms) as t (term)
    where t.term !~ '^[^[:space:][:punct:][:cntrl:]]{1,40}$'
  ) then
    perform private.fail('invalid_payload', '22023');
  end if;

  perform private.consume_user_quota('catalogue-search', 200, 300);

  -- Un filtre absent du référentiel ne trouve rien, et ne fait rien parcourir.
  v_type := nullif(p ->> 'type', '');
  v_language := nullif(p ->> 'language', '');
  v_access := nullif(p ->> 'access', '');
  v_level := nullif(p ->> 'level', '');
  v_subject := nullif(p ->> 'subject', '');
  if (v_type is not null and not exists (select 1 from public.resource_types x where x.code = v_type))
     or (v_language is not null and not exists (select 1 from public.languages x where x.code = v_language))
     or (v_level is not null and not exists (select 1 from public.education_levels x where x.code = v_level))
     or (v_subject is not null and not exists (select 1 from public.subjects x where x.code = v_subject))
     or (v_access is not null and v_access not in
           ('open_access', 'free_link', 'preview_only', 'institutional_access', 'paid')) then
    return;
  end if;

  if cardinality(v_terms) > 0 then
    -- Chaque mot est cité ; à partir de trois lettres, il est cherché par son début.
    select to_tsquery('simple', string_agg(
      quote_literal(t.term) || case when char_length(t.term) >= 3 then ':*' else '' end, ' & '
    )) into v_query
    from unnest(v_terms) as t (term);
  end if;

  if v_query is not null then
    -- Les fiches trouvées, cinq mille au plus, classées par pertinence.
    return query
    with hits as materialized (
      select r.id, r.published_at, ts_rank(r.search_vector, v_query) as score
      from public.resources r
      where r.editorial_status = 'published' and r.visibility = 'public'
        and r.search_vector @@ v_query
        and (v_type is null or r.type_code = v_type)
        and (v_language is null or r.language_code = v_language)
        and (v_access is null or r.access_status = v_access)
        and (v_level is null or r.level_codes @> array[v_level])
        and (v_subject is null or r.subject_codes @> array[v_subject])
      limit c_cap + 1
    )
    select h.id,
           least((select count(*) from hits), c_cap)::integer,
           (select count(*) from hits) > c_cap
    from hits h
    order by h.score desc, h.published_at desc, h.id
    offset (v_page - 1) * c_page_size
    limit c_page_size;
    return;
  end if;

  -- Sans mot cherché : les plus récemment publiées d'abord.
  select count(*) into v_total from (
    select 1
    from public.resources r
    where r.editorial_status = 'published' and r.visibility = 'public'
      and (v_type is null or r.type_code = v_type)
      and (v_language is null or r.language_code = v_language)
      and (v_access is null or r.access_status = v_access)
      and (v_level is null or r.level_codes @> array[v_level])
      and (v_subject is null or r.subject_codes @> array[v_subject])
    limit c_cap + 1
  ) counted;
  if v_total = 0 then
    return;
  end if;

  return query
  select r.id, least(v_total, c_cap), v_total > c_cap
  from public.resources r
  where r.editorial_status = 'published' and r.visibility = 'public'
    and (v_type is null or r.type_code = v_type)
    and (v_language is null or r.language_code = v_language)
    and (v_access is null or r.access_status = v_access)
    and (v_level is null or r.level_codes @> array[v_level])
    and (v_subject is null or r.subject_codes @> array[v_subject])
  order by r.published_at desc, r.id
  offset (v_page - 1) * c_page_size
  limit c_page_size;
end
$$;
