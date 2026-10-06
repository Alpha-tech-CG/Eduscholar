-- =============================================================================
-- B-16 : découpage des mots de l'index de recherche
-- =============================================================================
-- L'analyseur de PostgreSQL garde en un seul mot certaines suites : un nombre
-- signé (« -223772 »), un mot composé (« pare-feu »), un nom d'hôte, une
-- version (« 2.1 »). L'application, elle, cherche mot par mot, en ne gardant
-- que lettres et chiffres : « 223772 » ne trouvait pas « -223772 ».
--
-- La ponctuation qui soude ces suites est donc remplacée par des espaces avant
-- l'indexation, pour que l'index et la requête découpent de la même façon.
--
-- Réversibilité : rétablir la définition de la migration 001700 et recalculer.
-- =============================================================================

create or replace function private.resource_search_vector(
  p_title text, p_authors text[], p_tags text[], p_institution text, p_abstract text
)
returns tsvector
language sql
stable
set search_path = ''
as $$
  with parts as (
    select
      coalesce(p_title, '') as title,
      array_to_string(coalesce(p_authors, '{}'), ' ') || ' '
        || array_to_string(coalesce(p_tags, '{}'), ' ') || ' '
        || coalesce(p_institution, '') as names,
      coalesce(p_abstract, '') as abstract
  )
  select
    setweight(to_tsvector('simple'::regconfig, regexp_replace(
      extensions.unaccent('extensions.unaccent'::regdictionary, title), '[-+._/@:''’]+', ' ', 'g')), 'A')
    || setweight(to_tsvector('simple'::regconfig, regexp_replace(
      extensions.unaccent('extensions.unaccent'::regdictionary, names), '[-+._/@:''’]+', ' ', 'g')), 'B')
    || setweight(to_tsvector('simple'::regconfig, regexp_replace(
      extensions.unaccent('extensions.unaccent'::regdictionary, abstract), '[-+._/@:''’]+', ' ', 'g')), 'C')
  from parts;
$$;

-- Recalcul des fiches existantes, sans toucher à leur date de modification.
alter table public.resources disable trigger resources_set_updated_at;
update public.resources
  set search_vector = private.resource_search_vector(title, authors, tags, institution_name, abstract);
alter table public.resources enable trigger resources_set_updated_at;
