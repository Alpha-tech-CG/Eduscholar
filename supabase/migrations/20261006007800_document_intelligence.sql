-- =============================================================================
-- Phase 6 : intelligence documentaire, partie base — suggestions et constats
-- =============================================================================
-- Cahier des charges §8 et §13. Cette tranche est ALGORITHMIQUE et
-- DÉTERMINISTE, entièrement en SQL : aucun modèle de langage, aucune API
-- externe, aucun texte généré. Quatre fonctions de LECTURE :
--
--   - `similar_resources` : doublons probables d'une fiche (modération) ;
--   - `suggest_resource_classification` : matières proposées pour une fiche
--     (modération) ;
--   - `project_coherence_report` : constats sur un projet (propriétaire, membre
--     à accès complet) ;
--   - `recommended_resources` : fiches publiées et publiques recommandées à
--     l'appelant.
--
-- Règles communes :
--   - rien n'est jamais appliqué : ces fonctions ne modifient aucune donnée
--     (hors compteurs de débit). Un humain décide, par les fonctions existantes ;
--   - rien n'est inventé (§8, « interdit ») : chaque ligne désigne par son
--     identifiant ou son code ce sur quoi elle s'appuie — une fiche existante,
--     une matière du référentiel, une section, une source — et dit pourquoi
--     (raison, mots qui ont correspondu, champs manquants) ;
--   - l'indice de confiance (`high`, `medium`, `low`) est une règle fixe,
--     écrite au-dessus de chaque fonction ;
--   - aucune nouvelle table : ni journal des recommandations vues, ni profil
--     d'intérêt. Les recommandations ne lisent que les données de l'appelant ;
--   - le rapport de cohérence ne rend aucun texte du mémoire : des
--     identifiants, des titres de section, des nombres.
--
-- Index et coût (base locale, 2 792 fiches, mesuré par `explain analyze`) : la
-- recherche de titres proches passe par un index trigramme sur le titre
-- normalisé, celle des liens par un index sur le lien normalisé ; voir le
-- commentaire de `similar_resources`.
--
-- Réversibilité : supprimer les huit fonctions, leurs appuis et les deux
-- index ; l'extension `pg_trgm` peut rester.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Appuis
-- -----------------------------------------------------------------------------
-- Texte ramené à des mots comparables : sans accents, en minuscules, toute
-- ponctuation devenue une espace. Déclarée immuable pour servir d'expression
-- d'index : si le dictionnaire `unaccent` changeait, l'index serait à refaire.
create function private.fold_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_value, ''))),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$$;

-- Lien ramené à sa forme comparable : sans protocole, sans « www. », sans
-- ancre, sans barre finale, en minuscules.
create function private.normalize_url(p_url text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(regexp_replace(
    regexp_replace(lower(regexp_replace(coalesce(p_url, ''), '#.*$', '')), '^https?://(www\.)?', ''),
    '/+$', ''
  ), '');
$$;

-- Mots vides écartés des comparaisons de mots (français, anglais).
create function private.is_stop_word(p_word text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_word = any (array[
    'les', 'des', 'une', 'aux', 'dans', 'pour', 'par', 'sur', 'avec', 'sans', 'entre', 'est', 'sont',
    'ces', 'ses', 'qui', 'que', 'dont', 'comme', 'plus', 'vers', 'chez', 'sous', 'leur', 'leurs',
    'cette', 'cet', 'ont', 'ete', 'etre', 'mais', 'donc', 'car', 'tout', 'tous', 'toute', 'toutes',
    'and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'their', 'its', 'are', 'not', 'was',
    'were', 'has', 'have', 'but', 'all', 'any', 'can', 'our', 'your', 'his', 'her', 'how', 'what'
  ]);
$$;

revoke all on function private.fold_text(text) from public, anon, authenticated, service_role;
revoke all on function private.normalize_url(text) from public, anon, authenticated, service_role;
revoke all on function private.is_stop_word(text) from public, anon, authenticated, service_role;

create index resources_title_trgm_idx
  on public.resources using gin (private.fold_text(title) extensions.gin_trgm_ops)
  where visibility = 'public';
create index resources_normalized_url_idx
  on public.resources (private.normalize_url(official_url))
  where official_url is not null and visibility = 'public';

-- -----------------------------------------------------------------------------
-- 1. Doublons du catalogue
-- -----------------------------------------------------------------------------
-- Fiches qui ressemblent à celle-ci, parmi celles qu'un modérateur lit déjà
-- (visibilité publique, tous statuts). Une ligne par fiche, sous sa raison la
-- plus forte :
--   - `same_doi`      : même DOI, sans égard à la casse ;
--   - `same_url`      : même lien officiel une fois normalisé ;
--   - `similar_title` : titres normalisés proches (similarité de trigrammes
--                       d'au moins 0,6) ET même année ou auteur commun.
-- Score : 1 pour un DOI ou un lien identique, sinon la similarité des titres.
-- Confiance :
--   - `high`   : même DOI ou même lien ; ou similarité d'au moins 0,9 avec la
--                même année ET un auteur commun ;
--   - `medium` : similarité d'au moins 0,8 ; ou même année ET auteur commun ;
--   - `low`    : le reste (titres proches, un seul des deux recoupements).
-- Coût mesuré sur la base locale (2 792 fiches, `explain analyze`) : les trois
-- conditions passent par leurs index (DOI, lien normalisé, trigrammes du titre)
-- réunis en un seul parcours ; environ 40 ms pour un titre courant, dont
-- l'essentiel est la revérification du titre normalisé des quelque 390 fiches
-- que l'index trigramme retient avant le seuil. Ce coût croît avec le nombre
-- de titres voisins, non avec la taille du catalogue ; le quota le borne.
-- Le seuil de 0,6 est posé sur la fonction elle-même : il ne déborde pas sur
-- le reste de la transaction.
create function private.similar_resources(p_resource_id uuid)
returns table (id uuid, title text, editorial_status text, reason text, score numeric, confidence text)
language plpgsql
security definer
set search_path = ''
set pg_trgm.similarity_threshold = 0.6
as $$
declare
  v_row public.resources;
  v_title text;
  v_url text;
  v_doi text;
  v_authors text[];
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;
  select * into v_row from public.resources r where r.id = p_resource_id and r.visibility = 'public';
  if not found then
    perform private.fail('not_found');
  end if;
  -- Cent vingt recherches par cinq minutes et par compte.
  perform private.consume_user_quota('similar-resources', 120, 300);

  v_title := private.fold_text(v_row.title);
  v_url := private.normalize_url(v_row.official_url);
  v_doi := lower(v_row.doi);
  v_authors := array(select private.fold_text(a.name) from unnest(v_row.authors) as a (name));

  return query
  with candidates as (
    select r.id, r.title, r.editorial_status,
           (v_doi is not null and lower(r.doi) = v_doi) as same_doi,
           (v_url is not null and r.official_url is not null
              and private.normalize_url(r.official_url) = v_url) as same_url,
           extensions.similarity(private.fold_text(r.title), v_title) as sim,
           (r.publication_year is not null and r.publication_year = v_row.publication_year) as same_year,
           exists (
             select 1 from unnest(r.authors) as a (name) where private.fold_text(a.name) = any (v_authors)
           ) as common_author
    from public.resources r
    where r.visibility = 'public'
      and r.id <> p_resource_id
      and ((v_doi is not null and r.doi is not null and lower(r.doi) = v_doi)
        or (v_url is not null and r.official_url is not null
              and private.normalize_url(r.official_url) = v_url)
        -- Un titre trop court ne dit rien : huit caractères au moins.
        or (char_length(v_title) >= 8
              and private.fold_text(r.title) operator(extensions.%) v_title))
  )
  select c.id, c.title, c.editorial_status,
         case when c.same_doi then 'same_doi' when c.same_url then 'same_url' else 'similar_title' end,
         case when c.same_doi or c.same_url then 1.00 else round(c.sim::numeric, 2) end,
         case
           when c.same_doi or c.same_url then 'high'
           when c.sim >= 0.9 and c.same_year and c.common_author then 'high'
           when c.sim >= 0.8 or (c.same_year and c.common_author) then 'medium'
           else 'low'
         end
  from candidates c
  where c.same_doi or c.same_url or (c.sim >= 0.6 and (c.same_year or c.common_author))
  order by case when c.same_doi then 0 when c.same_url then 1 else 2 end, c.sim desc, c.id
  limit 20;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Classification assistée
-- -----------------------------------------------------------------------------
-- Matières proposées pour une fiche : les matières ACTIVES de SA filière que la
-- fiche ne porte pas encore, dont un mot du libellé (dans l'une de ses langues)
-- se retrouve dans le titre, le résumé ou les mots-clés de la fiche. Mots
-- comparés sans accents ; mots vides et mots de moins de trois lettres écartés ;
-- un mot présent dans le libellé de plus de trois matières de la filière
-- (« systèmes », « informatique »…) ne distingue rien et est écarté aussi.
-- Deux mots se correspondent s'ils sont identiques, ou — correspondance faible —
-- s'ils ont au moins six lettres et les mêmes six premières (« algorithmes »,
-- « algorithmique »).
-- Confiance :
--   - `high`   : tous les mots distinctifs du libellé, dans une langue au
--                moins, se retrouvent à l'identique dans la fiche, dont l'un au
--                moins dans le titre ou les mots-clés ;
--   - `medium` : au moins un mot identique ;
--   - `low`    : seulement des correspondances faibles.
-- Aucun niveau n'est proposé : les libellés des niveaux (« Licence 3 »,
-- « Master 1 ») ne se retrouvent pas de façon fiable dans une fiche, et une
-- suggestion sans appui serait une invention.
-- La fonction ne modifie rien : le modérateur applique par
-- `moderator_update_resource`.
create function private.suggest_resource_classification(p_resource_id uuid)
returns table (kind text, code text, labels jsonb, matched_words text[], confidence text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.resources;
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;
  select * into v_row from public.resources r where r.id = p_resource_id and r.visibility = 'public';
  if not found then
    perform private.fail('not_found');
  end if;
  -- Cent vingt demandes par cinq minutes et par compte.
  perform private.consume_user_quota('classification-suggest', 120, 300);

  return query
  with fiche as (
    select w.word, bool_or(w.strong) as strong
    from (
      select t.word, true as strong
      from regexp_split_to_table(
        private.fold_text(v_row.title || ' ' || array_to_string(v_row.tags, ' ')), ' ') as t (word)
      union all
      select t.word, false
      from regexp_split_to_table(private.fold_text(coalesce(v_row.abstract, '')), ' ') as t (word)
    ) w
    where char_length(w.word) >= 3 and not private.is_stop_word(w.word)
    group by w.word
  ),
  label_words as (
    select distinct s.code, l.lang, t.word
    from public.subjects s
    cross join lateral jsonb_each_text(s.labels) as l (lang, label)
    cross join lateral regexp_split_to_table(private.fold_text(l.label), ' ') as t (word)
    where s.program_code = v_row.program_code
      and s.is_active
      and s.code <> all (v_row.subject_codes)
      and char_length(t.word) >= 3
      and not private.is_stop_word(t.word)
  ),
  distinctive as (
    select lw.code, lw.lang, lw.word
    from label_words lw
    where lw.word not in (
      select x.word from label_words x group by x.word having count(distinct x.code) > 3
    )
  ),
  matches as (
    select d.code, d.lang, d.word as label_word, f.word as fiche_word, f.strong, (f.word = d.word) as exact
    from distinctive d
    join fiche f
      on f.word = d.word
      or (char_length(f.word) >= 6 and char_length(d.word) >= 6 and left(f.word, 6) = left(d.word, 6))
  ),
  per_language as (
    select d.code, d.lang,
           count(distinct d.word) as label_size,
           count(distinct d.word) filter (where exists (
             select 1 from matches m
             where m.code = d.code and m.lang = d.lang and m.label_word = d.word and m.exact
           )) as exact_size
    from distinctive d
    group by d.code, d.lang
  ),
  per_subject as (
    select m.code,
           array_agg(distinct m.fiche_word order by m.fiche_word) as words,
           count(distinct m.label_word) filter (where m.exact) as exact_count,
           bool_or(m.exact and m.strong) as strong_exact,
           exists (
             select 1 from per_language pl
             where pl.code = m.code and pl.label_size > 0 and pl.exact_size = pl.label_size
           ) as full_label
    from matches m
    group by m.code
  )
  select 'subject'::text, s.code, s.labels, p.words,
         case
           when p.full_label and p.strong_exact then 'high'
           when p.exact_count > 0 then 'medium'
           else 'low'
         end
  from per_subject p
  join public.subjects s on s.program_code = v_row.program_code and s.code = p.code
  order by case when p.full_label and p.strong_exact then 0 when p.exact_count > 0 then 1 else 2 end,
           p.exact_count desc, cardinality(p.words) desc, s.code
  limit 10;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Contrôles de cohérence d'un projet
-- -----------------------------------------------------------------------------
-- Constats sur un projet, pour son propriétaire ou un membre à accès complet
-- (`private.project_role` : un membre à accès limité, un tiers, un projet
-- supprimé reçoivent la même réponse `not_found`). Rien n'est corrigé.
-- Chaque constat porte un code, une gravité (`info`, `warning`), un nombre, et
-- ce qu'il désigne : sections (identifiant et titre), identifiants de sources
-- ou de tâches, noms de champs. Jamais le texte d'une section, d'une fiche de
-- lecture, ni le titre d'une source.
-- Seuils : une section est « rédigée » à partir de 300 caractères ; « très
-- courte » sous le quart de la longueur médiane des sections non vides, quand
-- il y en a au moins trois et que cette médiane atteint 400 caractères ;
-- échéance « proche » : dans les trente jours.
create function private.project_coherence_report(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.project_role(p_project_id);
  v_project public.research_projects;
  v_findings jsonb := '[]'::jsonb;
  v_items jsonb;
  v_fields text[];
  v_median numeric;
  v_written integer;
  v_year integer := extract(year from current_date)::integer;
  v_with_year integer;
  v_recent integer;
  v_old integer;
  v_newest integer;
  v_days integer;
begin
  -- Soixante rapports par cinq minutes et par compte.
  perform private.consume_user_quota('project-coherence', 60, 300);
  select * into v_project from public.research_projects r where r.id = p_project_id;

  -- Fiche du projet incomplète.
  v_fields := array_remove(array[
    case when nullif(btrim(coalesce(v_project.problem_statement, '')), '') is null then 'problem_statement' end,
    case when nullif(btrim(coalesce(v_project.main_question, '')), '') is null then 'main_question' end,
    case when nullif(btrim(coalesce(v_project.general_objective, '')), '') is null then 'general_objective' end,
    case when nullif(btrim(coalesce(v_project.methodology, '')), '') is null then 'methodology' end
  ], null);
  if cardinality(v_fields) > 0 then
    v_findings := v_findings || jsonb_build_object(
      'code', 'project_incomplete', 'severity', 'warning', 'count', cardinality(v_fields), 'fields', to_jsonb(v_fields));
  end if;

  -- Échéance du projet, tant qu'il n'est ni terminé ni archivé.
  if v_project.due_date is not null and v_project.status in ('draft', 'in_progress') then
    v_days := v_project.due_date - current_date;
    if v_days < 0 then
      v_findings := v_findings || jsonb_build_object(
        'code', 'project_overdue', 'severity', 'warning', 'count', 1, 'days_late', -v_days);
    elsif v_days <= 30 then
      v_findings := v_findings || jsonb_build_object(
        'code', 'project_due_soon', 'severity', 'info', 'count', 1, 'days_left', v_days);
    end if;
  end if;

  -- Tâches en retard.
  select jsonb_agg(t.id order by t.due_date, t.id) into v_items
  from public.project_tasks t
  where t.project_id = p_project_id and t.done_at is null and t.due_date < current_date;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'task_overdue', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'task_ids', v_items);
  end if;

  -- Sections sans texte.
  select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) = 0;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'section_empty', 'severity', 'info', 'count', jsonb_array_length(v_items), 'sections', v_items);
  end if;

  -- Sections rédigées sans aucune citation.
  select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) >= 300
    and not exists (select 1 from public.section_citations c where c.section_id = s.id);
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'section_without_citation', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'sections', v_items);
  end if;

  -- Sections rédigées qui ne s'appuient que sur une seule source.
  select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) >= 300
    and (select count(*) from public.section_citations c where c.section_id = s.id) = 1;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'section_single_source', 'severity', 'info', 'count', jsonb_array_length(v_items), 'sections', v_items);
  end if;

  -- Sections très courtes par rapport aux autres.
  select count(*), percentile_cont(0.5) within group (order by char_length(btrim(s.body)))
  into v_written, v_median
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) > 0;
  if v_written >= 3 and v_median >= 400 then
    select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
    from public.thesis_sections s
    where s.project_id = p_project_id
      and char_length(btrim(coalesce(s.body, ''))) > 0
      and char_length(btrim(s.body)) < v_median / 4;
    if v_items is not null then
      v_findings := v_findings || jsonb_build_object(
        'code', 'section_short', 'severity', 'info', 'count', jsonb_array_length(v_items), 'sections', v_items);
    end if;
  end if;

  -- Sources jamais citées.
  select jsonb_agg(s.id order by s.created_at, s.id) into v_items
  from public.project_sources s
  where s.project_id = p_project_id
    and not exists (select 1 from public.section_citations c where c.source_id = s.id);
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'source_never_cited', 'severity', 'info', 'count', jsonb_array_length(v_items), 'source_ids', v_items);
  end if;

  -- Citations sans page, là où la source a des pages.
  select jsonb_agg(jsonb_build_object('section_id', c.section_id, 'source_id', c.source_id)
                   order by t.position, c.source_id) into v_items
  from public.section_citations c
  join public.thesis_sections t on t.id = c.section_id
  join public.project_sources s on s.id = c.source_id
  where t.project_id = p_project_id
    and nullif(btrim(coalesce(c.pages, '')), '') is null
    and nullif(btrim(coalesce(s.pages, '')), '') is not null;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'citation_without_pages', 'severity', 'info', 'count', jsonb_array_length(v_items), 'citations', v_items);
  end if;

  -- Sources incomplètes pour la bibliographie : auteur, année ou titre manquant.
  select jsonb_agg(jsonb_build_object('id', q.id, 'missing', to_jsonb(q.missing)) order by q.created_at, q.id) into v_items
  from (
    select s.id, s.created_at, array_remove(array[
      case when cardinality(s.authors) = 0 then 'authors' end,
      case when s.publication_year is null then 'publication_year' end,
      case when nullif(btrim(coalesce(s.title, '')), '') is null then 'title' end
    ], null) as missing
    from public.project_sources s
    where s.project_id = p_project_id
  ) q
  where cardinality(q.missing) > 0;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'source_incomplete', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'sources', v_items);
  end if;

  -- Sources en double dans le projet : même DOI, ou même titre normalisé.
  select jsonb_agg(g.ids order by g.ids::text) into v_items
  from (
    select distinct q.ids
    from (
      select to_jsonb(array_agg(s.id order by s.id)) as ids
      from public.project_sources s
      where s.project_id = p_project_id and s.doi is not null
      group by lower(s.doi) having count(*) > 1
      union all
      select to_jsonb(array_agg(s.id order by s.id))
      from public.project_sources s
      where s.project_id = p_project_id and private.fold_text(s.title) <> ''
      group by private.fold_text(s.title) having count(*) > 1
    ) q
  ) g;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'source_duplicate', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'groups', v_items);
  end if;

  -- Lacunes de la littérature, d'après l'année des sources qui en ont une.
  select count(*), count(*) filter (where s.publication_year >= v_year - 5),
         count(*) filter (where s.publication_year < v_year - 10), max(s.publication_year)
  into v_with_year, v_recent, v_old, v_newest
  from public.project_sources s
  where s.project_id = p_project_id and s.publication_year is not null;
  if v_with_year > 0 and v_recent = 0 then
    v_findings := v_findings || jsonb_build_object(
      'code', 'literature_none_recent', 'severity', 'warning', 'count', v_with_year, 'newest_year', v_newest);
  end if;
  if v_with_year >= 4 and v_old * 4 > v_with_year * 3 then
    v_findings := v_findings || jsonb_build_object(
      'code', 'literature_mostly_old', 'severity', 'info', 'count', v_old, 'sources_with_year', v_with_year);
  end if;

  -- Sources citées sans fiche de lecture.
  select jsonb_agg(s.id order by s.created_at, s.id) into v_items
  from public.project_sources s
  where s.project_id = p_project_id
    and exists (select 1 from public.section_citations c where c.source_id = s.id)
    and not exists (
      select 1 from public.literature_notes n
      where n.source_id = s.id
        and btrim(concat(n.problem, n.concepts, n.method, n.population_field, n.results, n.limits,
                         n.useful_quote, n.project_link)) <> ''
    );
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'cited_source_without_note', 'severity', 'info', 'count', jsonb_array_length(v_items), 'source_ids', v_items);
  end if;

  return jsonb_build_object(
    'project_id', p_project_id,
    'role', v_role,
    'totals', jsonb_build_object(
      'sections', (select count(*) from public.thesis_sections s where s.project_id = p_project_id),
      'sources', (select count(*) from public.project_sources s where s.project_id = p_project_id),
      'citations', (select count(*) from public.section_citations c
                    join public.thesis_sections t on t.id = c.section_id where t.project_id = p_project_id),
      'tasks', (select count(*) from public.project_tasks t where t.project_id = p_project_id)
    ),
    'findings', v_findings
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Recommandations personnalisées
-- -----------------------------------------------------------------------------
-- Au plus vingt fiches PUBLIÉES ET PUBLIQUES — le prédicat de la recherche,
-- rien d'autre — choisies d'après les seules données de l'appelant : son profil
-- et, s'il désigne un de ses projets, les sources de ce projet. Aucun signal
-- ne vient d'un autre utilisateur. Rien n'est retenu de ce qui est recommandé.
-- Sont écartées : ses favoris, les fiches de ses collections, les fiches déjà
-- sources du projet désigné.
-- Vivier : les mille fiches les plus récemment publiées de la filière du profil
-- (et de celle du projet). Points, et raison rendue :
--   - `same_program`     +1 : filière du profil ;
--   - `same_subject`     +3 par matière du profil portée par la fiche (trois au plus) ;
--   - `same_level`       +2 : la fiche porte le niveau du profil ;
--   - `cited_authors`    +4 : un auteur de la fiche est l'auteur d'une source du projet ;
--   - `project_keywords` +2 par mot-clé ou matière partagé avec les fiches
--                           publiées déjà reprises comme sources du projet (trois au plus).
-- La fonction rend des identifiants : l'application lit ensuite les fiches
-- sous RLS, comme pour la recherche.
create function private.recommended_resources(p jsonb default '{}'::jsonb)
returns table (id uuid, score integer, reasons text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_profile public.profiles;
  v_project uuid;
  v_project_program text;
  v_keywords text[] := array[]::text[];
  v_project_subjects text[] := array[]::text[];
  v_authors text[] := array[]::text[];
begin
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) as k where k <> 'project_id') then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'project_id' and jsonb_typeof(p -> 'project_id') <> 'null' then
    if jsonb_typeof(p -> 'project_id') <> 'string'
       or (p ->> 'project_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    -- Le projet d'un autre, supprimé ou inexistant : même réponse.
    v_project := private.require_own_project((p ->> 'project_id')::uuid);
  end if;
  -- Soixante demandes par cinq minutes et par compte.
  perform private.consume_user_quota('recommendations', 60, 300);

  select * into v_profile from public.profiles f where f.user_id = v_uid;

  if v_project is not null then
    select r.program_code into v_project_program from public.research_projects r where r.id = v_project;
    -- Mots-clés et matières des fiches reprises comme sources, tant qu'elles
    -- sont toujours publiées et publiques.
    select coalesce(array_agg(distinct t.tag), array[]::text[]) into v_keywords
    from public.project_sources s
    join public.resources r on r.id = s.resource_id and r.editorial_status = 'published' and r.visibility = 'public'
    cross join lateral unnest(r.tags) as t (tag)
    where s.project_id = v_project;
    select coalesce(array_agg(distinct t.code), array[]::text[]) into v_project_subjects
    from public.project_sources s
    join public.resources r on r.id = s.resource_id and r.editorial_status = 'published' and r.visibility = 'public'
    cross join lateral unnest(r.subject_codes) as t (code)
    where s.project_id = v_project;
    select coalesce(array_agg(distinct private.fold_text(a.name)), array[]::text[]) into v_authors
    from public.project_sources s
    cross join lateral unnest(s.authors) as a (name)
    where s.project_id = v_project and private.fold_text(a.name) <> '';
  end if;

  return query
  with pool as materialized (
    select r.id, r.program_code, r.level_codes, r.subject_codes, r.tags, r.authors, r.published_at
    from public.resources r
    where r.editorial_status = 'published' and r.visibility = 'public'
      and r.program_code = any (array_remove(array[v_profile.program_code, v_project_program], null))
      and not exists (
        select 1 from public.resource_favorites f where f.user_id = v_uid and f.resource_id = r.id
      )
      and not exists (
        select 1 from public.collection_items i
        join public.collections c on c.id = i.collection_id
        where c.owner_id = v_uid and i.resource_id = r.id
      )
      and (v_project is null or not exists (
        select 1 from public.project_sources s where s.project_id = v_project and s.resource_id = r.id
      ))
    order by r.published_at desc, r.id
    limit 1000
  ),
  scored as (
    select q.id, q.published_at,
           (q.program_code = v_profile.program_code) as same_program,
           least((select count(*) from unnest(q.subject_codes) as u (code)
                  where u.code = any (v_profile.subject_codes)), 3)::integer as n_subjects,
           (v_profile.level_code is not null and v_profile.level_code = any (q.level_codes)) as same_level,
           exists (
             select 1 from unnest(q.authors) as a (name) where private.fold_text(a.name) = any (v_authors)
           ) as cited_authors,
           least((select count(*) from unnest(q.tags) as u (tag) where u.tag = any (v_keywords))
               + (select count(*) from unnest(q.subject_codes) as u (code) where u.code = any (v_project_subjects)),
                 3)::integer as n_keywords
    from pool q
  ),
  ranked as (
    select c.id, c.published_at,
           (case when c.same_program then 1 else 0 end + 3 * c.n_subjects
            + case when c.same_level then 2 else 0 end
            + case when c.cited_authors then 4 else 0 end + 2 * c.n_keywords) as points,
           array_remove(array[
             case when c.same_program then 'same_program' end,
             case when c.n_subjects > 0 then 'same_subject' end,
             case when c.same_level then 'same_level' end,
             case when c.cited_authors then 'cited_authors' end,
             case when c.n_keywords > 0 then 'project_keywords' end
           ], null) as why
    from scored c
  )
  select k.id, k.points, k.why
  from ranked k
  where k.points > 0
  order by k.points desc, k.published_at desc, k.id
  limit 20;
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées et droits
-- -----------------------------------------------------------------------------
create function public.similar_resources(resource_id uuid)
returns table (id uuid, title text, editorial_status text, reason text, score numeric, confidence text)
language sql security invoker set search_path = ''
as $$ select * from private.similar_resources(resource_id); $$;

create function public.suggest_resource_classification(resource_id uuid)
returns table (kind text, code text, labels jsonb, matched_words text[], confidence text)
language sql security invoker set search_path = ''
as $$ select * from private.suggest_resource_classification(resource_id); $$;

create function public.project_coherence_report(project_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.project_coherence_report(project_id); $$;

create function public.recommended_resources(payload jsonb default '{}'::jsonb)
returns table (id uuid, score integer, reasons text[])
language sql security invoker set search_path = ''
as $$ select * from private.recommended_resources(payload); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'similar_resources(uuid)',
    'suggest_resource_classification(uuid)',
    'project_coherence_report(uuid)',
    'recommended_resources(jsonb)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
