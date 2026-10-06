-- =============================================================================
-- B-16 : recherche dans le catalogue
-- =============================================================================
-- Une colonne d'index plein texte, tenue par un déclencheur : titre (poids A),
-- auteurs, mots-clés et institution (poids B), résumé (poids C). Les accents
-- sont retirés, pour que « securite » trouve « Sécurité ». Aucune analyse
-- linguistique : le catalogue est multilingue, et l'application cherche par
-- début de mot.
--
-- La recherche se fait sous la session de l'utilisateur, par l'API : la RLS
-- décide de ce qu'il voit. Aucune fonction privilégiée n'est ajoutée.
--
-- Réversibilité : supprimer le déclencheur, la fonction, l'index et la colonne.
-- =============================================================================

create extension if not exists unaccent with schema extensions;

alter table public.resources add column search_vector tsvector;

comment on column public.resources.search_vector is
  'Index plein texte dérivé du titre, des auteurs, des mots-clés, de l''institution et du résumé. Tenu par déclencheur.';

create function private.resource_search_vector(
  p_title text, p_authors text[], p_tags text[], p_institution text, p_abstract text
)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select
    setweight(to_tsvector('simple'::regconfig,
      extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_title, ''))), 'A')
    || setweight(to_tsvector('simple'::regconfig,
      extensions.unaccent('extensions.unaccent'::regdictionary,
        array_to_string(coalesce(p_authors, '{}'), ' ') || ' '
        || array_to_string(coalesce(p_tags, '{}'), ' ') || ' '
        || coalesce(p_institution, ''))), 'B')
    || setweight(to_tsvector('simple'::regconfig,
      extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_abstract, ''))), 'C');
$$;

create function private.set_resource_search_vector()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.search_vector := private.resource_search_vector(
    new.title, new.authors, new.tags, new.institution_name, new.abstract
  );
  return new;
end
$$;

revoke all on function private.resource_search_vector(text, text[], text[], text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.set_resource_search_vector()
  from public, anon, authenticated, service_role;

-- La colonne ne s'écrit que par ce déclencheur : une valeur fournie est écrasée.
create trigger resources_set_search_vector
  before insert or update on public.resources
  for each row execute function private.set_resource_search_vector();

-- Fiches existantes, sans toucher à leur date de modification. Seul ce
-- déclencheur est suspendu : les gardes de la table restent actives.
alter table public.resources disable trigger resources_set_updated_at;
update public.resources
  set search_vector = private.resource_search_vector(title, authors, tags, institution_name, abstract);
alter table public.resources enable trigger resources_set_updated_at;

create index resources_search_vector_idx on public.resources using gin (search_vector);

-- Dérivée de champs déjà lisibles : la lire n'apprend rien de plus.
grant select (search_vector) on public.resources to authenticated;
