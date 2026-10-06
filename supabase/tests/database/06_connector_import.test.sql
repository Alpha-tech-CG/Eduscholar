-- Import d'une fiche par un connecteur, au nom d'un modérateur (B-15).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.work(p_overrides jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'source_name', 'crossref',
    'source_identifier', '10.5555/import.test.1',
    'type_code', 'article',
    'title', 'Article importé pour les tests',
    'authors', jsonb_build_array('Awa Diop', 'Collectif de test'),
    'publication_year', '2024',
    'language_code', 'fr',
    'program_code', 'computer_science',
    'doi', '10.5555/import.test.1',
    'official_url', 'https://doi.org/10.5555/import.test.1',
    'license_code', 'cc-by-4.0'
  ) || p_overrides;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

create table tests.results (label text primary key, value jsonb);
grant all on tests.results to service_role;

-- Acteurs : modératrice M (facteur antérieur au rôle), utilisateur U sans rôle,
-- modérateur S suspendu, modérateur T dont le facteur est postérieur au rôle.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'imp-m@test.invalid'),
  ('b0000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'imp-u@test.invalid'),
  ('c0000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'imp-s@test.invalid'),
  ('d0000000-0000-0000-0000-0000000001b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'imp-t@test.invalid'),
  ('e0000000-0000-0000-0000-0000000001b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'imp-n@test.invalid'),
  ('f0000000-0000-0000-0000-0000000001b6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'imp-p@test.invalid');

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000001b1', 'a0000000-0000-0000-0000-0000000001b1', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-0000000001b3', 'c0000000-0000-0000-0000-0000000001b3', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-0000000001b4', 'd0000000-0000-0000-0000-0000000001b4', 'test', 'totp', 'verified', now() + interval '1 hour', now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-0000000001b5', 'e0000000-0000-0000-0000-0000000001b5', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-0000000001b6', 'f0000000-0000-0000-0000-0000000001b6', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');

insert into public.platform_roles (user_id, role) values
  ('a0000000-0000-0000-0000-0000000001b1', 'moderator'),
  ('c0000000-0000-0000-0000-0000000001b3', 'moderator'),
  ('d0000000-0000-0000-0000-0000000001b4', 'moderator'),
  ('e0000000-0000-0000-0000-0000000001b5', 'moderator'),
  ('f0000000-0000-0000-0000-0000000001b6', 'platform_admin');

update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-0000000001b1', 'e0000000-0000-0000-0000-0000000001b5');

insert into private.account_status (user_id, status)
values ('c0000000-0000-0000-0000-0000000001b3', 'suspended');

-- ---------------------------------------------------------------------------
-- Qui peut appeler
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000001b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1', tests.work()) $$,
  '42501', null, 'Une modératrice n''appelle pas l''import elle-même : les métadonnées viennent du serveur'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1', tests.work()) $$,
  '42501', null, 'Un visiteur n''appelle pas l''import'
);
reset role;

-- ---------------------------------------------------------------------------
-- Rôle serveur : l'acteur est revérifié
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select throws_ok(
  $$ select public.import_connector_resource('b0000000-0000-0000-0000-0000000001b2', tests.work()) $$,
  '42501', 'forbidden', 'Pas d''import au nom d''un compte sans rôle de modération'
);
select throws_ok(
  $$ select public.import_connector_resource('c0000000-0000-0000-0000-0000000001b3', tests.work()) $$,
  '42501', 'forbidden', 'Pas d''import au nom d''un modérateur suspendu'
);
select throws_ok(
  $$ select public.import_connector_resource('d0000000-0000-0000-0000-0000000001b4', tests.work()) $$,
  '42501', 'forbidden', 'Pas d''import au nom d''un modérateur dont le facteur est postérieur au rôle'
);
select throws_ok(
  $$ select public.import_connector_resource('f0000000-0000-0000-0000-0000000001b6', tests.work()) $$,
  '42501', 'forbidden', 'Pas d''import au nom d''un administrateur qui n''est pas modérateur'
);
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
       tests.work('{"program_code": "filiere_inconnue"}')) $$,
  null, null, 'Une filière hors référentiel est refusée'
);
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
       tests.work('{"language_code": "zz"}')) $$,
  null, null, 'Une langue hors référentiel est refusée'
);
select throws_ok(
  $$ select public.import_connector_resource(null, tests.work()) $$,
  '42501', 'forbidden', 'Pas d''import sans acteur'
);
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
       tests.work('{"source_name": "site-quelconque"}')) $$,
  '22023', 'source_not_allowed', 'Seules les sources de la liste fermée sont admises'
);
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
       tests.work('{"official_url": "javascript:alert(1)"}')) $$,
  '23514', null, 'Les contraintes du catalogue valent pour un import'
);
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
       tests.work('{"license_code": "gratuit"}')) $$,
  '23514', 'invalid_license', 'Une licence hors référentiel est refusée'
);

-- Import réussi.
insert into tests.results
select 'premier', public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
  tests.work('{"editorial_status": "published", "access_status": "open_access", "submitted_by": "b0000000-0000-0000-0000-0000000001b2", "abstract": "À ne pas reprendre"}'));
insert into tests.results
select 'rejeu', public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1', tests.work());
reset role;
select set_config('request.jwt.claims', '', true);

select is((select value ->> 'created' from tests.results where label = 'premier'), 'true', 'La fiche est créée');
select results_eq(
  $$ select editorial_status, access_status, license_code, source_kind, source_name, source_identifier,
            visibility, submitted_by is null, abstract is null, retrieved_at is not null,
            last_verified_at is null, published_at is null, doi, authors
     from public.resources
     where id = (select (value ->> 'id')::uuid from tests.results where label = 'premier') $$,
  $$ values ('pending', 'unknown', 'cc-by-4.0', 'connector', 'crossref', '10.5555/import.test.1',
             'public', true, true, true, true, true, '10.5555/import.test.1',
             array['Awa Diop', 'Collectif de test']) $$,
  'Elle arrive en attente, au statut d''accès inconnu, avec sa provenance ; statut, contributeur et résumé fournis sont ignorés'
);
select is(
  (select value from tests.results where label = 'rejeu'),
  jsonb_build_object('id', (select value -> 'id' from tests.results where label = 'premier'), 'created', false),
  'Le même import rejoué renvoie la fiche existante sans doublon'
);
select is(
  (select count(*) from public.resources where source_name = 'crossref' and source_identifier = '10.5555/import.test.1'),
  1::bigint, 'Une seule fiche pour cette entrée de la source'
);
select results_eq(
  $$ select action, to_status, actor_id from public.resource_status_history
     where resource_id = (select (value ->> 'id')::uuid from tests.results where label = 'premier') $$,
  $$ values ('imported', 'pending', 'a0000000-0000-0000-0000-0000000001b1'::uuid) $$,
  'L''historique garde l''import et son auteur'
);
select results_eq(
  $$ select action, actor_id, metadata ->> 'source' from public.audit_logs
     where target_id = (select value ->> 'id' from tests.results where label = 'premier') $$,
  $$ values ('resource.imported', 'a0000000-0000-0000-0000-0000000001b1'::uuid, 'crossref') $$,
  'Le journal d''audit consigne l''import'
);
select is(
  (select count(*) from public.resource_internal
   where resource_id = (select (value ->> 'id')::uuid from tests.results where label = 'premier')),
  1::bigint, 'La fiche a sa ligne de notes internes'
);

-- Un DOI déjà porté par une fiche validée n'est pas réimporté sous un autre identifiant.
update public.resources
  set editorial_status = 'verified', access_status = 'open_access', last_verified_at = now()
  where source_identifier = '10.5555/import.test.1';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into tests.results
select 'meme-doi', public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
  tests.work('{"source_identifier": "autre-identifiant"}'));
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select value from tests.results where label = 'meme-doi'),
  jsonb_build_object('id', (select value -> 'id' from tests.results where label = 'premier'), 'created', false),
  'Un DOI déjà validé renvoie à la fiche existante'
);

-- Circuit ordinaire, avec second regard : l'importatrice prend en charge, mais
-- ne vérifie pas ; un autre modérateur le fait.
update public.resources set editorial_status = 'pending', access_status = 'unknown', last_verified_at = null
  where source_identifier = '10.5555/import.test.1';
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000001b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.moderate_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'), 'start_review', null) $$,
  'Une fiche importée se prend en charge comme une autre'
);
select throws_ok(
  $$ select public.moderate_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'), 'verify', null) $$,
  '42501', 'own_submission', 'Qui a importé une fiche ne la vérifie pas'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000001b5","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.moderate_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'), 'verify', null) $$,
  '23514', 'access_status_required', 'Un autre modérateur ne la vérifie pas tant que son statut d''accès est inconnu'
);
select lives_ok(
  $$ select public.moderator_update_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'),
       '{"access_status": "open_access"}') $$,
  'Il renseigne le statut d''accès'
);
select lives_ok(
  $$ select public.moderate_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'), 'verify', null) $$,
  'Puis il la vérifie'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000001b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.moderate_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'), 'publish', null) $$,
  '42501', 'own_submission', 'Qui a importé une fiche ne la publie pas non plus'
);
select lives_ok(
  $$ select public.moderate_resource(
       (select id from public.resources where source_identifier = '10.5555/import.test.1'), 'reject', 'Refus de test') $$,
  'Elle peut en revanche la refuser'
);
reset role;

-- Une fiche refusée n'empêche pas un nouvel import de la même entrée.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into tests.results
select 'apres-refus', public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1', tests.work());
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select value ->> 'created' from tests.results where label = 'apres-refus'), 'true',
  'Après un refus, la même entrée se réimporte'
);

-- Limite journalière par modérateur.
insert into public.resource_status_history (resource_id, from_status, to_status, action, actor_id)
select (select (value ->> 'id')::uuid from tests.results where label = 'apres-refus'),
       null, 'pending', 'imported', 'a0000000-0000-0000-0000-0000000001b1'
from generate_series(1, 200);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok(
  $$ select public.import_connector_resource('a0000000-0000-0000-0000-0000000001b1',
       tests.work('{"source_identifier": "10.5555/import.test.2", "doi": "10.5555/import.test.2"}')) $$,
  null, 'rate_limited', 'Au-delà de deux cents imports par jour, l''import est refusé'
);
reset role;

select * from finish();
rollback;
