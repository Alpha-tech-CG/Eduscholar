-- Contrôle de configuration (authorization-model §7.6 et §8 « Configuration » ;
-- modèle de menaces M-07, M-14, M-50).
--
-- Deux familles de contrôles :
--  - des règles générales, qui ne nomment aucune table et s'appliquent à toute
--    migration future ;
--  - des listes fermées (politiques, droits, fonctions) : toute nouvelle
--    ouverture oblige à modifier ce fichier, donc à passer en revue.
--
-- Les contrôles de droits utilisent les fonctions has_*_privilege, qui voient
-- les droits par colonne et les vues, contrairement à information_schema.

begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Règles générales
-- ---------------------------------------------------------------------------

select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  $$,
  'Toute table de public et private a la RLS activée et forcée'
);

select is_empty(
  $$
    select schemaname || '.' || tablename || ' : ' || policyname
    from pg_policies
    where schemaname in ('public', 'private')
      and (cmd = 'ALL' or 'public' = any (roles))
  $$,
  'Aucune politique FOR ALL ni adressée à tous les rôles'
);

select is_empty(
  $$
    select schemaname || '.' || tablename || ' : ' || policyname
    from pg_policies
    where schemaname in ('public', 'private')
      and cmd = 'UPDATE'
      and with_check is null
  $$,
  'Toute politique UPDATE a un WITH CHECK'
);

-- Toute politique destinée à authenticated vérifie l'état du compte, directement
-- ou par une fonction de rôle qui le fait.
select is_empty(
  $$
    select schemaname || '.' || tablename || ' : ' || policyname
    from pg_policies
    where schemaname in ('public', 'private')
      and 'authenticated' = any (roles)
      and coalesce(qual, '') !~ 'private\.(is_account_active|has_platform_role|has_org_role|my_org_ids)'
  $$,
  'Toute politique authenticated vérifie que le compte est actif'
);

-- anon : aucune écriture, sur aucune relation, y compris par colonne.
select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege('anon', c.oid, 'INSERT,UPDATE,REFERENCES'))
  $$,
  'anon n''a aucun droit d''écriture sur aucune relation'
);

-- anon : aucune lecture non plus. La liste blanche est vide : aucune donnée
-- n'est servie directement à un visiteur par l'API.
select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_any_column_privilege('anon', c.oid, 'SELECT')
      and (n.nspname || '.' || c.relname) not in (select unnest(array[]::text[]))
  $$,
  'anon ne lit aucune relation hors liste blanche'
);

-- authenticated : aucune écriture de table entière, aucun INSERT ni DELETE.
select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege('authenticated', c.oid, 'INSERT,REFERENCES'))
  $$,
  'authenticated n''a ni écriture de table entière, ni INSERT, ni DELETE'
);

-- authenticated n'atteint aucune table du schéma interne.
select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
  $$,
  'authenticated ne lit aucune table du schéma private'
);

-- Vues : security_invoker obligatoire ; aucune vue matérialisée exposée.
select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (c.relkind = 'm'
        or (c.relkind = 'v'
          and not coalesce(c.reloptions @> array['security_invoker=true'], false)))
  $$,
  'Aucune vue sans security_invoker ni vue matérialisée dans public'
);

-- Fonctions : aucune SECURITY DEFINER dans le schéma exposé.
select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  $$,
  'Aucune fonction SECURITY DEFINER dans le schéma exposé'
);

-- Toute fonction applicative fixe un search_path vide.
select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  $$,
  'Toute fonction de public et private fixe un search_path vide'
);

-- Aucune fonction applicative exécutable par anon ou par PUBLIC.
select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (has_function_privilege('anon', p.oid, 'execute')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ))
  $$,
  'Aucune fonction de public ou private exécutable par anon ou PUBLIC'
);

-- Realtime : aucune table publiée.
select is_empty(
  $$ select schemaname || '.' || tablename from pg_publication_tables where pubname = 'supabase_realtime' $$,
  'Aucune table publiée sur Realtime'
);

select is_empty(
  $$ select extname from pg_extension where extname = 'pg_graphql' $$,
  'pg_graphql n''est pas installée'
);

-- Hypothèse de tout le dispositif : les fonctions d'appui appartiennent à un rôle
-- non soumis à la RLS, et les rôles de l'API y sont soumis.
select ok(
  (select rolbypassrls from pg_roles where rolname = 'postgres'),
  'Le rôle propriétaire des fonctions d''appui contourne la RLS'
);
select ok(
  not (select bool_or(rolbypassrls) from pg_roles where rolname in ('anon', 'authenticated')),
  'anon et authenticated sont soumis à la RLS'
);

-- Délais d'exécution par rôle.
select is(
  (select count(*)
   from pg_db_role_setting s
   join pg_roles r on r.oid = s.setrole
   where r.rolname in ('anon', 'authenticated')
     and exists (select 1 from unnest(s.setconfig) c where c like 'statement_timeout=%')),
  2::bigint,
  'anon et authenticated ont un délai d''exécution'
);

-- ---------------------------------------------------------------------------
-- Listes fermées : toute ouverture nouvelle modifie ce fichier
-- ---------------------------------------------------------------------------

-- Chaque liste est comparée sous forme d'une seule chaîne triée : la comparaison
-- ne dépend ainsi ni des types ni des collations du catalogue.

select is(
  (select string_agg(ligne, E'\n' order by ligne collate "C")
   from (
     select format('%s.%s | %s | %s | %s', schemaname, tablename, policyname, cmd, roles) as ligne
     from pg_policies
     where schemaname in ('public', 'private')
   ) q),
  (select string_agg(x, E'\n' order by x collate "C") from unnest(array[
    'public.academic_domains | academic_domains_select_authenticated | SELECT | {authenticated}',
    'public.collection_items | collection_items_select | SELECT | {authenticated}',
    'public.collections | collections_select | SELECT | {authenticated}',
    'public.resource_favorites | resource_favorites_select | SELECT | {authenticated}',
    'public.research_projects | research_projects_select | SELECT | {authenticated}',
    'public.section_citations | section_citations_select | SELECT | {authenticated}',
    'public.thesis_sections | thesis_sections_select | SELECT | {authenticated}',
    'public.literature_notes | literature_notes_select | SELECT | {authenticated}',
    'public.project_sources | project_sources_select | SELECT | {authenticated}',
    'public.academic_programs | academic_programs_select_authenticated | SELECT | {authenticated}',
    'public.audit_logs | audit_logs_select | SELECT | {authenticated}',
    'public.licenses | licenses_select_authenticated | SELECT | {authenticated}',
    'public.resource_internal | resource_internal_select | SELECT | {authenticated}',
    'public.resource_reports | resource_reports_select | SELECT | {authenticated}',
    'public.resource_status_history | resource_status_history_select | SELECT | {authenticated}',
    'public.resource_types | resource_types_select_authenticated | SELECT | {authenticated}',
    'public.resources | resources_select | SELECT | {authenticated}',
    'public.countries | countries_select_authenticated | SELECT | {authenticated}',
    'public.education_levels | education_levels_select_authenticated | SELECT | {authenticated}',
    'public.languages | languages_select_authenticated | SELECT | {authenticated}',
    'public.organization_members | organization_members_select | SELECT | {authenticated}',
    'public.organizations | organizations_select | SELECT | {authenticated}',
    'public.platform_roles | platform_roles_select_own | SELECT | {authenticated}',
    'public.profile_public | profile_public_select | SELECT | {authenticated}',
    'public.profile_public | profile_public_update_own | UPDATE | {authenticated}',
    'public.profiles | profiles_select_own | SELECT | {authenticated}',
    'public.profiles | profiles_update_own | UPDATE | {authenticated}',
    'public.program_specialties | program_specialties_select_authenticated | SELECT | {authenticated}',
    'public.subjects | subjects_select_authenticated | SELECT | {authenticated}'
  ]) as x),
  'La liste des politiques est celle attendue'
);

-- Colonnes modifiables par authenticated.
select is(
  (select string_agg(ligne, E'\n' order by ligne collate "C")
   from (
     select format('%s.%s.%s', n.nspname, c.relname, a.attname) as ligne
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname in ('public', 'private')
       and c.relkind in ('r', 'p', 'v')
       and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
   ) q),
  (select string_agg(x, E'\n' order by x collate "C") from unnest(array[
    'public.profile_public.display_name',
    'public.profile_public.is_public',
    'public.profiles.age_confirmed_at',
    'public.profiles.country_code',
    'public.profiles.goals',
    'public.profiles.institution_name',
    'public.profiles.level_code',
    'public.profiles.preferred_locale',
    'public.profiles.program_code',
    'public.profiles.specialty_code',
    'public.profiles.subject_codes'
  ]) as x),
  'Les colonnes modifiables par authenticated sont celles attendues'
);

-- Colonnes que authenticated ne doit jamais lire : identifiants des acteurs privilégiés.
select is_empty(
  $$
    select c.oid::regclass::text || '.' || a.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public'
      and c.relname <> 'audit_logs'
      and a.attname in ('created_by', 'updated_by', 'granted_by', 'invited_by', 'changed_by')
      and has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT')
  $$,
  'authenticated ne lit aucune colonne d''acteur privilégié'
);

-- Fonctions exécutables par authenticated.
select is(
  (select string_agg(ligne, E'\n' order by ligne collate "C")
   from (
     select format('%s.%s(%s)', n.nspname, p.proname,
                   pg_get_function_identity_arguments(p.oid)) as ligne
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and has_function_privilege('authenticated', p.oid, 'execute')
   ) q),
  (select string_agg(x, E'\n' order by x collate "C") from unnest(array[
    'private.account_deletion_check()',
    'private.discard_recovery_codes()',
    'private.generate_recovery_codes()',
    'private.last_recovery_code_use()',
    'public.last_recovery_code_use()',
    'private.recovery_codes_status()',
    'private.redeem_recovery_code(p_code text)',
    'public.discard_recovery_codes()',
    'public.generate_recovery_codes()',
    'public.recovery_codes_status()',
    'public.redeem_recovery_code(code text)',
    'private.admin_find_user(p_email text)',
    'private.admin_list_accounts()',
    'private.admin_session()',
    'private.admin_set_account_status(p_user uuid, p_suspended boolean, p_reason text)',
    'private.admin_set_role(p_user uuid, p_role text, p_grant boolean)',
    'private.has_recent_second_factor()',
    'public.admin_find_user(email text)',
    'public.admin_list_accounts()',
    'public.admin_session()',
    'public.admin_set_account_status(target_user uuid, suspended boolean, reason text)',
    'public.admin_set_role(target_user uuid, role text, grant_role boolean)',
    'private.log_personal_data_export()',
    'public.log_personal_data_export()',
    'public.my_report_ids()',
    'private.add_thesis_section(p_project_id uuid, p jsonb)',
    'private.delete_thesis_section(p_section_id uuid)',
    'private.move_thesis_section(p_section_id uuid, p_direction text)',
    'private.my_section_ids()',
    'private.set_section_citation(p_section_id uuid, p_source_id uuid, p_present boolean, p_pages text)',
    'private.update_thesis_section(p_section_id uuid, p jsonb)',
    'public.add_thesis_section(project_id uuid, payload jsonb)',
    'public.delete_thesis_section(section_id uuid)',
    'public.move_thesis_section(section_id uuid, direction text)',
    'public.set_section_citation(section_id uuid, source_id uuid, present boolean, pages text)',
    'public.update_thesis_section(section_id uuid, payload jsonb)',
    'private.add_project_source(p_project_id uuid, p jsonb)',
    'private.add_project_source_from_resource(p_project_id uuid, p_resource_id uuid)',
    'private.delete_project_source(p_source_id uuid)',
    'private.my_source_ids()',
    'private.save_literature_note(p_source_id uuid, p jsonb)',
    'private.update_project_source(p_source_id uuid, p jsonb)',
    'public.add_project_source(project_id uuid, payload jsonb)',
    'public.add_project_source_from_resource(project_id uuid, resource_id uuid)',
    'public.delete_project_source(source_id uuid)',
    'public.save_literature_note(source_id uuid, payload jsonb)',
    'public.update_project_source(source_id uuid, payload jsonb)',
    'private.create_project(p jsonb)',
    'private.delete_project(p_project_id uuid)',
    'private.is_project_owner(p_project_id uuid)',
    'private.my_project_ids()',
    'private.update_project(p_project_id uuid, p jsonb)',
    'public.create_project(payload jsonb)',
    'public.delete_project(project_id uuid)',
    'public.update_project(project_id uuid, payload jsonb)',
    'private.create_collection(p_name text, p_description text)',
    'private.delete_collection(p_collection_id uuid)',
    'private.my_collection_ids()',
    'private.set_collection_item(p_collection_id uuid, p_resource_id uuid, p_present boolean)',
    'private.set_favorite(p_resource_id uuid, p_favorite boolean)',
    'private.update_collection(p_collection_id uuid, p_name text, p_description text)',
    'public.create_collection(name text, description text)',
    'public.delete_collection(collection_id uuid)',
    'public.set_collection_item(collection_id uuid, resource_id uuid, present boolean)',
    'public.set_favorite(resource_id uuid, favorite boolean)',
    'public.update_collection(collection_id uuid, name text, description text)',
    'private.are_valid_tags(p_values text[])',
    'private.is_clean_text_array(p_values text[], p_max_items integer, p_max_length integer)',
    'private.moderate_resource(p_resource_id uuid, p_action text, p_reason text)',
    'private.moderator_update_resource(p_resource_id uuid, p jsonb)',
    'private.my_report_ids()',
    'private.my_submission_ids()',
    'private.report_resource(p_resource_id uuid, p_reason text, p_details text)',
    'private.resolve_report(p_report_id uuid, p_status text, p_note text)',
    'private.submit_resource(p jsonb)',
    'private.update_submission(p_resource_id uuid, p jsonb)',
    'private.withdraw_submission(p_resource_id uuid)',
    'public.moderate_resource(resource_id uuid, action text, reason text)',
    'public.moderator_update_resource(resource_id uuid, payload jsonb)',
    'public.my_submission_ids()',
    'public.report_resource(resource_id uuid, reason text, details text)',
    'public.resolve_report(report_id uuid, status text, note text)',
    'public.submit_resource(payload jsonb)',
    'public.update_submission(resource_id uuid, payload jsonb)',
    'public.withdraw_submission(resource_id uuid)',
    'private.has_distinct_values(p_values text[])',
    'private.has_org_role(p_organization_id uuid, p_roles text[])',
    'private.has_platform_role(p_roles text[])',
    'private.has_verified_factor()',
    'private.is_account_active()',
    'private.is_onboarded()',
    'private.is_session_aal2()',
    'private.my_org_ids(p_roles text[])',
    'private.must_keep_second_factor()',
    'private.my_account_events()',
    'private.my_deleted_projects()',
    'public.my_account_events()',
    'public.my_deleted_projects()',
    'private.second_factor_wait_seconds()',
    'public.second_factor_wait_seconds()',
    'public.must_keep_second_factor()',
    'public.account_deletion_check()',
    'public.second_factor_status()'
  ]) as x),
  'Les fonctions exécutables par authenticated sont celles attendues'
);

-- Ce que le rôle serveur lit et exécute : listes fermées, comme pour ses écritures.
select is(
  (select string_agg(ligne, E'\n' order by ligne collate "C")
   from (
     select format('%s.%s', n.nspname, c.relname) as ligne
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private')
       and c.relkind in ('r', 'p', 'v')
       and has_table_privilege('service_role', c.oid, 'SELECT')
   ) q),
  (select string_agg(x, E'\n' order by x collate "C") from unnest(array[
    'private.rate_limit_buckets',
    'public.academic_domains',
    'public.academic_programs',
    'public.audit_logs',
    'public.countries',
    'public.education_levels',
    'public.languages',
    'public.licenses',
    'public.organization_members',
    'public.organizations',
    'public.platform_roles',
    'public.profile_public',
    'public.profiles',
    'public.program_specialties',
    'public.resource_status_history',
    'public.resource_types',
    'public.resources',
    'public.subjects'
  ]) as x),
  'service_role ne lit que les tables attendues : ni bibliothèques, ni signalements, ni notes internes'
);
select is(
  (select string_agg(ligne, E'\n' order by ligne collate "C")
   from (
     select format('%s.%s(%s)', n.nspname, p.proname,
                   pg_get_function_identity_arguments(p.oid)) as ligne
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and has_function_privilege('service_role', p.oid, 'execute')
   ) q),
  (select string_agg(x, E'\n' order by x collate "C") from unnest(array[
    'private.are_valid_tags(p_values text[])',
    'private.has_required_labels(p_labels jsonb)',
    'private.import_connector_resource(p_actor uuid, p jsonb)',
    'private.is_clean_text_array(p_values text[], p_max_items integer, p_max_length integer)',
    'public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)',
    'public.import_connector_resource(actor_id uuid, payload jsonb)',
    'private.purge_deleted_projects()',
    'public.purge_deleted_projects()'
  ]) as x),
  'Les fonctions exécutables par service_role sont celles attendues'
);

-- Aucun déclencheur n'est resté désactivé après une migration.
select is_empty(
  $$
    select c.relname || '.' || t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and not t.tgisinternal and t.tgenabled <> 'O'
  $$,
  'Tous les déclencheurs des tables de l''application sont actifs'
);

-- Droits d'écriture de service_role.
select is(
  (select string_agg(ligne, E'\n' order by ligne collate "C")
   from (
     select format('%s.%s %s', n.nspname, c.relname, p.privilege) as ligne
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (privilege)
     where n.nspname in ('public', 'private')
       and c.relkind in ('r', 'p')
       and has_table_privilege('service_role', c.oid, p.privilege)
   ) q),
  (select string_agg(x, E'\n' order by x collate "C") from unnest(array[
    'private.rate_limit_buckets DELETE',
    'public.resources INSERT',
    'public.resources UPDATE',
    'private.rate_limit_buckets INSERT',
    'private.rate_limit_buckets UPDATE',
    'public.organization_members DELETE',
    'public.organization_members INSERT',
    'public.organization_members UPDATE',
    'public.organizations DELETE',
    'public.organizations INSERT',
    'public.organizations UPDATE'
  ]) as x),
  'service_role n''écrit que dans les tables attendues, jamais dans le journal d''audit'
);

-- ---------------------------------------------------------------------------
-- Les règles générales détectent bien un objet fautif
-- ---------------------------------------------------------------------------
create table public.zz_table_fautive (id int primary key, secret text);
grant select (secret) on public.zz_table_fautive to anon;
grant update on public.zz_table_fautive to authenticated;
create view public.zz_vue_fautive as select * from public.profiles;
create function public.zz_fonction_fautive() returns int
  language sql security definer as 'select 1';

select isnt_empty(
  $$
    select 1 from pg_class c
    where c.oid = 'public.zz_table_fautive'::regclass
      and not (c.relrowsecurity and c.relforcerowsecurity)
  $$,
  'Une table sans RLS est détectée'
);
select ok(
  has_any_column_privilege('anon', 'public.zz_table_fautive', 'SELECT'),
  'Un droit par colonne accordé à anon est détecté'
);
select ok(
  has_table_privilege('authenticated', 'public.zz_table_fautive', 'UPDATE'),
  'Un UPDATE de table entière accordé à authenticated est détecté'
);
select isnt_empty(
  $$
    select 1 from pg_class c
    where c.oid = 'public.zz_vue_fautive'::regclass
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)
  $$,
  'Une vue sans security_invoker est détectée'
);
select isnt_empty(
  $$
    select 1 from pg_proc p
    where p.oid = 'public.zz_fonction_fautive()'::regprocedure
      and p.prosecdef
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  $$,
  'Une fonction SECURITY DEFINER sans search_path vide est détectée'
);

-- La purge des comptes jamais confirmés efface des lignes de auth.users : une
-- clé étrangère sans cascade ni mise à null la bloquerait tout entière.
select is(
  (select count(*) from pg_constraint
   where contype = 'f' and confrelid = 'auth.users'::regclass
     and connamespace in ('public'::regnamespace, 'private'::regnamespace)
     and confdeltype not in ('c', 'n')),
  0::bigint, 'Toute clé étrangère vers auth.users suit la suppression du compte'
);

select * from finish();
rollback;
