-- =============================================================================
-- Lot 5 (cahier §6.4) : le mémoire séparé de la thèse ; types réservés activés
-- =============================================================================
-- Le cahier distingue « Thèse » et « Mémoire ». Le catalogue n'avait qu'un type
-- `thesis` (« Thèse ou mémoire »), précisé par `thesis_degree`.
--
--   - nouveau type `memoir` (mémoire de licence ou de master) ; `thesis`
--     désigne désormais la thèse de doctorat ;
--   - `thesis_degree` est conservé (aucune colonne supprimée) et devient
--     cohérent avec le type : `doctorate` pour une thèse, `bachelor` ou
--     `master` pour un mémoire, rien pour les autres types (contrainte
--     `resources_thesis_degree_by_type`, qui remplace
--     `resources_thesis_degree_only_for_thesis`) ;
--   - données : les fiches `thesis` de niveau licence ou master deviennent
--     `memoir`, sans autre changement. Une fiche `thesis` sans niveau reste une
--     thèse : rien ne permet de deviner qu'elle était un mémoire. Ce
--     reclassement n'est pas une correction de la fiche : il ne s'inscrit pas
--     dans `edited_fields` (déclencheur suspendu le temps de la mise à jour) ;
--   - les sept codes réservés (chapitre, rapport, prépublication, annale,
--     documentation technique, jeu de données, présentation) sont activés ;
--   - `memoir`, comme `thesis`, `article` et `book`, ne se désactive pas : un
--     déclencheur le garantit sur tout chemin d'écriture (`protected_reference`) ;
--   - reprise d'une fiche dans un projet : un mémoire devient une source de type
--     `thesis` (« Thèse ou mémoire » en APA), un chapitre un `chapter`, un
--     rapport un `report` ; l'établissement est repris comme éditeur pour une
--     thèse, un mémoire ou un rapport.
--
-- Réversibilité (sans perte : le niveau est conservé sur chaque fiche) :
--   1. supprimer la contrainte resources_thesis_degree_by_type ;
--   2. update public.resources set type_code = 'thesis' where type_code = 'memoir'
--      (en suspendant resources_track_edited_fields) ;
--   3. rétablir resources_thesis_degree_only_for_thesis
--      (check (thesis_degree is null or type_code = 'thesis')) ;
--   4. désactiver memoir et les sept codes, remettre le libellé « Thèse ou
--      mémoire » / « Thesis or dissertation » de thesis ;
--   5. supprimer le déclencheur resource_types_protect_wired et sa fonction ;
--   6. rétablir private.add_project_source_from_resource de la migration
--      20261006002400.
-- Une fiche créée entre-temps avec un type nouvellement activé devra d'abord
-- être reclassée.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Référentiel des types
-- -----------------------------------------------------------------------------
insert into public.resource_types (code, labels, position, is_active) values
  ('memoir',
   jsonb_build_object('fr', 'Mémoire', 'en', 'Dissertation (bachelor''s or master''s)'),
   45, true);

update public.resource_types
set labels = jsonb_build_object('fr', 'Thèse', 'en', 'Doctoral thesis')
where code = 'thesis';

update public.resource_types
set is_active = true
where code in (
  'chapter', 'report', 'preprint', 'past_exam', 'technical_documentation', 'dataset', 'presentation'
);

-- Codes dont la base a besoin : ils ne se désactivent par aucun chemin.
create function private.protect_wired_resource_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active
     and old.code in ('thesis', 'memoir', 'article', 'book') then
    perform private.fail('protected_reference');
  end if;
  return new;
end
$$;
revoke all on function private.protect_wired_resource_types() from public, anon, authenticated, service_role;

create trigger resource_types_protect_wired
  before update of is_active on public.resource_types
  for each row execute function private.protect_wired_resource_types();

-- -----------------------------------------------------------------------------
-- 2. Niveau de diplôme cohérent avec le type, données reprises sans perte
-- -----------------------------------------------------------------------------
alter table public.resources drop constraint resources_thesis_degree_only_for_thesis;

alter table public.resources disable trigger resources_track_edited_fields;
update public.resources
set type_code = 'memoir'
where type_code = 'thesis' and thesis_degree in ('bachelor', 'master');
alter table public.resources enable trigger resources_track_edited_fields;

alter table public.resources
  add constraint resources_thesis_degree_by_type check (
    thesis_degree is null
    or (type_code = 'thesis' and thesis_degree = 'doctorate')
    or (type_code = 'memoir' and thesis_degree in ('bachelor', 'master'))
  );

comment on column public.resources.thesis_degree is
  'Diplôme préparé : doctorate pour une thèse ; bachelor ou master pour un mémoire ; null sinon.';

-- -----------------------------------------------------------------------------
-- 3. Reprise d'une fiche dans un projet
-- -----------------------------------------------------------------------------
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
      when 'chapter' then 'chapter'
      -- La bibliographie présente l'un et l'autre comme « Thèse ou mémoire ».
      when 'thesis' then 'thesis'
      when 'memoir' then 'thesis'
      when 'report' then 'report'
      else 'other'
    end,
    v_resource.title,
    v_resource.authors,
    v_resource.publication_year,
    -- L'institution d'une fiche est l'établissement de soutenance d'une thèse
    -- ou d'un mémoire, l'organisme auteur d'un rapport ; pour un article ou un
    -- livre, elle n'est pas l'éditeur : rien n'est repris.
    case when v_resource.type_code in ('thesis', 'memoir', 'report') then v_resource.institution_name end,
    v_resource.doi,
    -- Une adresse comportant un « @ » n'est pas reprise : la source ne l'admet pas.
    case when v_resource.official_url ~ '^https?://[^[:space:][:cntrl:]<>"@]+$' then v_resource.official_url end
  )
  returning id into v_id;
  return v_id;
end
$$;
