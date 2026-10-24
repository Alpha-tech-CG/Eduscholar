-- =============================================================================
-- LOT 1 : catalogue public, sans compte (ADR-0014)
-- =============================================================================
-- Un visiteur sans compte cherche dans le catalogue, voit les fiches récentes,
-- populaires et institutionnelles, et ouvre une fiche publique indexable.
-- Le serveur Next.js appelle ces fonctions avec la clé publique, sans session
-- (rôle `anon`) ; le navigateur ne parle toujours qu'au serveur (ADR-0007).
--
-- Règles tenues par les fonctions, pas par l'appelant :
--   - seules les fiches publiées et publiques (`editorial_status = 'published'`
--     et `visibility = 'public'`) existent pour elles. En attente, en examen,
--     à corriger, vérifiée, refusée, suspendue, retirée, réservée à une
--     organisation : jamais rendue, jamais comptée ;
--   - seules les colonnes de description sont rendues, une à une (liste dans
--     `private.public_resource_object`). Jamais le contributeur
--     (`submitted_by`), l'organisation (`organization_id`), l'identifiant chez
--     la source, les notes internes, l'historique ni les signalements ;
--   - aucune écriture : toutes sont `stable`. Aucune table n'est ouverte à
--     `anon` : pas de politique RLS nouvelle ;
--   - popularité : nombre de favoris par fiche, agrégé, jamais rendu, et
--     seulement à partir de trois favoris (seuil d'effectif, modèle
--     d'autorisation §5.5) ;
--   - « institution vérifiée » : fiche d'origine `organization` dont
--     l'organisation est au statut `verified` au moment de la lecture. Une
--     organisation suspendue perd le badge aussitôt.
--
-- La limitation de débit par adresse est tenue par l'application : en base,
-- toutes les requêtes du serveur arrivent de la même adresse. Le travail d'un
-- appel est borné ici (vingt fiches par page, décompte plafonné à cinq mille,
-- huit mots), et par le délai du rôle `anon` (trois secondes).
--
-- `private.public_reference_data` reprend la forme de `private.reference_data`
-- sans exiger de compte (référentiels : lecture publique, modèle
-- d'autorisation §5.1 ligne 1). Le test 36 vérifie que les deux rendent la
-- même chose pour un compte actif : une évolution de l'une sans l'autre le
-- fait échouer.
--
-- Réversibilité :
--   drop function public.public_search_resources(jsonb), public.public_resource(uuid),
--     public.public_home_sections(), public.public_sitemap_resources(),
--     public.public_reference_data();
--   drop function private.public_search_resources(jsonb), private.public_resource(uuid),
--     private.public_home_sections(), private.public_sitemap_resources(),
--     private.public_reference_data(), private.public_resource_object(public.resources);
--   revoke usage on schema private from anon;
-- puis remettre `requireOnboardedUser` sur /search et /resources/[id].
-- =============================================================================

-- Les enveloppes de `public` sont SECURITY INVOKER : `anon` doit pouvoir
-- atteindre la fonction qu'elles appellent. L'usage du schéma ne donne aucun
-- droit sur ce qu'il contient ; chaque fonction et chaque table restent
-- fermées une à une (test 00).
grant usage on schema private to anon;

-- ---------------------------------------------------------------------------
-- Ce qu'un visiteur lit d'une fiche
-- ---------------------------------------------------------------------------
create function private.public_resource_object(r public.resources)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'type_code', r.type_code,
    'title', r.title,
    'abstract', r.abstract,
    'authors', to_jsonb(r.authors),
    'institution_name', r.institution_name,
    'publication_year', r.publication_year,
    'thesis_degree', r.thesis_degree,
    'language_code', r.language_code,
    'country_code', r.country_code,
    'program_code', r.program_code,
    'level_codes', to_jsonb(r.level_codes),
    'subject_codes', to_jsonb(r.subject_codes),
    'tags', to_jsonb(r.tags),
    'doi', r.doi,
    'official_url', r.official_url,
    'access_status', r.access_status,
    'license_code', r.license_code,
    'source_kind', r.source_kind,
    'source_name', r.source_name,
    'last_verified_at', r.last_verified_at,
    'published_at', r.published_at,
    'updated_at', r.updated_at,
    'verified_institution',
      r.source_kind = 'organization'
      and r.organization_id is not null
      and exists (
        select 1 from public.organizations o
        where o.id = r.organization_id and o.status = 'verified'
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Recherche
-- ---------------------------------------------------------------------------
-- `p` : { terms: [mots], type, language, access, level, program, country, page }.
-- Mêmes règles que `private.search_resources` (ADR-0010), deux filtres de plus
-- (filière, pays), et le contenu des fiches rendu directement : le visiteur ne
-- lit pas la table.
create function private.public_search_resources(p jsonb)
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
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Les filtres sont des chaînes courtes ou rien.
  if exists (
    select 1 from unnest(array['type', 'language', 'access', 'level', 'program', 'country']) as k (key)
    where p ? k.key
      and (jsonb_typeof(p -> k.key) not in ('string', 'null') or char_length(p ->> k.key) > 80)
  ) then
    perform private.fail('invalid_payload', '22023');
  end if;
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
  if exists (
    select 1 from unnest(v_terms) as t (term)
    where t.term !~ '^[^[:space:][:punct:][:cntrl:]]{1,40}$'
  ) then
    perform private.fail('invalid_payload', '22023');
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

-- ---------------------------------------------------------------------------
-- Une fiche
-- ---------------------------------------------------------------------------
-- `null` pour une fiche inexistante, non publiée ou réservée : la même réponse.
create function private.public_resource(p_resource_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.public_resource_object(r)
  from public.resources r
  where r.id = p_resource_id
    and r.editorial_status = 'published' and r.visibility = 'public';
$$;

-- ---------------------------------------------------------------------------
-- Accueil : récentes, populaires, institutionnelles vérifiées
-- ---------------------------------------------------------------------------
create function private.public_home_sections()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recent', (
      select coalesce(jsonb_agg(private.public_resource_object(s.r) order by (s.r).published_at desc, (s.r).id), '[]'::jsonb)
      from (
        select r from public.resources r
        where r.editorial_status = 'published' and r.visibility = 'public'
        order by r.published_at desc, r.id
        limit 6
      ) s
    ),
    -- Nombre de favoris, agrégé ; jamais rendu ; trois au moins.
    'popular', (
      select coalesce(jsonb_agg(private.public_resource_object(s.r) order by s.n desc, (s.r).published_at desc, (s.r).id), '[]'::jsonb)
      from (
        select r, f.n
        from (
          select x.resource_id, count(*) as n
          from public.resource_favorites x
          group by x.resource_id
          having count(*) >= 3
        ) f
        join public.resources r on r.id = f.resource_id
        where r.editorial_status = 'published' and r.visibility = 'public'
        order by f.n desc, r.published_at desc, r.id
        limit 6
      ) s
    ),
    'institutional', (
      select coalesce(jsonb_agg(private.public_resource_object(s.r) order by (s.r).published_at desc, (s.r).id), '[]'::jsonb)
      from (
        select r from public.resources r
        join public.organizations o on o.id = r.organization_id and o.status = 'verified'
        where r.editorial_status = 'published' and r.visibility = 'public'
          and r.source_kind = 'organization'
        order by r.published_at desc, r.id
        limit 6
      ) s
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Plan du site : identifiant et date de modification, rien d'autre
-- ---------------------------------------------------------------------------
-- Seize mille fiches au plus, les plus récemment publiées : trois langues par
-- fiche tiennent sous la limite de cinquante mille adresses d'un plan.
create function private.public_sitemap_resources()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'updated_at', s.updated_at) order by s.published_at desc, s.id), '[]'::jsonb)
  from (
    select r.id, greatest(r.updated_at, r.published_at) as updated_at, r.published_at
    from public.resources r
    where r.editorial_status = 'published' and r.visibility = 'public'
    order by r.published_at desc, r.id
    limit 16000
  ) s;
$$;

-- ---------------------------------------------------------------------------
-- Référentiels, sans compte : même forme que `private.reference_data`
-- ---------------------------------------------------------------------------
create function private.public_reference_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                  from public.countries x where x.is_active),
    'languages', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                  from public.languages x where x.is_active),
    'licenses', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels, 'can_host', x.can_host) order by x.position, x.code), '[]'::jsonb)
                 from public.licenses x where x.is_active),
    'resource_types', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                       from public.resource_types x where x.is_active),
    'education_levels', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                         from public.education_levels x where x.is_active),
    'academic_domains', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                         from public.academic_domains x where x.is_active),
    'academic_programs', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'domain_code', x.domain_code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                          from public.academic_programs x
                          join public.academic_domains d on d.code = x.domain_code and d.is_active
                          where x.is_active),
    'program_specialties', (select coalesce(jsonb_agg(jsonb_build_object('program_code', x.program_code, 'code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                            from public.program_specialties x
                            join public.academic_programs a on a.code = x.program_code and a.is_active
                            join public.academic_domains d on d.code = a.domain_code and d.is_active
                            where x.is_active),
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object('program_code', x.program_code, 'code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                 from public.subjects x
                 join public.academic_programs a on a.code = x.program_code and a.is_active
                 join public.academic_domains d on d.code = a.domain_code and d.is_active
                 where x.is_active)
  );
$$;

-- ---------------------------------------------------------------------------
-- Enveloppes exposées
-- ---------------------------------------------------------------------------
create function public.public_search_resources(payload jsonb) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.public_search_resources(payload); $$;

create function public.public_resource(resource_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.public_resource(resource_id); $$;

create function public.public_home_sections() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.public_home_sections(); $$;

create function public.public_sitemap_resources() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.public_sitemap_resources(); $$;

create function public.public_reference_data() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.public_reference_data(); $$;

-- ---------------------------------------------------------------------------
-- Droits : `anon` seulement. Les comptes connectés ont leurs propres lectures ;
-- le rôle serveur n'en a pas besoin.
-- ---------------------------------------------------------------------------
revoke all on function private.public_resource_object(public.resources)
  from public, anon, authenticated, service_role;

revoke all on function private.public_search_resources(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.public_resource(uuid) from public, anon, authenticated, service_role;
revoke all on function private.public_home_sections() from public, anon, authenticated, service_role;
revoke all on function private.public_sitemap_resources() from public, anon, authenticated, service_role;
revoke all on function private.public_reference_data() from public, anon, authenticated, service_role;
revoke all on function public.public_search_resources(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.public_resource(uuid) from public, anon, authenticated, service_role;
revoke all on function public.public_home_sections() from public, anon, authenticated, service_role;
revoke all on function public.public_sitemap_resources() from public, anon, authenticated, service_role;
revoke all on function public.public_reference_data() from public, anon, authenticated, service_role;

grant execute on function private.public_search_resources(jsonb) to anon;
grant execute on function private.public_resource(uuid) to anon;
grant execute on function private.public_home_sections() to anon;
grant execute on function private.public_sitemap_resources() to anon;
grant execute on function private.public_reference_data() to anon;
grant execute on function public.public_search_resources(jsonb) to anon;
grant execute on function public.public_resource(uuid) to anon;
grant execute on function public.public_home_sections() to anon;
grant execute on function public.public_sitemap_resources() to anon;
grant execute on function public.public_reference_data() to anon;
