-- =============================================================================
-- D-20 : signaler les champs modifiés après un import par connecteur
-- =============================================================================
-- Une fiche importée dit d'où elle vient : sa provenance est vraie parce que le
-- navigateur n'en fournit jamais les métadonnées. Mais un modérateur peut
-- ensuite en corriger le titre, les auteurs ou la licence, et la fiche
-- continuait d'afficher la source comme si rien n'avait changé.
--
-- La base retient désormais quels champs repris de la source ont été modifiés
-- depuis l'import. Elle le fait elle-même, par déclencheur : quel que soit le
-- chemin de la modification, la liste est juste, et personne ne peut l'écrire
-- ni la vider. Elle ne dit pas ce qu'était la valeur d'origine.
--
-- Champs suivis, ceux que le connecteur reprend de la source : titre, auteurs,
-- année, type, langue, licence, lien officiel. Le statut d'accès, les niveaux,
-- les matières, les mots-clés et le résumé ne viennent jamais de la source :
-- les renseigner n'est pas la modifier.
--
-- Les fiches importées avant cette migration partent d'une liste vide : leurs
-- modifications antérieures ne sont pas connues.
--
-- Réversibilité : supprimer le déclencheur, la fonction, puis la colonne.
-- =============================================================================

alter table public.resources
  add column edited_fields text[] not null default '{}'
    constraint resources_edited_fields_check check (
      edited_fields <@ array['title', 'authors', 'publication_year', 'type_code',
                             'language_code', 'license_code', 'official_url']
    );
comment on column public.resources.edited_fields is
  'Champs repris d''une source par connecteur et modifiés depuis l''import. Tenu par déclencheur.';

-- Lisible avec la fiche. Le rôle serveur, qui écrit des fiches, a un droit de
-- table : le déclencheur écrase la valeur qu'il fournirait.
grant select (edited_fields) on public.resources to authenticated;

create function private.track_edited_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    new.edited_fields := '{}';
    return new;
  end if;
  -- Une valeur fournie est écrasée : la liste ne s'écrit ni ne se vide.
  v_fields := old.edited_fields;
  if old.source_kind = 'connector' then
    if new.title is distinct from old.title then v_fields := v_fields || 'title'::text; end if;
    if new.authors is distinct from old.authors then v_fields := v_fields || 'authors'::text; end if;
    if new.publication_year is distinct from old.publication_year then v_fields := v_fields || 'publication_year'::text; end if;
    if new.type_code is distinct from old.type_code then v_fields := v_fields || 'type_code'::text; end if;
    if new.language_code is distinct from old.language_code then v_fields := v_fields || 'language_code'::text; end if;
    if new.license_code is distinct from old.license_code then v_fields := v_fields || 'license_code'::text; end if;
    if new.official_url is distinct from old.official_url then v_fields := v_fields || 'official_url'::text; end if;
  end if;
  -- Sans doublon, dans un ordre fixe.
  new.edited_fields := coalesce((
    select array_agg(f.name order by f.position)
    from unnest(array['title', 'authors', 'publication_year', 'type_code',
                      'language_code', 'license_code', 'official_url']) with ordinality as f (name, position)
    where f.name = any (v_fields)
  ), '{}');
  return new;
end
$$;

revoke all on function private.track_edited_fields() from public, anon, authenticated, service_role;

create trigger resources_track_edited_fields
  before insert or update on public.resources
  for each row execute function private.track_edited_fields();
