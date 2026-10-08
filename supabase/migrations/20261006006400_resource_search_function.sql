-- =============================================================================
-- D-21 : recherche du catalogue par une fonction dédiée (ADR-0010)
-- =============================================================================
-- Sous RLS, PostgreSQL n'utilise pas l'index plein texte pour la requête d'un
-- utilisateur : l'opérateur de recherche n'est pas « leakproof », et le
-- planificateur doit d'abord appliquer la politique à chaque fiche. Chaque
-- recherche parcourait donc tout le catalogue.
--
-- La recherche passe désormais par une fonction qui ne connaît que les fiches
-- publiées et publiques — celles que tout compte actif lit déjà — et qui peut
-- donc se servir de l'index. Elle ne rend que des identifiants : le contenu
-- des fiches reste lu par l'application sous la session de l'utilisateur, où
-- la RLS décide comme avant.
--
--   - classement par pertinence quand des mots sont cherchés, puis par date de
--     publication ; par date seule sinon ;
--   - le décompte est plafonné à cinq mille : au-delà, la fonction le dit
--     plutôt que de compter tout le catalogue ;
--   - deux cents recherches par cinq minutes et par compte, tenues en base :
--     un appel direct à l'API n'y échappe pas (dette D-15, pour cette lecture).
--
-- Réversibilité : supprimer les fonctions et l'index ; l'application revient à
-- la lecture directe de `resources`.
-- =============================================================================

-- Parcours par date des fiches publiées et publiques, sans mot cherché.
create index resources_published_at_idx
  on public.resources (published_at desc, id)
  where editorial_status = 'published' and visibility = 'public';

-- `p` : { terms: [mots], type, language, access, level, subject, page }.
-- Les mots viennent de l'application, déjà réduits à des lettres et des
-- chiffres ; ils sont revérifiés ici, et cités un par un dans la requête :
-- aucun opérateur ne peut y être glissé.
create function private.search_resources(p jsonb)
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
  v_type text := nullif(p ->> 'type', '');
  v_language text := nullif(p ->> 'language', '');
  v_access text := nullif(p ->> 'access', '');
  v_level text := nullif(p ->> 'level', '');
  v_subject text := nullif(p ->> 'subject', '');
  v_page integer;
  v_total integer;
begin
  if (select auth.uid()) is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or (p ? 'terms' and jsonb_typeof(p -> 'terms') <> 'array')
     or coalesce(p ->> 'page', '1') !~ '^\d{1,3}$' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_page := coalesce(p ->> 'page', '1')::integer;
  if v_page not between 1 and c_cap / c_page_size
     or char_length(coalesce(v_type, '') || coalesce(v_language, '') || coalesce(v_access, '')
                    || coalesce(v_level, '') || coalesce(v_subject, '')) > 400 then
    perform private.fail('invalid_payload', '22023');
  end if;

  select coalesce(array_agg(t.term), '{}') into v_terms
  from jsonb_array_elements_text(coalesce(p -> 'terms', '[]'::jsonb)) as t (term);
  if cardinality(v_terms) > 8
     or exists (select 1 from unnest(v_terms) as t (term) where t.term !~ '^[[:alnum:]]{1,40}$') then
    perform private.fail('invalid_payload', '22023');
  end if;

  perform private.consume_user_quota('catalogue-search', 200, 300);

  if cardinality(v_terms) > 0 then
    select to_tsquery('simple', string_agg(quote_literal(t.term) || ':*', ' & ')) into v_query
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

create function public.search_resources(payload jsonb)
returns table (id uuid, total integer, capped boolean)
language sql security invoker set search_path = ''
as $$ select * from private.search_resources(payload); $$;

revoke all on function private.search_resources(jsonb) from public, anon, service_role;
revoke all on function public.search_resources(jsonb) from public, anon, service_role;
grant execute on function private.search_resources(jsonb) to authenticated;
grant execute on function public.search_resources(jsonb) to authenticated;
