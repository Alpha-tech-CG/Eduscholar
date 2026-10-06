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
    'public.must_keep_second_factor()',
    'public.account_deletion_check()',
    'public.second_factor_status()'
  ]) as x),
  'Les fonctions exécutables par authenticated sont celles attendues'
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
    'public.organizations UPDATE',
    'public.platform_roles DELETE',
    'public.platform_roles INSERT',
    'public.platform_roles UPDATE'
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

select * from finish();
rollback;
