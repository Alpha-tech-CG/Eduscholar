-- =============================================================================
-- B-13 — Catalogue des ressources
--
-- Références : cahier §6.4, §6.6, §7 ; authorization-model §4 (classes B, C, D)
-- et §5.1 ; docs/product/content-and-licensing-policy.md ; taxonomy-pilot §7 à §9 ;
-- modèle de menaces M-17, M-18, M-25, M-27.
--
-- Principes :
--  - une ressource n'est publiée que si sa provenance, sa licence, son statut
--    d'accès, son lien officiel et sa date de vérification sont renseignés :
--    c'est une contrainte de la table ;
--  - le statut d'accès et la licence sont deux colonnes distinctes ;
--  - aucune écriture directe par un utilisateur : soumission, modification,
--    modération et signalement passent par des fonctions nommées (migration
--    suivante), qui appliquent la règle et écrivent l'historique ;
--  - l'identité du contributeur, les notes de modération et la preuve
--    d'autorisation ne sont pas lisibles par les autres utilisateurs.
--
-- Écart assumé avec le cahier §6.4 : deux statuts éditoriaux sont ajoutés,
-- « changes_requested » (demande de correction, prévue par le pipeline du §6.6)
-- et « removed » (retrait définitif, que le cahier range dans les statuts d'accès).
--
-- Réversibilité : supprimer les tables resource_reports, resource_status_history,
-- resource_internal, resources, puis resource_types et licenses.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Référentiels : licences et types de ressources
-- -----------------------------------------------------------------------------
create table public.licenses (
  code text primary key
    constraint licenses_code_format check (code ~ '^[a-z0-9][a-z0-9.-]{1,49}$'),
  labels jsonb not null
    constraint licenses_labels_check check (private.has_required_labels(labels)),
  -- Ce que la licence permet à la plateforme. « review » : à analyser, donc non.
  can_host text not null
    constraint licenses_can_host_check check (can_host in ('yes', 'no', 'review')),
  can_redistribute text not null
    constraint licenses_can_redistribute_check check (can_redistribute in ('yes', 'no', 'review')),
  allows_commercial_use boolean not null default false,
  requires_attribution boolean not null default true,
  position integer not null default 0,
  is_active boolean not null default true
);
comment on table public.licenses is
  'Licences et ce qu''elles permettent à la plateforme. Aide à la décision, pas un avis juridique.';

create table public.resource_types (
  code text primary key
    constraint resource_types_code_format check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  labels jsonb not null
    constraint resource_types_labels_check check (private.has_required_labels(labels)),
  position integer not null default 0,
  is_active boolean not null default true
);

create trigger licenses_prevent_key_change before update on public.licenses
  for each row execute function private.prevent_key_change('code');
create trigger resource_types_prevent_key_change before update on public.resource_types
  for each row execute function private.prevent_key_change('code');

insert into public.licenses
  (code, labels, can_host, can_redistribute, allows_commercial_use, requires_attribution, position)
values
  ('cc0-1.0', jsonb_build_object('fr', 'CC0 1.0', 'en', 'CC0 1.0'), 'yes', 'yes', true, false, 10),
  ('public-domain', jsonb_build_object('fr', 'Domaine public', 'en', 'Public domain'), 'yes', 'yes', true, false, 20),
  ('cc-by-4.0', jsonb_build_object('fr', 'CC BY 4.0', 'en', 'CC BY 4.0'), 'yes', 'yes', true, true, 30),
  ('cc-by-sa-4.0', jsonb_build_object('fr', 'CC BY-SA 4.0', 'en', 'CC BY-SA 4.0'), 'yes', 'yes', true, true, 40),
  ('cc-by-nd-4.0', jsonb_build_object('fr', 'CC BY-ND 4.0', 'en', 'CC BY-ND 4.0'), 'yes', 'yes', true, true, 50),
  ('cc-by-nc-4.0', jsonb_build_object('fr', 'CC BY-NC 4.0', 'en', 'CC BY-NC 4.0'), 'review', 'review', false, true, 60),
  ('cc-by-nc-sa-4.0', jsonb_build_object('fr', 'CC BY-NC-SA 4.0', 'en', 'CC BY-NC-SA 4.0'), 'review', 'review', false, true, 70),
  ('cc-by-nc-nd-4.0', jsonb_build_object('fr', 'CC BY-NC-ND 4.0', 'en', 'CC BY-NC-ND 4.0'), 'review', 'review', false, true, 80),
  ('author-permission', jsonb_build_object('fr', 'Autorisation écrite de l''ayant droit', 'en', 'Written permission from the rights holder'), 'review', 'review', false, true, 90),
  ('all-rights-reserved', jsonb_build_object('fr', 'Tous droits réservés', 'en', 'All rights reserved'), 'no', 'no', false, true, 100),
  ('unknown', jsonb_build_object('fr', 'Licence inconnue', 'en', 'Unknown licence'), 'no', 'no', false, true, 110);

insert into public.resource_types (code, labels, position, is_active) values
  ('course', jsonb_build_object('fr', 'Cours', 'en', 'Course'), 10, true),
  ('article', jsonb_build_object('fr', 'Article', 'en', 'Article'), 20, true),
  ('book', jsonb_build_object('fr', 'Livre', 'en', 'Book'), 30, true),
  ('thesis', jsonb_build_object('fr', 'Thèse ou mémoire', 'en', 'Thesis or dissertation'), 40, true),
  ('video', jsonb_build_object('fr', 'Vidéo', 'en', 'Video'), 50, true),
  ('exercise', jsonb_build_object('fr', 'Exercice', 'en', 'Exercise'), 60, true),
  -- Codes réservés, activés avec les phases suivantes.
  ('chapter', jsonb_build_object('fr', 'Chapitre', 'en', 'Chapter'), 70, false),
  ('report', jsonb_build_object('fr', 'Rapport', 'en', 'Report'), 80, false),
  ('preprint', jsonb_build_object('fr', 'Prépublication', 'en', 'Preprint'), 90, false),
  ('past_exam', jsonb_build_object('fr', 'Annale', 'en', 'Past exam'), 100, false),
  ('technical_documentation', jsonb_build_object('fr', 'Documentation technique', 'en', 'Technical documentation'), 110, false),
  ('dataset', jsonb_build_object('fr', 'Jeu de données', 'en', 'Dataset'), 120, false),
  ('presentation', jsonb_build_object('fr', 'Présentation', 'en', 'Presentation'), 130, false);

-- -----------------------------------------------------------------------------
-- 2. Fonctions de contrôle des tableaux de texte (utilisées par des CHECK)
-- -----------------------------------------------------------------------------
-- Chaque élément : non nul, sans caractère de contrôle, longueur bornée après
-- retrait des espaces ; pas de doublon.
create function private.is_clean_text_array(p_values text[], p_max_items integer, p_max_length integer)
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
    )
    and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as u (v));
$$;

-- Mots-clés : minuscules, chiffres, lettres accentuées, espaces et tirets.
create function private.are_valid_tags(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.is_clean_text_array(p_values, 20, 40)
    and not exists (
      select 1
      from unnest(p_values) as u (v)
      -- Classes écrites en clair : [[:alnum:]] dépend de la locale de la base.
      where v <> lower(v) or v !~ '^[a-z0-9à-öø-ÿ][a-z0-9à-öø-ÿ +#.-]*$'
    );
$$;

revoke all on function private.is_clean_text_array(text[], integer, integer) from public, anon;
revoke all on function private.are_valid_tags(text[]) from public, anon;
-- Les contraintes sont évaluées avec les droits du rôle qui écrit.
grant execute on function private.is_clean_text_array(text[], integer, integer) to authenticated, service_role;
grant execute on function private.are_valid_tags(text[]) to authenticated, service_role;
grant execute on function private.has_required_labels(jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Ressources
-- -----------------------------------------------------------------------------
create table public.resources (
  id uuid primary key default gen_random_uuid(),

  -- Description
  type_code text not null references public.resource_types (code) on update restrict on delete restrict,
  title text not null
    constraint resources_title_check
      check (char_length(title) <= 500 and char_length(btrim(title)) >= 3 and title !~ '[[:cntrl:]]'),
  abstract text
    constraint resources_abstract_check
      check (abstract is null
             or (char_length(abstract) <= 5000
                 -- Les sauts de ligne sont admis, pas les autres caractères de contrôle.
                 and abstract !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]')),
  authors text[] not null default '{}'
    constraint resources_authors_check check (private.is_clean_text_array(authors, 50, 200)),
  institution_name text
    constraint resources_institution_name_check
      check (institution_name is null
             or (char_length(institution_name) <= 200
                 and char_length(btrim(institution_name)) >= 2
                 and institution_name !~ '[[:cntrl:]]')),
  publication_year smallint
    constraint resources_publication_year_check check (publication_year between 1400 and 2100),
  thesis_degree text
    constraint resources_thesis_degree_check
      check (thesis_degree is null or thesis_degree in ('bachelor', 'master', 'doctorate')),

  -- Classement
  language_code text not null references public.languages (code) on update restrict on delete restrict,
  country_code text references public.countries (code) on update restrict on delete restrict,
  program_code text not null references public.academic_programs (code) on update restrict on delete restrict,
  level_codes text[] not null default '{}'
    constraint resources_level_codes_check check (private.is_clean_text_array(level_codes, 12, 50)),
  subject_codes text[] not null default '{}'
    constraint resources_subject_codes_check check (private.is_clean_text_array(subject_codes, 40, 50)),
  tags text[] not null default '{}'
    constraint resources_tags_check check (private.are_valid_tags(tags)),

  -- Identification et accès
  doi text
    constraint resources_doi_check
      check (doi is null or (char_length(doi) <= 255 and doi ~ '^10\.[0-9]{4,9}/[^[:space:][:cntrl:]]+$')),
  official_url text
    constraint resources_official_url_check
      check (official_url is null
             or (char_length(official_url) <= 2000
                 -- Schémas http et https uniquement (modèle de menaces M-18).
                 and official_url ~ '^https?://[^[:space:][:cntrl:]<>"]+$')),
  access_status text not null default 'unknown'
    constraint resources_access_status_check
      check (access_status in (
        'open_access', 'free_link', 'preview_only', 'institutional_access', 'paid', 'unknown', 'removed'
      )),
  license_code text not null default 'unknown'
    references public.licenses (code) on update restrict on delete restrict,

  -- Provenance (obligatoire) : d'où vient la fiche.
  source_kind text not null
    constraint resources_source_kind_check
      check (source_kind in ('connector', 'organization', 'contribution')),
  source_name text not null
    constraint resources_source_name_check
      check (char_length(btrim(source_name)) between 2 and 120 and source_name !~ '[[:cntrl:]]'),
  source_identifier text
    constraint resources_source_identifier_check
      check (source_identifier is null
             or (char_length(source_identifier) between 1 and 300 and source_identifier !~ '[[:cntrl:]]')),
  retrieved_at timestamptz,
  last_verified_at timestamptz,

  -- Cycle de vie
  editorial_status text not null default 'pending'
    constraint resources_editorial_status_check
      check (editorial_status in (
        'pending', 'under_review', 'changes_requested', 'verified',
        'published', 'rejected', 'suspended', 'removed'
      )),
  visibility text not null default 'public'
    constraint resources_visibility_check check (visibility in ('public', 'organization')),
  organization_id uuid references public.organizations (id) on delete restrict,
  -- Identité du contributeur : non lisible par les autres utilisateurs.
  submitted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,

  constraint resources_organization_visibility_check
    check (visibility = 'public' or organization_id is not null),
  constraint resources_thesis_degree_only_for_thesis
    check (thesis_degree is null or type_code = 'thesis'),
  -- Règle centrale : rien n'est publié sans provenance, licence, statut d'accès,
  -- lien officiel, date de vérification et au moins un auteur ou une institution.
  constraint resources_publishable_check
    check (
      editorial_status not in ('verified', 'published')
      or (official_url is not null
          and last_verified_at is not null
          and access_status not in ('removed')
          and (cardinality(authors) > 0 or institution_name is not null))
    )
);

comment on table public.resources is
  'Fiches du catalogue. Aucun fichier n''est hébergé à ce stade : la fiche renvoie vers la source officielle.';
comment on column public.resources.access_status is
  'Statut d''accès au document. Distinct de la licence : gratuit ne veut pas dire libre.';
comment on column public.resources.submitted_by is
  'Contributeur. Colonne non accordée en lecture aux utilisateurs.';

-- Dédoublonnage : un DOI ne figure qu'une fois parmi les fiches vivantes.
create unique index resources_doi_unique_idx
  on public.resources (lower(doi))
  where doi is not null and editorial_status not in ('rejected', 'removed');
-- Import idempotent : une même entrée d'une même source n'est créée qu'une fois.
create unique index resources_source_unique_idx
  on public.resources (source_name, source_identifier)
  where source_identifier is not null;
create index resources_editorial_status_idx on public.resources (editorial_status, created_at);
create index resources_published_idx
  on public.resources (program_code, type_code, language_code)
  where editorial_status = 'published' and visibility = 'public';
create index resources_submitted_by_idx on public.resources (submitted_by) where submitted_by is not null;
create index resources_organization_id_idx on public.resources (organization_id) where organization_id is not null;
create index resources_subject_codes_idx on public.resources using gin (subject_codes);
create index resources_tags_idx on public.resources using gin (tags);

-- Notes internes : jamais lisibles par le contributeur ni par le public.
create table public.resource_internal (
  resource_id uuid primary key references public.resources (id) on delete cascade,
  contributor_comment text
    constraint resource_internal_contributor_comment_check
      check (contributor_comment is null or char_length(contributor_comment) <= 2000),
  permission_proof text
    constraint resource_internal_permission_proof_check
      check (permission_proof is null or char_length(permission_proof) <= 2000),
  rights_declared_at timestamptz,
  moderation_notes text
    constraint resource_internal_moderation_notes_check
      check (moderation_notes is null or char_length(moderation_notes) <= 5000)
);
comment on table public.resource_internal is
  'Preuve d''autorisation, déclaration de droits du contributeur et notes de modération.';

-- Historique des décisions (cahier §7.3) : en ajout seul.
create table public.resource_status_history (
  id bigint generated always as identity primary key,
  resource_id uuid not null references public.resources (id) on delete cascade,
  from_status text,
  to_status text not null,
  action text not null,
  -- Motif communiqué au contributeur.
  reason text
    constraint resource_status_history_reason_check
      check (reason is null or char_length(reason) <= 2000),
  -- Auteur de la décision : non lisible par les utilisateurs.
  actor_id uuid,
  occurred_at timestamptz not null default now()
);
create index resource_status_history_resource_idx
  on public.resource_status_history (resource_id, occurred_at desc);

create trigger resource_status_history_append_only
  before update or delete on public.resource_status_history
  for each row execute function private.reject_audit_change();

-- Signalements.
create table public.resource_reports (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  -- Identité du signaleur : non lisible, y compris par l'organisation visée.
  reporter_id uuid references auth.users (id) on delete set null,
  reason text not null
    constraint resource_reports_reason_check
      check (reason in (
        'copyright', 'privacy', 'error', 'broken_link', 'inappropriate', 'malware', 'other'
      )),
  details text
    constraint resource_reports_details_check
      check (details is null or char_length(details) <= 2000),
  status text not null default 'open'
    constraint resource_reports_status_check check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text
    constraint resource_reports_resolution_note_check
      check (resolution_note is null or char_length(resolution_note) <= 2000),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index resource_reports_status_idx on public.resource_reports (status, created_at);
create index resource_reports_resource_idx on public.resource_reports (resource_id);
-- Un seul signalement ouvert par personne et par ressource.
create unique index resource_reports_one_open_per_reporter_idx
  on public.resource_reports (resource_id, reporter_id)
  where status = 'open' and reporter_id is not null;

-- -----------------------------------------------------------------------------
-- 4. Déclencheurs
-- -----------------------------------------------------------------------------
create trigger resources_set_updated_at
  before update on public.resources
  for each row execute function private.set_updated_at();
create trigger resources_prevent_key_change
  before update on public.resources
  for each row execute function private.prevent_key_change('id', 'created_at');

-- Valeurs de référentiel : existantes et actives, niveaux et matières compris.
create function private.validate_resource_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.type_code is distinct from old.type_code)
     and not exists (
       select 1 from public.resource_types t where t.code = new.type_code and t.is_active
     ) then
    raise exception 'invalid_type' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.license_code is distinct from old.license_code)
     and not exists (
       select 1 from public.licenses l where l.code = new.license_code and l.is_active
     ) then
    raise exception 'invalid_license' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.language_code is distinct from old.language_code)
     and not exists (
       select 1 from public.languages l where l.code = new.language_code and l.is_active
     ) then
    raise exception 'invalid_language' using errcode = '23514';
  end if;

  if new.country_code is not null
     and (tg_op = 'INSERT' or new.country_code is distinct from old.country_code)
     and not exists (
       select 1 from public.countries c where c.code = new.country_code and c.is_active
     ) then
    raise exception 'invalid_country' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.program_code is distinct from old.program_code)
     and not exists (
       select 1 from public.academic_programs p where p.code = new.program_code and p.is_active
     ) then
    raise exception 'invalid_program' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(new.level_codes) as u (code)
    where not exists (
      select 1 from public.education_levels l where l.code = u.code and l.is_active
    )
  ) then
    raise exception 'invalid_level' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(new.subject_codes) as u (code)
    where not exists (
      select 1
      from public.subjects s
      where s.program_code = new.program_code and s.code = u.code and s.is_active
    )
  ) then
    raise exception 'invalid_subject' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger resources_validate_references
  before insert or update on public.resources
  for each row execute function private.validate_resource_references();

-- Un import par connecteur ou par le serveur n'aboutit jamais au-delà du statut
-- « pending » : rien n'est publié sans modération (cahier §7.2, M-27). Le
-- statut ne change ensuite que par les fonctions de transition, exécutées
-- sous la session d'un utilisateur.
create function private.guard_resource_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if ((select auth.jwt()) ->> 'role') = 'service_role' then
    if tg_op = 'INSERT' and new.editorial_status <> 'pending' then
      raise exception 'import_must_be_pending' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.editorial_status is distinct from old.editorial_status then
      raise exception 'status_change_requires_moderation' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger resources_guard_status
  before insert or update on public.resources
  for each row execute function private.guard_resource_status();

-- -----------------------------------------------------------------------------
-- 5. Droits
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'licenses', 'resource_types', 'resources', 'resource_internal',
    'resource_status_history', 'resource_reports'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated, service_role', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
  end loop;
end
$$;

grant select on public.licenses, public.resource_types to authenticated, service_role;

-- Toutes les colonnes d'une fiche sauf l'identité du contributeur.
grant select (
  id, type_code, title, abstract, authors, institution_name, publication_year, thesis_degree,
  language_code, country_code, program_code, level_codes, subject_codes, tags,
  doi, official_url, access_status, license_code,
  source_kind, source_name, source_identifier, retrieved_at, last_verified_at,
  editorial_status, visibility, organization_id, created_at, updated_at, published_at
) on public.resources to authenticated;

grant select (resource_id, contributor_comment, permission_proof, rights_declared_at, moderation_notes)
  on public.resource_internal to authenticated;

-- Sans l'auteur de la décision.
grant select (id, resource_id, from_status, to_status, action, reason, occurred_at)
  on public.resource_status_history to authenticated;

-- Sans l'identité du signaleur ni celle du modérateur.
grant select (id, resource_id, reason, details, status, resolution_note, handled_at, created_at)
  on public.resource_reports to authenticated;

-- Import par connecteur (authorization-model §7.5) : création et mise à jour
-- des fiches, jamais leur statut (déclencheur ci-dessus), jamais leur suppression.
grant select, insert, update on public.resources to service_role;
grant select on public.resource_status_history to service_role;

-- -----------------------------------------------------------------------------
-- 6. Politiques de lecture
-- -----------------------------------------------------------------------------
create policy licenses_select_authenticated on public.licenses
  for select to authenticated
  using (is_active and (select private.is_account_active()));

create policy resource_types_select_authenticated on public.resource_types
  for select to authenticated
  using (is_active and (select private.is_account_active()));

-- authorization-model §5.1, lignes 3 à 5.
create policy resources_select on public.resources
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      -- Fiche publiée, publique.
      (editorial_status = 'published' and visibility = 'public')
      -- Fiche publiée, réservée à une organisation dont on est membre.
      or (editorial_status = 'published'
          and visibility = 'organization'
          and organization_id in (
            select private.my_org_ids(array['org_admin', 'librarian', 'teacher', 'member'])
          ))
      -- Sa propre soumission, quel que soit son statut.
      or submitted_by = (select auth.uid())
      -- Modération : les fiches publiques, à tout statut.
      or (visibility = 'public' and (select private.has_platform_role(array['moderator'])))
      -- Catalogue institutionnel : ceux qui le gèrent.
      or (visibility = 'organization'
          and organization_id in (select private.my_org_ids(array['org_admin', 'librarian'])))
    )
  );

-- Notes internes : la modération seulement, pour les fiches publiques.
create policy resource_internal_select on public.resource_internal
  for select to authenticated
  using (
    (select private.has_platform_role(array['moderator']))
    and exists (
      select 1 from public.resources r
      where r.id = resource_internal.resource_id and r.visibility = 'public'
    )
  );

-- Historique : le contributeur lit les décisions sur sa soumission ; la modération lit tout.
create policy resource_status_history_select on public.resource_status_history
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      (select private.has_platform_role(array['moderator']))
      or exists (
        select 1 from public.resources r
        where r.id = resource_status_history.resource_id
          and r.submitted_by = (select auth.uid())
      )
    )
  );

-- Signalements : le sien ; tous pour la modération.
create policy resource_reports_select on public.resource_reports
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      reporter_id = (select auth.uid())
      or (select private.has_platform_role(array['moderator']))
    )
  );
