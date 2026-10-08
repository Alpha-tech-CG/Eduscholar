-- F-03 : administration des référentiels par la plateforme.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid, p_aal text default 'aal1', p_totp_age integer default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
      'amr', case when p_totp_age is null
        then jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
        else jsonb_build_array(
          jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - p_totp_age - 60),
          jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_totp_age))
      end
    )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- P administrateur de plateforme ; U utilisateur avec second facteur ;
-- M modératrice ; X étudiante au profil complété ; Y étudiant au profil complété.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('b0000000-0000-0000-0000-000000007601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref-p@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000007602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref-u@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000007603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref-m@test.invalid', now()),
  ('e0000000-0000-0000-0000-000000007604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref-x@test.invalid', now()),
  ('e1000000-0000-0000-0000-000000007605', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref-y@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000760_';
update public.profiles
  set specialty_code = 'software_engineering', subject_codes = array['algorithms', 'data_structures']
  where user_id = 'e0000000-0000-0000-0000-000000007604';
update public.profiles set level_code = 'master_1' where user_id = 'e1000000-0000-0000-0000-000000007605';

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select ('fa000000-0000-0000-0000-00000000' || right(id::text, 4))::uuid, id, 'test', 'totp', 'verified',
       now() - interval '1 day', now(), 'secret-de-test'
from auth.users
where email in ('ref-p@test.invalid', 'ref-u@test.invalid', 'ref-m@test.invalid');
insert into public.platform_roles (user_id, role) values
  ('b0000000-0000-0000-0000-000000007601', 'platform_admin'),
  ('c0000000-0000-0000-0000-000000007603', 'moderator');

-- Deux fiches : l'une porte un niveau et une matière, l'autre est une vidéo.
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, level_codes, subject_codes,
   source_kind, source_name, official_url, access_status, editorial_status, visibility)
values
  ('76000000-0000-0000-0000-000000000001', 'article', 'Fiche du test 76', array['Awa Diop'], '{}', 'fr',
   'computer_science', array['bachelor_3'], array['algorithms'], 'connector', 'test',
   'https://exemple.invalid/r76-1', 'open_access', 'pending', 'public'),
  ('76000000-0000-0000-0000-000000000002', 'video', 'Vidéo du test 76', array['Awa Diop'], '{}', 'fr',
   'computer_science', '{}', '{}', 'connector', 'test',
   'https://exemple.invalid/r76-2', 'open_access', 'pending', 'public');

-- ---------------------------------------------------------------------------
-- Droits de table : lecture pour le rôle serveur, écriture pour personne
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['countries', 'languages', 'licenses', 'resource_types', 'education_levels',
                  'academic_domains', 'academic_programs', 'program_specialties', 'subjects']) t,
     unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege(r, 'public.' || t, p)
      or has_any_column_privilege(r, 'public.' || t, 'insert,update')),
  0::bigint, 'Aucun rôle de l''API n''écrit dans un référentiel'
);
select is(
  (select count(*) from unnest(array['countries', 'languages', 'licenses', 'resource_types', 'education_levels',
                                     'academic_domains', 'academic_programs', 'program_specialties', 'subjects']) t
   where has_table_privilege('service_role', 'public.' || t, 'select')),
  9::bigint, 'Le rôle serveur garde sa lecture des neuf référentiels'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) r,
     unnest(array['countries', 'languages', 'licenses', 'resource_types', 'education_levels',
                  'academic_domains', 'academic_programs', 'program_specialties', 'subjects']) t
   where has_any_column_privilege(r, 'public.' || t, 'select')),
  0::bigint, 'Ni un visiteur ni un compte ne lit ces tables directement'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ update public.subjects set is_active = false $$, '42501', null, 'Le rôle serveur ne modifie pas un référentiel');
select throws_ok(
  $$ select public.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science') $$,
  '42501', null, 'Ni n''appelle les fonctions d''administration des référentiels'
);
select throws_ok($$ select private.admin_reference_items('subjects') $$, '42501', null, 'Ni leurs fonctions internes');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.admin_reference_items('subjects') $$, '42501', null, 'Un visiteur non plus');
reset role;

-- ---------------------------------------------------------------------------
-- Qui peut administrer : chaque refus, consigné, rendu en 403
-- ---------------------------------------------------------------------------
select tests.login('d0000000-0000-0000-0000-000000007602', 'aal2', 10);
select throws_ok($$ select private.admin_reference_items('subjects') $$, '42501', 'forbidden', 'Un utilisateur ne lit pas l''administration des référentiels');
select throws_ok(
  $$ select private.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_faux", "labels": {"fr": "Faux", "en": "Fake"}}') $$,
  '42501', 'forbidden', 'Ni ne crée de ligne'
);
select throws_ok(
  $$ select private.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science') $$,
  '42501', 'forbidden', 'Ni n''en désactive'
);
select is(
  public.admin_reference_items('subjects'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'Par l''API, le refus est rendu sans lever'
);
select is(current_setting('response.status', true), '403', 'Avec le statut 403');
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_faux", "labels": {"fr": "Faux", "en": "Fake"}}'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'De même pour une écriture'
);
select is(
  public.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'Et pour une désactivation'
);
reset role;
select results_eq(
  $$ select target_id, metadata ->> 'code', metadata ->> 'source' from public.audit_logs
     where action = 'admin.refused' and actor_id = 'd0000000-0000-0000-0000-000000007602' order by id $$,
  $$ values ('reference_items', 'forbidden', 'database'),
            ('save_reference_item', 'forbidden', 'database'),
            ('set_reference_active', 'forbidden', 'database') $$,
  'Chaque refus est consigné par la base, sous son opération'
);

select tests.login('c0000000-0000-0000-0000-000000007603', 'aal2', 10);
select throws_ok($$ select private.admin_reference_items('subjects') $$, '42501', 'forbidden', 'Une modératrice ne lit pas l''administration des référentiels');
select throws_ok(
  $$ select private.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science') $$,
  '42501', 'forbidden', 'Ni ne désactive une ligne'
);
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_faux", "labels": {"fr": "Faux", "en": "Fake"}}') ->> 'message',
  'forbidden', 'Ni ne crée de ligne'
);
reset role;

select tests.login('b0000000-0000-0000-0000-000000007601', 'aal1');
select throws_ok($$ select private.admin_reference_items('subjects') $$, '42501', 'forbidden', 'En aal1, un administrateur n''a aucun pouvoir sur les référentiels');
reset role;
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 700);
select throws_ok($$ select private.admin_reference_items('subjects') $$, '42501', 'recent_second_factor_required', 'Second facteur ancien : lecture refusée');
select throws_ok(
  $$ select private.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_faux", "labels": {"fr": "Faux", "en": "Fake"}}') $$,
  '42501', 'recent_second_factor_required', 'Écriture refusée'
);
select throws_ok(
  $$ select private.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science') $$,
  '42501', 'recent_second_factor_required', 'Désactivation refusée'
);
select is(
  public.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science'),
  '{"code": "42501", "message": "recent_second_factor_required"}'::jsonb, 'Par l''API, le motif est rendu'
);
reset role;
select isnt_empty(
  $$ select 1 from public.audit_logs
     where action = 'admin.refused' and actor_id = 'b0000000-0000-0000-0000-000000007601'
       and target_id = 'set_reference_active' and metadata ->> 'code' = 'recent_second_factor_required' $$,
  'Le refus fait à un administrateur est consigné lui aussi'
);
select is(
  (select count(*) from public.subjects where code = 'zz_faux') + (select count(*) from public.subjects where code = 'algorithms' and not is_active),
  0::bigint, 'Rien n''a été écrit par ces tentatives'
);

-- ---------------------------------------------------------------------------
-- Lire : lignes actives et inactives, usages
-- ---------------------------------------------------------------------------
create table tests.items (kind text primary key, rows jsonb);
grant all on tests.items to authenticated;
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
insert into tests.items
select k as kind, public.admin_reference_items(k) as rows
from unnest(array['countries', 'languages', 'licenses', 'resource_types', 'education_levels',
                  'academic_domains', 'academic_programs', 'program_specialties', 'subjects']) as k;
reset role;
select is(
  (select jsonb_array_length(rows) from tests.items where kind = 'countries'),
  (select count(*)::integer from public.countries), 'L''administrateur lit tous les pays'
);
select is(
  (select jsonb_array_length(rows) from tests.items where kind = 'resource_types'),
  (select count(*)::integer from public.resource_types), 'Les types inactifs sont rendus avec les actifs'
);
select ok(
  (select rows @> '[{"code": "upper_secondary", "is_active": false}]'::jsonb from tests.items where kind = 'education_levels'),
  'Un niveau inactif figure dans la liste, signalé comme tel'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'countries'),
  array['code', 'is_active', 'labels', 'usage_count'], 'Forme d''un pays'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'languages'),
  array['code', 'is_active', 'is_interface', 'labels', 'usage_count'], 'Forme d''une langue'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'resource_types'),
  array['code', 'is_active', 'labels', 'position', 'usage_count'], 'Forme d''un type de ressource'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'education_levels'),
  array['code', 'is_active', 'isced_level', 'labels', 'position', 'usage_count'], 'Forme d''un niveau'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'academic_domains'),
  array['code', 'is_active', 'labels', 'usage_count'], 'Forme d''un domaine'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'academic_programs'),
  array['code', 'domain_code', 'is_active', 'labels', 'usage_count'], 'Forme d''une filière'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'program_specialties'),
  array['code', 'is_active', 'labels', 'position', 'program_code', 'usage_count'], 'Forme d''une spécialité'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'subjects'),
  array['code', 'is_active', 'labels', 'position', 'program_code', 'usage_count'], 'Forme d''une matière'
);
select is(
  (select array_agg(k order by k) from tests.items, jsonb_object_keys(rows -> 0) as k where kind = 'licenses'),
  array['allows_commercial_use', 'can_host', 'can_redistribute', 'code', 'is_active', 'labels', 'position',
        'read_only', 'requires_attribution', 'usage_count'],
  'Forme d''une licence : ses indicateurs juridiques, en lecture seule'
);
select is(
  (select (e ->> 'usage_count')::bigint from tests.items, jsonb_array_elements(rows) e
   where kind = 'program_specialties' and e ->> 'code' = 'software_engineering' and e ->> 'program_code' = 'computer_science'),
  (select count(*) from public.profiles where program_code = 'computer_science' and specialty_code = 'software_engineering'),
  'Le nombre d''usages d''une spécialité est celui des profils qui la portent'
);
select is(
  (select (e ->> 'usage_count')::bigint from tests.items, jsonb_array_elements(rows) e
   where kind = 'subjects' and e ->> 'code' = 'algorithms' and e ->> 'program_code' = 'computer_science'),
  (select count(*) from public.profiles where program_code = 'computer_science' and 'algorithms' = any (subject_codes))
  + (select count(*) from public.resources where program_code = 'computer_science' and 'algorithms' = any (subject_codes)),
  'Celui d''une matière compte profils et fiches'
);
select ok(
  (select bool_and(not (e ? 'user_id') and not (e ? 'email')) from tests.items, jsonb_array_elements(rows) e),
  'Des nombres seulement : aucune identité'
);
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok($$ select public.admin_reference_items('profiles') $$, '22023', 'invalid_payload', 'Une table hors de la liste fermée est refusée');
select throws_ok($$ select public.admin_reference_items(null) $$, '22023', 'invalid_payload', 'Comme une demande sans table');

-- ---------------------------------------------------------------------------
-- Créer, modifier
-- ---------------------------------------------------------------------------
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_test_subject", "labels": {"fr": "  Matière zzlibelle  ", "en": "Subject zzlibelle", "pt": "Matéria zzlibelle"}, "position": 7}'),
  '{"created": true}'::jsonb, 'L''administrateur crée une matière'
);
reset role;
select results_eq(
  $$ select labels, position, is_active from public.subjects where program_code = 'computer_science' and code = 'zz_test_subject' $$,
  $$ values ('{"fr": "Matière zzlibelle", "en": "Subject zzlibelle", "pt": "Matéria zzlibelle"}'::jsonb, 7, false) $$,
  'Elle naît inactive, libellés nettoyés, dans chaque langue donnée'
);
select tests.login('e0000000-0000-0000-0000-000000007604');
select ok(
  not (public.reference_data() -> 'subjects' @> '[{"code": "zz_test_subject"}]'::jsonb),
  'Inactive, elle n''est proposée à personne'
);
reset role;

select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select is(public.admin_set_reference_active('subjects', 'zz_test_subject', true, 'computer_science'), null, 'L''administrateur l''active');
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_test_subject", "labels": {"fr": "Matière zzlibelle revue", "en": "Subject zzlibelle", "pt": "Matéria zzlibelle"}}'),
  '{"created": false}'::jsonb, 'Puis en modifie un libellé'
);
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_test_subject", "position": 9}'),
  '{"created": false}'::jsonb, 'Et la position, sans redonner les libellés'
);
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_test_subject", "position": 9}'),
  '{"created": false}'::jsonb, 'Une écriture sans changement est acceptée'
);
reset role;
select results_eq(
  $$ select labels ->> 'fr', position, is_active from public.subjects where program_code = 'computer_science' and code = 'zz_test_subject' $$,
  $$ values ('Matière zzlibelle revue', 9, true) $$,
  'Libellé et position sont à jour ; la ligne reste active'
);
select tests.login('e0000000-0000-0000-0000-000000007604');
select ok(
  public.reference_data() -> 'subjects' @> '[{"program_code": "computer_science", "code": "zz_test_subject", "labels": {"fr": "Matière zzlibelle revue", "en": "Subject zzlibelle", "pt": "Matéria zzlibelle"}}]'::jsonb,
  'Active, elle est rendue par reference_data avec tous ses libellés'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.reference_data()) as k),
  array['academic_domains', 'academic_programs', 'countries', 'education_levels', 'languages', 'licenses',
        'program_specialties', 'resource_types', 'subjects'],
  'La forme de reference_data n''a pas changé'
);
reset role;

-- Requêtes refusées.
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_sans_en", "labels": {"fr": "Seulement"}}') $$, '22023', 'invalid_payload', 'Libellé anglais manquant : refusé');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_vide", "labels": {"fr": "   ", "en": "Empty"}}') $$, '22023', 'invalid_payload', 'Libellé vide : refusé');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_balise", "labels": {"fr": "<b>Gras</b>", "en": "Bold"}}') $$, '22023', 'invalid_payload', 'Libellé avec balise : refusé');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_commande", "labels": {"fr": "Son\u0007nerie", "en": "Bell"}}') $$, '22023', 'invalid_payload', 'Libellé avec caractère de commande : refusé');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_format", "labels": {"fr": "Sens‮inverse", "en": "Override"}}') $$, '22023', 'invalid_payload', 'Libellé avec caractère de format : refusé');
select throws_ok(
  format($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_long", "labels": {"fr": "%s", "en": "Long"}}') $$, repeat('a', 121)),
  '22023', 'invalid_payload', 'Libellé de plus de 120 caractères : refusé'
);
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_langue", "labels": {"fr": "Bon", "en": "Good", "xx": "Inconnue"}}') $$, '22023', 'invalid_payload', 'Langue de libellé inconnue : refusée');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_nombre", "labels": {"fr": 12, "en": "Number"}}') $$, '22023', 'invalid_payload', 'Libellé qui n''est pas un texte : refusé');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_sans", "position": 3}') $$, '22023', 'invalid_payload', 'Création sans libellés : refusée');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "filiere_inconnue", "code": "zz_orpheline", "labels": {"fr": "Orpheline", "en": "Orphan"}}') $$, '22023', 'invalid_payload', 'Filière de rattachement inconnue : refusée');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"code": "zz_sans_filiere", "labels": {"fr": "Sans", "en": "Without"}}') $$, '22023', 'invalid_payload', 'Matière sans filière : refusée');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "Mauvais Code", "labels": {"fr": "Bon", "en": "Good"}}') $$, '22023', 'invalid_payload', 'Code mal formé : refusé');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_actif", "labels": {"fr": "Bon", "en": "Good"}, "is_active": true}') $$, '22023', 'invalid_payload', 'L''activation ne passe pas par l''écriture');
select throws_ok($$ select public.admin_save_reference_item('subjects', '{"program_code": "computer_science", "code": "zz_position", "labels": {"fr": "Bon", "en": "Good"}, "position": -1}') $$, '22023', 'invalid_payload', 'Position négative : refusée');
select throws_ok($$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_domaine", "labels": {"fr": "Bon", "en": "Good"}, "position": 1}') $$, '22023', 'invalid_payload', 'Position sur une table qui n''en a pas : refusée');
select throws_ok($$ select public.admin_save_reference_item('profiles', '{"code": "zz", "labels": {"fr": "Bon", "en": "Good"}}') $$, '22023', 'invalid_payload', 'Table hors de la liste fermée : refusée');
select throws_ok($$ select public.admin_save_reference_item('subjects', '[]') $$, '22023', 'invalid_payload', 'Requête qui n''est pas un objet : refusée');

-- Filières, domaines, spécialités, niveaux.
select throws_ok($$ select public.admin_save_reference_item('academic_programs', '{"code": "zz_filiere", "domain_code": "domaine_inconnu", "labels": {"fr": "Filière", "en": "Program"}}') $$, '22023', 'invalid_payload', 'Domaine de rattachement inconnu : refusé');
select throws_ok($$ select public.admin_save_reference_item('academic_programs', '{"code": "zz_filiere", "labels": {"fr": "Filière", "en": "Program"}}') $$, '22023', 'invalid_payload', 'Filière sans domaine : refusée');
select is(public.admin_save_reference_item('academic_domains', '{"code": "zz_domaine", "labels": {"fr": "Domaine zzlibelle", "en": "Domain zzlibelle"}}'), '{"created": true}'::jsonb, 'Un domaine se crée');
select is(public.admin_save_reference_item('academic_programs', '{"code": "zz_filiere", "domain_code": "sciences_technology", "labels": {"fr": "Filière zzlibelle", "en": "Program zzlibelle"}}'), '{"created": true}'::jsonb, 'Une filière se crée dans un domaine existant');
select is(public.admin_save_reference_item('academic_programs', '{"code": "zz_filiere", "domain_code": "zz_domaine"}'), '{"created": false}'::jsonb, 'Son domaine, simple rattachement, peut changer');
select is(public.admin_save_reference_item('program_specialties', '{"program_code": "zz_filiere", "code": "zz_specialite", "labels": {"fr": "Spécialité zzlibelle", "en": "Specialty zzlibelle"}, "position": 2}'), '{"created": true}'::jsonb, 'Une spécialité se crée dans une filière');
select is(public.admin_save_reference_item('education_levels', '{"code": "zz_niveau", "labels": {"fr": "Niveau zzlibelle", "en": "Level zzlibelle"}, "position": 99, "isced_level": 6}'), '{"created": true}'::jsonb, 'Un niveau se crée avec son niveau CITE');
select throws_ok($$ select public.admin_save_reference_item('education_levels', '{"code": "zz_niveau", "isced_level": 9}') $$, '22023', 'invalid_payload', 'Niveau CITE hors bornes : refusé');
select is(public.admin_save_reference_item('resource_types', '{"code": "zz_type", "labels": {"fr": "Type zzlibelle", "en": "Type zzlibelle"}}'), '{"created": true}'::jsonb, 'Un type de ressource se crée');
reset role;
select results_eq(
  $$ select domain_code, is_active from public.academic_programs where code = 'zz_filiere' $$,
  $$ values ('zz_domaine', false) $$, 'La filière porte son nouveau domaine et reste inactive'
);
select is((select isced_level from public.education_levels where code = 'zz_niveau'), 6::smallint, 'Le niveau CITE est rangé');

-- Le code, et la filière d'une matière, ne changent jamais.
select throws_ok(
  $$ update public.subjects set code = 'zz_renomme' where code = 'zz_test_subject' $$,
  '42501', 'La colonne code de public.subjects ne peut pas être modifiée.', 'Le code d''une ligne ne change pas, même pour le propriétaire de la base'
);
select throws_ok(
  $$ update public.subjects set program_code = 'zz_filiere' where code = 'zz_test_subject' $$,
  '42501', 'La colonne program_code de public.subjects ne peut pas être modifiée.', 'Ni la filière d''une matière'
);
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select is(
  public.admin_save_reference_item('subjects', '{"program_code": "zz_filiere", "code": "zz_test_subject", "labels": {"fr": "Autre zzlibelle", "en": "Other zzlibelle"}}'),
  '{"created": true}'::jsonb, 'Donner une autre filière ne déplace pas la matière : cela en crée une autre'
);
reset role;
select is(
  (select count(*) from public.subjects where code = 'zz_test_subject'), 2::bigint,
  'La matière d''origine est restée dans sa filière'
);

-- Pays : ni création, ni autre champ que les libellés.
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok($$ select public.admin_save_reference_item('countries', '{"code": "ZZ", "labels": {"fr": "Pays inventé", "en": "Made-up country"}}') $$, 'P0001', 'not_found', 'Un pays ne se crée pas');
select is(public.admin_save_reference_item('countries', '{"code": "SN", "labels": {"fr": "Sénégal zzlibelle", "en": "Senegal"}}'), '{"created": false}'::jsonb, 'Le libellé d''un pays se modifie');
-- Langues : is_interface intouchable.
select throws_ok($$ select public.admin_save_reference_item('languages', '{"code": "pt", "is_interface": true}') $$, '22023', 'invalid_payload', 'is_interface ne s''écrit pas');
select is(public.admin_save_reference_item('languages', '{"code": "wo", "labels": {"fr": "Wolof", "en": "Wolof"}}'), '{"created": true}'::jsonb, 'Une langue de contenu se crée');
select is(public.admin_save_reference_item('languages', '{"code": "wo", "labels": {"fr": "Wolof", "en": "Wolof", "wo": "Wolof"}}'), '{"created": false}'::jsonb, 'Elle peut alors porter des libellés');
-- Licences : lecture seule.
select throws_ok($$ select public.admin_save_reference_item('licenses', '{"code": "cc-by-4.0", "labels": {"fr": "Libre", "en": "Free"}}') $$, 'P0001', 'read_only_reference', 'Une licence ne se modifie pas');
select throws_ok($$ select public.admin_save_reference_item('licenses', '{"code": "zz-licence", "labels": {"fr": "Inventée", "en": "Made up"}}') $$, 'P0001', 'read_only_reference', 'Ni ne se crée');
select throws_ok($$ select public.admin_set_reference_active('licenses', 'cc-by-4.0', false) $$, 'P0001', 'read_only_reference', 'Ni ne se désactive');
reset role;
select results_eq(
  $$ select is_interface, is_active from public.languages where code = 'wo' $$,
  $$ values (false, false) $$, 'La langue créée n''est pas une langue d''interface, et naît inactive'
);
select is(
  (select count(*) from public.languages where is_interface), 2::bigint,
  'Les langues d''interface n''ont pas changé'
);
select is(
  (select count(*) from public.licenses where not is_active or labels ->> 'fr' = 'Libre'), 0::bigint,
  'Aucune licence n''a été touchée'
);

-- ---------------------------------------------------------------------------
-- Désactiver : ne casse rien, et ferme les nouveaux choix
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select is(public.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science'), null, 'Une matière se désactive');
select is(public.admin_set_reference_active('education_levels', 'bachelor_3', false), null, 'Un niveau se désactive');
select is(public.admin_set_reference_active('program_specialties', 'software_engineering', false, 'computer_science'), null, 'Une spécialité se désactive');
select is(public.admin_set_reference_active('resource_types', 'video', false), null, 'Un type de ressource se désactive');
select is(public.admin_set_reference_active('countries', 'SN', false), null, 'Un pays se désactive');
select throws_ok($$ select public.admin_set_reference_active('subjects', 'algorithms', false, 'computer_science') $$, '22023', 'invalid_transition', 'Désactiver deux fois : refusé');
select throws_ok($$ select public.admin_set_reference_active('subjects', 'matiere_inconnue', false, 'computer_science') $$, 'P0001', 'not_found', 'Ligne inconnue');
select throws_ok($$ select public.admin_set_reference_active('subjects', 'algorithms', false) $$, '22023', 'invalid_payload', 'Une matière se désigne avec sa filière');
select throws_ok($$ select public.admin_set_reference_active('countries', 'SN', true, 'computer_science') $$, '22023', 'invalid_payload', 'Un pays n''a pas de rattachement');
select throws_ok($$ select public.admin_set_reference_active('profiles', 'x', false) $$, '22023', 'invalid_payload', 'Table hors de la liste fermée');
reset role;

-- reference_data ne rend plus les lignes désactivées.
select tests.login('e0000000-0000-0000-0000-000000007604');
select ok(
  not (public.reference_data() -> 'subjects' @> '[{"code": "algorithms"}]'::jsonb)
  and not (public.reference_data() -> 'education_levels' @> '[{"code": "bachelor_3"}]'::jsonb)
  and not (public.reference_data() -> 'program_specialties' @> '[{"code": "software_engineering"}]'::jsonb)
  and not (public.reference_data() -> 'resource_types' @> '[{"code": "video"}]'::jsonb)
  and not (public.reference_data() -> 'countries' @> '[{"code": "SN"}]'::jsonb),
  'reference_data ne rend plus les lignes désactivées'
);
select ok(
  public.reference_data() -> 'subjects' @> '[{"code": "data_structures"}]'::jsonb,
  'Les autres y sont toujours'
);

-- Le profil qui porte des codes désactivés : lisible, modifiable ailleurs.
select results_eq(
  $$ select country_code, level_code, specialty_code, subject_codes from public.profiles $$,
  $$ values ('SN', 'bachelor_3', 'software_engineering', array['algorithms', 'data_structures']) $$,
  'Le profil qui porte des codes désactivés se lit toujours'
);
select lives_ok(
  $$ update public.profiles set institution_name = 'Université du test 76' where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  'Et se modifie sur un autre champ'
);
select lives_ok(
  $$ update public.profiles set subject_codes = array['algorithms', 'data_structures', 'programming_fundamentals'] where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  'Une matière active s''ajoute à côté de la matière désactivée, qui est gardée'
);
select lives_ok(
  $$ update public.profiles set subject_codes = array['data_structures', 'programming_fundamentals'] where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  'La matière désactivée se retire'
);
select throws_ok(
  $$ update public.profiles set subject_codes = array['data_structures', 'programming_fundamentals', 'algorithms'] where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  '23514', null, 'Mais ne se choisit plus de nouveau'
);
select lives_ok(
  $$ update public.profiles set level_code = 'master_1' where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  'Le niveau se change pour un niveau actif'
);
select throws_ok(
  $$ update public.profiles set level_code = 'bachelor_3' where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  '23514', null, 'Le niveau désactivé ne se choisit plus de nouveau'
);
select lives_ok(
  $$ update public.profiles set specialty_code = null where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  'La spécialité désactivée se retire'
);
select throws_ok(
  $$ update public.profiles set specialty_code = 'software_engineering' where user_id = 'e0000000-0000-0000-0000-000000007604' $$,
  '23514', null, 'Et ne se choisit plus de nouveau'
);
reset role;
-- Un autre compte ne peut pas choisir ce qui est désactivé.
select tests.login('e1000000-0000-0000-0000-000000007605');
select throws_ok($$ update public.profiles set level_code = 'bachelor_3' where user_id = 'e1000000-0000-0000-0000-000000007605' $$, '23514', null, 'Un autre compte ne choisit pas le niveau désactivé');
select throws_ok($$ update public.profiles set subject_codes = array['algorithms'] where user_id = 'e1000000-0000-0000-0000-000000007605' $$, '23514', null, 'Ni la matière désactivée');
select lives_ok($$ update public.profiles set country_code = 'CI' where user_id = 'e1000000-0000-0000-0000-000000007605' $$, 'Il change de pays pour un pays actif');
select throws_ok($$ update public.profiles set country_code = 'SN' where user_id = 'e1000000-0000-0000-0000-000000007605' $$, '23514', null, 'Mais ne revient pas au pays désactivé');
select lives_ok($$ update public.profiles set subject_codes = array['zz_test_subject'] where user_id = 'e1000000-0000-0000-0000-000000007605' $$, 'La matière créée puis activée se choisit');
reset role;

-- Les fiches qui portent des codes désactivés.
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$ update public.resources set title = 'Fiche du test 76, retouchée' where id = '76000000-0000-0000-0000-000000000001' $$,
  'Une fiche qui porte un niveau et une matière désactivés se modifie sur un autre champ'
);
select lives_ok(
  $$ update public.resources set level_codes = array['bachelor_3', 'master_1'], subject_codes = array['algorithms', 'data_structures'] where id = '76000000-0000-0000-0000-000000000001' $$,
  'Des codes actifs s''ajoutent à côté des codes désactivés, qui sont gardés'
);
select lives_ok(
  $$ update public.resources set level_codes = array['master_1'], subject_codes = array['data_structures'] where id = '76000000-0000-0000-0000-000000000001' $$,
  'Les codes désactivés se retirent'
);
select throws_ok(
  $$ update public.resources set level_codes = array['master_1', 'bachelor_3'] where id = '76000000-0000-0000-0000-000000000001' $$,
  '23514', 'invalid_level', 'Le niveau désactivé ne se choisit plus de nouveau'
);
select throws_ok(
  $$ update public.resources set subject_codes = array['data_structures', 'algorithms'] where id = '76000000-0000-0000-0000-000000000001' $$,
  '23514', 'invalid_subject', 'Ni la matière désactivée'
);
select lives_ok(
  $$ update public.resources set title = 'Vidéo du test 76, retouchée' where id = '76000000-0000-0000-0000-000000000002' $$,
  'Une fiche dont le type est désactivé se modifie sur un autre champ'
);
select lives_ok(
  $$ update public.resources set type_code = 'article' where id = '76000000-0000-0000-0000-000000000002' $$,
  'Son type se change pour un type actif'
);
select throws_ok(
  $$ update public.resources set type_code = 'video' where id = '76000000-0000-0000-0000-000000000002' $$,
  '23514', 'invalid_type', 'Le type désactivé ne se choisit plus de nouveau'
);
select throws_ok(
  $$ insert into public.resources (type_code, title, authors, tags, language_code, program_code, level_codes, source_kind, source_name, official_url, access_status, editorial_status, visibility)
     values ('article', 'Nouvelle fiche du test 76', array['Awa Diop'], '{}', 'fr', 'computer_science', array['bachelor_3'], 'connector', 'test', 'https://exemple.invalid/r76-3', 'open_access', 'pending', 'public') $$,
  '23514', 'invalid_level', 'Une nouvelle fiche ne prend pas un niveau désactivé'
);
select throws_ok(
  $$ insert into public.resources (type_code, title, authors, tags, language_code, program_code, country_code, source_kind, source_name, official_url, access_status, editorial_status, visibility)
     values ('article', 'Nouvelle fiche du test 76', array['Awa Diop'], '{}', 'fr', 'computer_science', 'SN', 'connector', 'test', 'https://exemple.invalid/r76-4', 'open_access', 'pending', 'public') $$,
  '23514', 'invalid_country', 'Ni un pays désactivé'
);

-- Réactiver rouvre le choix.
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select is(public.admin_set_reference_active('education_levels', 'bachelor_3', true), null, 'Le niveau se réactive');
select throws_ok($$ select public.admin_set_reference_active('education_levels', 'bachelor_3', true) $$, '22023', 'invalid_transition', 'Activer deux fois : refusé');
reset role;
select tests.login('e1000000-0000-0000-0000-000000007605');
select lives_ok($$ update public.profiles set level_code = 'bachelor_3' where user_id = 'e1000000-0000-0000-0000-000000007605' $$, 'Réactivé, le niveau se choisit de nouveau');
reset role;

-- ---------------------------------------------------------------------------
-- Dernière ligne active, codes câblés
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok($$ select public.admin_set_reference_active('academic_domains', 'sciences_technology', false) $$, 'P0001', 'last_active', 'Le dernier domaine actif ne se désactive pas');
select throws_ok($$ select public.admin_set_reference_active('academic_programs', 'computer_science', false) $$, 'P0001', 'last_active', 'Ni la dernière filière active');
select throws_ok($$ select public.admin_set_reference_active('resource_types', 'thesis', false) $$, 'P0001', 'protected_reference', 'Le type « thesis », câblé dans la base, ne se désactive pas');
select throws_ok($$ select public.admin_set_reference_active('languages', 'fr', false) $$, 'P0001', 'protected_reference', 'Ni une langue d''interface');
select throws_ok($$ select public.admin_set_reference_active('languages', 'en', false) $$, 'P0001', 'protected_reference', 'Ni l''autre');
select is(public.admin_set_reference_active('languages', 'pt', false), null, 'Une langue de contenu se désactive');
-- Avec un second domaine actif, le premier peut l'être.
select is(public.admin_set_reference_active('academic_domains', 'zz_domaine', true), null, 'Un second domaine est activé');
select is(public.admin_set_reference_active('academic_domains', 'sciences_technology', false), null, 'Le premier peut alors se désactiver');
select throws_ok($$ select public.admin_set_reference_active('academic_domains', 'zz_domaine', false) $$, 'P0001', 'last_active', 'Et le second devient le dernier');
reset role;

-- ---------------------------------------------------------------------------
-- Relecture de sécurité : parents inactifs, planchers par filière, codes
-- câblés, libellés, usages
-- ---------------------------------------------------------------------------
-- Le domaine d'origine est désactivé : sa filière, et tout ce qu'elle porte,
-- ne sont plus rendus.
select tests.login('e0000000-0000-0000-0000-000000007604');
select ok(
  not (public.reference_data() -> 'academic_programs' @> '[{"code": "computer_science"}]'::jsonb)
  and not (public.reference_data() -> 'subjects' @> '[{"program_code": "computer_science"}]'::jsonb)
  and not (public.reference_data() -> 'program_specialties' @> '[{"program_code": "computer_science"}]'::jsonb),
  'Domaine désactivé : ni sa filière, ni les matières et spécialités de celle-ci ne sont rendues'
);
reset role;
-- Un compte ordinaire n'appelle pas les fonctions internes.
select tests.login('e0000000-0000-0000-0000-000000007604');
select throws_ok($$ select private.admin_reference_items('subjects') $$, '42501', 'forbidden', 'Un compte ordinaire n''appelle pas directement la lecture d''administration');
select throws_ok($$ select private.admin_save_reference_item('countries', '{"code": "SN", "labels": {"fr": "Faux", "en": "Fake"}}') $$, '42501', 'forbidden', 'Ni l''écriture');
select throws_ok($$ select private.admin_set_reference_active('countries', 'CI', false) $$, '42501', 'forbidden', 'Ni la désactivation');
reset role;

select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
-- Codes câblés dans le connecteur d'import.
select throws_ok($$ select public.admin_set_reference_active('resource_types', 'article', false) $$, 'P0001', 'protected_reference', 'Le type « article », écrit par le connecteur d''import, ne se désactive pas');
select throws_ok($$ select public.admin_set_reference_active('resource_types', 'book', false) $$, 'P0001', 'protected_reference', 'Ni le type « book »');
-- Une filière active garde sa dernière matière et sa dernière spécialité.
select is(public.admin_set_reference_active('academic_programs', 'zz_filiere', true), null, 'La filière du test est activée');
select is(public.admin_set_reference_active('program_specialties', 'zz_specialite', true, 'zz_filiere'), null, 'Sa spécialité aussi');
select is(public.admin_set_reference_active('subjects', 'zz_test_subject', true, 'zz_filiere'), null, 'Et sa matière');
select throws_ok($$ select public.admin_set_reference_active('program_specialties', 'zz_specialite', false, 'zz_filiere') $$, 'P0001', 'last_active', 'La dernière spécialité active d''une filière active ne se désactive pas');
select throws_ok($$ select public.admin_set_reference_active('subjects', 'zz_test_subject', false, 'zz_filiere') $$, 'P0001', 'last_active', 'Ni sa dernière matière active');
reset role;
select tests.login('e0000000-0000-0000-0000-000000007604');
select ok(
  public.reference_data() -> 'academic_programs' @> '[{"code": "zz_filiere", "domain_code": "zz_domaine"}]'::jsonb
  and public.reference_data() -> 'program_specialties' @> '[{"program_code": "zz_filiere", "code": "zz_specialite"}]'::jsonb
  and public.reference_data() -> 'subjects' @> '[{"program_code": "zz_filiere", "code": "zz_test_subject"}]'::jsonb,
  'Filière active d''un domaine actif : elle est rendue avec sa spécialité et sa matière'
);
reset role;

-- Un profil et une fiche rejoignent la filière tant qu'elle est active.
select tests.login('e1000000-0000-0000-0000-000000007605');
select lives_ok(
  $$ update public.profiles set program_code = 'zz_filiere', subject_codes = '{}', specialty_code = null where user_id = 'e1000000-0000-0000-0000-000000007605' $$,
  'Un compte choisit la filière active'
);
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility)
values
  ('76000000-0000-0000-0000-000000000003', 'article', 'Fiche de la filière du test 76', array['Awa Diop'], '{}', 'fr',
   'zz_filiere', 'connector', 'test', 'https://exemple.invalid/r76-f', 'open_access', 'pending', 'public');

select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select is(public.admin_set_reference_active('academic_programs', 'zz_filiere', false), null, 'La filière est désactivée');
select is(public.admin_set_reference_active('program_specialties', 'zz_specialite', false, 'zz_filiere'), null, 'Filière désactivée : sa dernière spécialité peut l''être aussi');
select is(public.admin_set_reference_active('program_specialties', 'zz_specialite', true, 'zz_filiere'), null, 'Et se réactiver');
reset role;
select tests.login('e0000000-0000-0000-0000-000000007604');
select ok(
  not (public.reference_data() -> 'academic_programs' @> '[{"code": "zz_filiere"}]'::jsonb)
  and not (public.reference_data() -> 'program_specialties' @> '[{"program_code": "zz_filiere"}]'::jsonb)
  and not (public.reference_data() -> 'subjects' @> '[{"program_code": "zz_filiere"}]'::jsonb),
  'Filière désactivée : ni elle, ni ses spécialités, ni ses matières, pourtant actives, ne sont rendues'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.reference_data()) as k),
  array['academic_domains', 'academic_programs', 'countries', 'education_levels', 'languages', 'licenses',
        'program_specialties', 'resource_types', 'subjects'],
  'La forme de reference_data n''a pas changé'
);
reset role;
select tests.login('e1000000-0000-0000-0000-000000007605');
select is((select program_code from public.profiles), 'zz_filiere', 'Le profil qui porte la filière désactivée se lit toujours');
select lives_ok($$ update public.profiles set institution_name = 'Institut du test 76' where user_id = 'e1000000-0000-0000-0000-000000007605' $$, 'Et se modifie sur un autre champ');
select throws_ok($$ update public.profiles set subject_codes = array['zz_test_subject'] where user_id = 'e1000000-0000-0000-0000-000000007605' $$, '23514', null, 'Mais aucune matière ne s''ajoute sous une filière désactivée');
select throws_ok($$ update public.profiles set specialty_code = 'zz_specialite' where user_id = 'e1000000-0000-0000-0000-000000007605' $$, '23514', null, 'Ni aucune spécialité');
reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok($$ update public.resources set title = 'Fiche de la filière du test 76, retouchée' where id = '76000000-0000-0000-0000-000000000003' $$, 'La fiche d''une filière désactivée se modifie sur un autre champ');
select throws_ok($$ update public.resources set subject_codes = array['zz_test_subject'] where id = '76000000-0000-0000-0000-000000000003' $$, '23514', 'invalid_subject', 'Mais aucune matière ne s''y ajoute');

-- Libellés : formules de tableur, absence de lettre, caractères invisibles.
create function tests.invisible_refused()
returns setof text language plpgsql as $f$
declare
  v_code integer;
begin
  foreach v_code in array array[128, 159, 173, 1564, 4447, 4448, 6158, 8203, 8207, 8232, 8234, 8238, 8288,
                                8294, 8297, 12644, 65279, 65440, 917504, 917505, 917631] loop
    return next throws_ok(
      format('select public.admin_save_reference_item(''academic_domains'', %L::jsonb)',
        jsonb_build_object('code', 'zz_invisible', 'labels',
          jsonb_build_object('fr', 'ab' || chr(v_code) || 'cd', 'en', 'Good'))::text),
      '22023', 'invalid_payload', 'Caractère U+' || lpad(upper(to_hex(v_code)), 4, '0') || ' refusé dans un libellé');
  end loop;
end $f$;
grant execute on function tests.invisible_refused() to authenticated;
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok($$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_formule", "labels": {"fr": "=SOMME(A1:A9)", "en": "Sum"}}') $$, '22023', 'invalid_payload', 'Libellé qui commence par « = » : refusé');
select throws_ok($$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_formule", "labels": {"fr": "+33 Indicatif", "en": "Plus"}}') $$, '22023', 'invalid_payload', 'Par « + » : refusé');
select throws_ok($$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_formule", "labels": {"fr": "Bon", "en": "-cmd arguments"}}') $$, '22023', 'invalid_payload', 'Par « - » : refusé');
select throws_ok($$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_formule", "labels": {"fr": "  @SUM(A1)", "en": "At"}}') $$, '22023', 'invalid_payload', 'Par « @ », même après des espaces : refusé');
select throws_ok($$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_formule", "labels": {"fr": "2024 / 2025", "en": "Years"}}') $$, '22023', 'invalid_payload', 'Libellé sans aucune lettre : refusé');
select tests.invisible_refused();
select is(
  public.admin_save_reference_item('academic_domains', '{"code": "zz_propre", "labels": {"fr": "Licence 3 - parcours A+B (L3)", "en": "Year 3 @ campus"}}'),
  '{"created": true}'::jsonb, 'Ces signes restent permis ailleurs qu''en tête'
);
-- Usages d'une filière : profils et fiches, pas les projets.
reset role;
insert into public.research_projects (id, owner_id, title, program_code) values
  ('76000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000007604', 'Projet du test 76', 'computer_science');
create table tests.usage (usage_count bigint);
grant all on tests.usage to authenticated;
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
insert into tests.usage
select (e ->> 'usage_count')::bigint from jsonb_array_elements(public.admin_reference_items('academic_programs')) e
where e ->> 'code' = 'computer_science';
reset role;
select is(
  (select usage_count from tests.usage),
  (select count(*) from public.profiles where program_code = 'computer_science')
  + (select count(*) from public.resources where program_code = 'computer_science'),
  'Le nombre d''usages d''une filière compte les profils et les fiches, pas les projets de recherche'
);

-- ---------------------------------------------------------------------------
-- Journal d'audit : table et code en cible, noms des champs, jamais un libellé
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select action, target_type, target_id, metadata from public.audit_logs
     where actor_id = 'b0000000-0000-0000-0000-000000007601' and action like 'reference.%'
       and target_id like '%zz_test_subject' and target_id like 'computer_science/%' order by id $$,
  $$ values ('reference.created', 'subjects', 'computer_science/zz_test_subject', '{"fields": ["labels", "position", "program_code"]}'::jsonb),
            ('reference.activated', 'subjects', 'computer_science/zz_test_subject', '{}'::jsonb),
            ('reference.updated', 'subjects', 'computer_science/zz_test_subject', '{"fields": ["labels"]}'::jsonb),
            ('reference.updated', 'subjects', 'computer_science/zz_test_subject', '{"fields": ["position"]}'::jsonb) $$,
  'Création, activation et modifications sont journalisées ; une écriture sans changement ne l''est pas'
);
select results_eq(
  $$ select action, target_type, target_id, category from public.audit_logs
     where actor_id = 'b0000000-0000-0000-0000-000000007601' and action = 'reference.deactivated' and target_type = 'countries' $$,
  $$ values ('reference.deactivated', 'countries', 'SN', 'platform') $$,
  'La désactivation aussi, dans la catégorie de la plateforme'
);
select isnt_empty(
  $$ select 1 from public.audit_logs
     where actor_id = 'b0000000-0000-0000-0000-000000007601' and action = 'reference.updated'
       and target_type = 'academic_programs' and target_id = 'zz_filiere' and metadata = '{"fields": ["domain_code"]}'::jsonb $$,
  'Le changement de domaine d''une filière est journalisé par le nom du champ'
);
select is(
  (select count(*) from public.audit_logs
   where actor_id = 'b0000000-0000-0000-0000-000000007601' and action like 'reference.%'
     and (metadata::text ~* 'zzlibelle|wolof|sénégal' or metadata - 'fields' <> '{}'::jsonb)),
  0::bigint, 'Le journal ne porte aucun libellé : seulement les noms des champs'
);
select is(
  (select count(*) from public.audit_logs
   where actor_id = 'b0000000-0000-0000-0000-000000007601' and action like 'reference.%'
     and (action not in ('reference.created', 'reference.updated', 'reference.activated', 'reference.deactivated')
          or category <> 'platform')),
  0::bigint, 'Les actions sont celles de la liste, dans la catégorie de la plateforme'
);

-- ---------------------------------------------------------------------------
-- Plafonds
-- ---------------------------------------------------------------------------
insert into public.academic_domains (code, labels, is_active)
select 'zzcap_' || n, '{"fr": "Plafond", "en": "Cap"}'::jsonb, false
from generate_series(1, 2000) as n;
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok(
  $$ select public.admin_save_reference_item('academic_domains', '{"code": "zz_de_trop", "labels": {"fr": "De trop", "en": "Too many"}}') $$,
  'P0001', 'limit_reached', 'Deux mille lignes au plus par table'
);
select is(
  public.admin_save_reference_item('academic_domains', '{"code": "zz_domaine", "labels": {"fr": "Domaine zzlibelle revu", "en": "Domain zzlibelle"}}'),
  '{"created": false}'::jsonb, 'Le plafond n''empêche pas de modifier une ligne existante'
);
reset role;
insert into private.rate_limit_buckets (bucket_key, window_start, hits)
values ('reference-write:user:' || left(encode(sha256(convert_to('reference-write:b0000000-0000-0000-0000-000000007601', 'UTF8')), 'hex'), 40),
        to_timestamp(floor(extract(epoch from clock_timestamp()) / 3600) * 3600), 120)
on conflict (bucket_key, window_start) do update set hits = 120;
select tests.login('b0000000-0000-0000-0000-000000007601', 'aal2', 30);
select throws_ok(
  $$ select public.admin_save_reference_item('countries', '{"code": "CI", "labels": {"fr": "Côte d''Ivoire", "en": "Ivory Coast"}}') $$,
  'P0001', 'rate_limited', 'Cent vingt écritures par heure et par administrateur'
);
select throws_ok(
  $$ select public.admin_set_reference_active('countries', 'CI', false) $$,
  'P0001', 'rate_limited', 'Activations et désactivations comptent dans le même plafond'
);
reset role;

select * from finish();
rollback;
