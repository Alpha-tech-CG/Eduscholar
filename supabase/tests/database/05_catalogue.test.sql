-- Catalogue des ressources (B-13) : lecture, soumission, modération, signalement.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Charge utile d'une soumission valide, avec remplacements.
create function tests.payload(p_overrides jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'type_code', 'article',
    'title', 'Introduction aux arbres équilibrés',
    'abstract', 'Résumé de test.',
    'authors', jsonb_build_array('Awa Diop'),
    'publication_year', 2024,
    'language_code', 'fr',
    'country_code', 'SN',
    'program_code', 'computer_science',
    'level_codes', jsonb_build_array('bachelor_3'),
    'subject_codes', jsonb_build_array('algorithms', 'data_structures'),
    'tags', jsonb_build_array('arbres', 'complexité'),
    'official_url', 'https://exemple.invalid/article',
    'access_status', 'open_access',
    'license_code', 'cc-by-4.0',
    'rights_declared', true
  ) || p_overrides;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Résultats relevés sous l'identité d'un acteur.
create table tests.ids (label text primary key, id uuid);
grant all on tests.ids to authenticated, service_role;

-- Acteurs : contributrice A, contributeur B, modératrice M, second modérateur N,
-- compte non complété U.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat-a@test.invalid'),
  ('b0000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat-b@test.invalid'),
  ('c0000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat-m@test.invalid'),
  ('d0000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat-n@test.invalid'),
  ('e0000000-0000-0000-0000-00000000ca05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat-u@test.invalid');

update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science',
      age_confirmed_at = now()
  where user_id in (
    'a0000000-0000-0000-0000-00000000ca01', 'b0000000-0000-0000-0000-00000000ca02',
    'c0000000-0000-0000-0000-00000000ca03', 'd0000000-0000-0000-0000-00000000ca04'
  );

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-00000000ca03', 'c0000000-0000-0000-0000-00000000ca03', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-00000000ca04', 'd0000000-0000-0000-0000-00000000ca04', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');

insert into public.platform_roles (user_id, role) values
  ('c0000000-0000-0000-0000-00000000ca03', 'moderator'),
  ('d0000000-0000-0000-0000-00000000ca04', 'moderator');

-- ---------------------------------------------------------------------------
-- Référentiels du catalogue
-- ---------------------------------------------------------------------------
select is((select count(*) from public.resource_types where is_active), 6::bigint, 'Six types de ressources actifs pour le MVP');
select is((select count(*) from public.licenses), 11::bigint, 'Onze licences au référentiel');
select is(
  (select can_host from public.licenses where code = 'unknown'), 'no',
  'Une licence inconnue n''autorise pas l''hébergement'
);
select is(
  (select can_host from public.licenses where code = 'cc-by-nc-4.0'), 'review',
  'Une licence non commerciale est à analyser'
);

-- ---------------------------------------------------------------------------
-- Soumission
-- ---------------------------------------------------------------------------
-- Visiteur : rien.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select id from public.resources', '42501', null, 'Un visiteur ne lit pas le catalogue par l''API');
select throws_ok($$ select public.submit_resource('{}'::jsonb) $$, '42501', null, 'Un visiteur ne soumet rien');
reset role;

-- Compte qui n'a pas complété son profil.
select tests.login('e0000000-0000-0000-0000-00000000ca05');
select throws_ok(
  $$ select public.submit_resource(tests.payload()) $$,
  '42501', 'forbidden', 'Sans profil complété, pas de soumission'
);
reset role;

select tests.login('a0000000-0000-0000-0000-00000000ca01');

select throws_ok(
  $$ select public.submit_resource(tests.payload('{"rights_declared": false}')) $$,
  '22023', 'rights_declaration_required', 'La déclaration de droits est obligatoire'
);
select throws_ok(
  $$ insert into public.resources (type_code, title, language_code, program_code, source_kind, source_name)
     values ('article', 'Insertion directe', 'fr', 'computer_science', 'contribution', 'contribution') $$,
  '42501', null, 'Aucune insertion directe dans le catalogue'
);

insert into tests.ids select 'a1', public.submit_resource(tests.payload());
select isnt((select id from tests.ids where label = 'a1'), null, 'Une contributrice soumet une ressource');

-- Champs que le contributeur ne choisit pas.
insert into tests.ids select 'a2', public.submit_resource(tests.payload(
  '{"title": "Tentative de publication directe", "doi": "10.1234/TEST.Abc",
    "editorial_status": "published", "visibility": "organization",
    "submitted_by": "b0000000-0000-0000-0000-00000000ca02", "source_kind": "connector",
    "source_name": "openalex", "published_at": "2020-01-01T00:00:00Z"}'
));
reset role;

select results_eq(
  $$ select editorial_status, visibility, source_kind, source_name, submitted_by, published_at, doi
     from public.resources where id = (select id from tests.ids where label = 'a2') $$,
  $$ values ('pending', 'public', 'contribution', 'contribution',
             'a0000000-0000-0000-0000-00000000ca01'::uuid, null::timestamptz, '10.1234/test.abc') $$,
  'Statut, visibilité, provenance et auteur de la soumission sont fixés par la base ; le DOI est normalisé'
);
select is(
  (select count(*) from public.resource_internal where rights_declared_at is not null
     and resource_id in (select id from tests.ids)),
  2::bigint, 'La déclaration de droits est enregistrée et datée'
);

-- Valeurs refusées par la base.
select tests.login('a0000000-0000-0000-0000-00000000ca01');
select throws_ok($$ select public.submit_resource(tests.payload('{"official_url": "javascript:alert(1)"}')) $$, '23514', null, 'Une adresse javascript: est refusée');
select throws_ok($$ select public.submit_resource(tests.payload('{"official_url": "https://exemple.invalid/a b"}')) $$, '23514', null, 'Une adresse avec espace est refusée');
select throws_ok($$ select public.submit_resource(tests.payload('{"title": "ab"}')) $$, '23514', null, 'Un titre trop court est refusé');
select throws_ok($$ select public.submit_resource(tests.payload('{"type_code": "dataset"}')) $$, '23514', 'invalid_type', 'Un type désactivé est refusé');
select throws_ok($$ select public.submit_resource(tests.payload('{"license_code": "gratuit"}')) $$, '23514', 'invalid_license', 'Une licence inconnue du référentiel est refusée');
select throws_ok($$ select public.submit_resource(tests.payload('{"subject_codes": ["cuisine"]}')) $$, '23514', 'invalid_subject', 'Une matière étrangère à la filière est refusée');
select throws_ok($$ select public.submit_resource(tests.payload('{"level_codes": ["upper_secondary"]}')) $$, '23514', 'invalid_level', 'Un niveau désactivé est refusé');
select throws_ok($$ select public.submit_resource(tests.payload('{"tags": ["<script>"]}')) $$, '23514', null, 'Un mot-clé avec des caractères interdits est refusé');
select throws_ok($$ select public.submit_resource(tests.payload('{"doi": "pas-un-doi"}')) $$, '23514', null, 'Un DOI mal formé est refusé');
insert into tests.ids select 'dup', public.submit_resource(tests.payload('{"title": "Même DOI qu''une proposition en attente", "doi": "10.1234/test.abc"}'));
select isnt(
  (select id from tests.ids where label = 'dup'), null,
  'Une proposition en attente ne bloque pas celle d''un même DOI : rien ne se sonde ni ne se réserve'
);
select throws_ok($$ select public.submit_resource(tests.payload('{"access_status": "gratuit"}')) $$, '23514', null, 'Un statut d''accès hors liste est refusé');
select throws_ok($$ select public.submit_resource(tests.payload('{"thesis_degree": "master"}')) $$, '23514', null, 'Un niveau de diplôme n''a de sens que pour une thèse');

-- La contributrice lit ses soumissions, sans voir les notes internes.
select is((select count(*) from public.resources where id in (select id from tests.ids)), 3::bigint, 'A lit ses trois soumissions en attente');
select throws_ok($$ select submitted_by from public.resources $$, '42501', null, 'L''identité du contributeur n''est pas une colonne lisible');
select is_empty($$ select 1 from public.resource_internal $$, 'A ne lit pas les notes internes');
select is(
  (select count(*) from public.resource_status_history where resource_id in (select id from tests.ids)), 3::bigint,
  'A lit l''historique de ses soumissions'
);
select throws_ok($$ select actor_id from public.resource_status_history $$, '42501', null, 'L''auteur d''une décision n''est pas lisible');

-- Modification de sa soumission.
select lives_ok(
  $$ select public.update_submission((select id from tests.ids where label = 'a1'),
       tests.payload('{"title": "Introduction aux arbres équilibrés, version corrigée"}')) $$,
  'A modifie sa soumission en attente'
);
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'publish') $$,
  '42501', 'forbidden', 'Une contributrice ne publie pas sa soumission'
);
reset role;

-- B ne voit ni ne touche les soumissions de A.
select tests.login('b0000000-0000-0000-0000-00000000ca02');
select is_empty($$ select 1 from public.resources where id in (select id from tests.ids) $$, 'B ne voit pas les soumissions en attente de A');
select throws_ok(
  $$ select public.update_submission((select id from tests.ids where label = 'a1'), tests.payload()) $$,
  'P0001', 'not_found', 'B ne modifie pas la soumission de A : même réponse que si elle n''existait pas'
);
select throws_ok(
  $$ select public.withdraw_submission((select id from tests.ids where label = 'a1')) $$,
  'P0001', 'not_found', 'B ne retire pas la soumission de A'
);
select is_empty($$ select 1 from public.resource_status_history $$, 'B ne lit pas l''historique des soumissions de A');
reset role;

-- ---------------------------------------------------------------------------
-- Modération
-- ---------------------------------------------------------------------------
-- Sans second facteur, le rôle ne vaut rien.
select tests.login('c0000000-0000-0000-0000-00000000ca03', 'aal1');
select is_empty($$ select 1 from public.resources where id in (select id from tests.ids) $$, 'Une modératrice en aal1 ne voit pas la file d''attente');
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'start_review') $$,
  '42501', 'forbidden', 'Une modératrice en aal1 ne modère pas'
);
reset role;

select tests.login('c0000000-0000-0000-0000-00000000ca03', 'aal2');
select is((select count(*) from public.resources where id in (select id from tests.ids)), 3::bigint, 'La modératrice voit la file d''attente');
select is((select count(*) from public.resource_internal where resource_id in (select id from tests.ids)), 3::bigint, 'Elle lit les notes internes');

select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'publish') $$,
  'P0001', 'invalid_transition', 'Une ressource ne se publie pas sans vérification'
);
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'reject') $$,
  '22023', 'reason_required', 'Un refus se motive'
);
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'approve') $$,
  '22023', 'invalid_action', 'Une action inconnue est refusée'
);
select throws_ok(
  $$ select public.moderate_resource('00000000-0000-0000-0000-00000000dead', 'start_review') $$,
  'P0001', 'not_found', 'Une ressource inexistante'
);

select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'verify') $$,
  'P0001', 'invalid_transition',
  'Une fiche ne se vérifie pas tant qu''elle peut encore être modifiée par son contributeur'
);
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'start_review'), 'under_review', 'Prise en charge');
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'verify'), 'verified', 'Vérification');
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'publish'), 'published', 'Publication');

-- Demande de correction sur la seconde.
select is(
  public.moderate_resource((select id from tests.ids where label = 'a2'), 'request_changes', 'Merci de préciser la licence.'),
  'changes_requested', 'Demande de correction motivée'
);

-- La modératrice soumet elle-même une ressource : elle ne peut pas la traiter.
insert into tests.ids select 'm1', public.submit_resource(tests.payload('{"title": "Soumission de la modératrice"}'));
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'm1'), 'verify') $$,
  '42501', 'own_submission', 'Une modératrice ne vérifie pas sa propre soumission'
);
select throws_ok(
  $$ select public.moderator_update_resource((select id from tests.ids where label = 'm1'), '{"license_code": "cc0-1.0"}') $$,
  '42501', 'own_submission', 'Elle ne corrige pas non plus sa propre soumission'
);
select is_empty(
  $$ select 1 from public.resource_internal where resource_id = (select id from tests.ids where label = 'm1') $$,
  'Elle ne lit pas les notes internes de sa propre soumission'
);
reset role;

select results_eq(
  $$ select editorial_status, published_at is not null, last_verified_at is not null
     from public.resources where id = (select id from tests.ids where label = 'a1') $$,
  $$ values ('published', true, true) $$,
  'La publication date la vérification et la mise en ligne'
);
select is(
  (select count(*) from public.audit_logs
   where category = 'moderation' and target_id = (select id::text from tests.ids where label = 'a1')
     and actor_id = 'c0000000-0000-0000-0000-00000000ca03'),
  3::bigint, 'Chaque décision est journalisée avec la modératrice pour auteur'
);

-- Un autre modérateur traite la soumission de la modératrice.
select tests.login('d0000000-0000-0000-0000-00000000ca04', 'aal2');
select is(
  public.moderate_resource((select id from tests.ids where label = 'm1'), 'reject', 'Doublon.'),
  'rejected', 'Un autre modérateur traite la soumission de sa collègue'
);
reset role;

-- La contributrice : sa ressource publiée, le motif de la correction demandée.
select tests.login('a0000000-0000-0000-0000-00000000ca01');
select is(
  (select reason from public.resource_status_history
   where resource_id = (select id from tests.ids where label = 'a2') and action = 'request_changes'),
  'Merci de préciser la licence.', 'La contributrice lit le motif de la demande de correction'
);
select throws_ok(
  $$ select public.update_submission((select id from tests.ids where label = 'a1'), tests.payload()) $$,
  'P0001', 'invalid_transition', 'Une ressource publiée ne se modifie plus par son contributeur'
);
select throws_ok(
  $$ select public.withdraw_submission((select id from tests.ids where label = 'a1')) $$,
  'P0001', 'invalid_transition', 'Une ressource publiée ne se retire pas par cette voie'
);
select lives_ok(
  $$ select public.update_submission((select id from tests.ids where label = 'a2'),
       tests.payload('{"title": "Tentative corrigée", "doi": "10.1234/test.abc", "license_code": "cc0-1.0"}')) $$,
  'Elle corrige la soumission pour laquelle une correction est demandée'
);
reset role;
select is(
  (select editorial_status from public.resources where id = (select id from tests.ids where label = 'a2')),
  'pending', 'La soumission corrigée revient en attente'
);

-- B, simple utilisateur : la ressource publiée, et elle seule.
select tests.login('b0000000-0000-0000-0000-00000000ca02');
select results_eq(
  $$ select title from public.resources where id in (select id from tests.ids) $$,
  $$ values ('Introduction aux arbres équilibrés, version corrigée') $$,
  'Un utilisateur ne voit que les ressources publiées'
);

-- ---------------------------------------------------------------------------
-- Signalement
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.report_resource((select id from tests.ids where label = 'a1'), 'vengeance') $$,
  '23514', null, 'Un motif hors liste est refusé'
);
insert into tests.ids select 'r1', public.report_resource(
  (select id from tests.ids where label = 'a1'), 'broken_link', 'Le lien ne répond plus.'
);
select throws_ok(
  $$ select public.report_resource((select id from tests.ids where label = 'a1'), 'error') $$,
  'P0001', 'already_reported', 'Un seul signalement ouvert par personne et par ressource'
);
select throws_ok(
  $$ select public.report_resource((select id from tests.ids where label = 'a2'), 'error') $$,
  'P0001', 'not_found', 'Une ressource non publiée ne se signale pas : elle n''est pas censée être connue'
);
select is((select count(*) from public.resource_reports where resource_id in (select id from tests.ids)), 1::bigint, 'B lit son propre signalement');
select throws_ok($$ select reporter_id from public.resource_reports $$, '42501', null, 'L''identité du signaleur n''est pas lisible');
select throws_ok(
  $$ select public.resolve_report((select id from tests.ids where label = 'r1'), 'dismissed') $$,
  '42501', 'forbidden', 'Un utilisateur ne traite pas un signalement'
);
reset role;

-- A ne voit pas le signalement de B.
select tests.login('a0000000-0000-0000-0000-00000000ca01');
select is_empty($$ select 1 from public.resource_reports $$, 'La contributrice ne lit pas les signalements des autres');
reset role;

-- Le journal, lisible par la modération, ne porte pas l'identité du signaleur.
select is(
  (select actor_id from public.audit_logs
   where action = 'report.created' and target_id = (select id::text from tests.ids where label = 'r1')),
  null::uuid, 'Le signalement est journalisé sans son auteur'
);

-- La modératrice le traite, puis suspend la ressource.
select tests.login('c0000000-0000-0000-0000-00000000ca03', 'aal2');
select is((select count(*) from public.resource_reports where status = 'open' and resource_id in (select id from tests.ids)), 1::bigint, 'La modératrice voit le signalement ouvert');
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'suspend') $$,
  '22023', 'reason_required', 'Une suspension se motive'
);
select is(
  public.moderate_resource((select id from tests.ids where label = 'a1'), 'suspend', 'Lien cassé, en cours de vérification.'),
  'suspended', 'Suspension conservatoire'
);
select lives_ok(
  $$ select public.resolve_report((select id from tests.ids where label = 'r1'), 'resolved', 'Ressource suspendue.') $$,
  'Le signalement est traité'
);
select throws_ok(
  $$ select public.resolve_report((select id from tests.ids where label = 'r1'), 'dismissed') $$,
  'P0001', 'not_found', 'Un signalement déjà traité ne se retraite pas'
);
reset role;

-- Une ressource suspendue disparaît aussitôt pour les utilisateurs.
select tests.login('b0000000-0000-0000-0000-00000000ca02');
select is_empty($$ select 1 from public.resources where id in (select id from tests.ids) $$, 'Une ressource suspendue n''est plus visible');
select is(
  (select status from public.resource_reports), 'resolved',
  'Le signaleur voit que son signalement a été traité'
);
reset role;

-- Rétablissement, puis correction sensible : retour en attente.
select tests.login('c0000000-0000-0000-0000-00000000ca03', 'aal2');
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'restore'), 'published', 'Rétablissement');
select is(
  public.moderator_update_resource((select id from tests.ids where label = 'a1'), '{"tags": ["arbres"]}'),
  'published', 'Corriger les mots-clés ne dépublie pas'
);
select is(
  public.moderator_update_resource((select id from tests.ids where label = 'a1'), '{"license_code": "all-rights-reserved"}'),
  'pending', 'Changer la licence d''une ressource publiée la repasse en attente'
);
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'start_review'), 'under_review', 'Nouvelle prise en charge');
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'verify'), 'verified', 'Nouvelle vérification');
select is(public.moderate_resource((select id from tests.ids where label = 'a1'), 'publish'), 'published', 'Nouvelle publication');
select is(
  public.moderate_resource((select id from tests.ids where label = 'a1'), 'remove', 'Demande de l''ayant droit.'),
  'removed', 'Retrait définitif motivé'
);
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'a1'), 'restore') $$,
  'P0001', 'invalid_transition', 'Une ressource retirée ne se rétablit pas'
);
reset role;

select is(
  (select access_status from public.resources where id = (select id from tests.ids where label = 'a1')),
  'removed', 'Le retrait marque aussi le statut d''accès'
);
select cmp_ok(
  (select count(*) from public.resource_status_history where resource_id = (select id from tests.ids where label = 'a1')),
  '>=', 9::bigint, 'L''historique conserve toutes les décisions'
);
select throws_ok(
  $$ delete from public.resource_status_history $$,
  '42501', null, 'L''historique des décisions ne se supprime pas'
);

-- ---------------------------------------------------------------------------
-- Contraintes de publication et import par le serveur
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.resources (type_code, title, language_code, program_code, source_kind, source_name, editorial_status)
     values ('article', 'Sans lien officiel', 'fr', 'computer_science', 'connector', 'openalex', 'published') $$,
  '23514', null, 'Rien n''est publié sans lien officiel, date de vérification et auteur ou institution'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$ insert into public.resources (type_code, title, authors, language_code, program_code, official_url,
                                    source_kind, source_name, source_identifier, retrieved_at)
     values ('article', 'Importée par connecteur', array['Auteur Test'], 'en', 'computer_science',
             'https://exemple.invalid/w1', 'connector', 'openalex', 'W1', now()) $$,
  'Un connecteur crée une fiche en attente'
);
select throws_ok(
  $$ insert into public.resources (type_code, title, authors, language_code, program_code, official_url,
                                    source_kind, source_name, source_identifier, last_verified_at, editorial_status)
     values ('article', 'Importée et publiée', array['Auteur Test'], 'en', 'computer_science',
             'https://exemple.invalid/w2', 'connector', 'openalex', 'W2', now(), 'published') $$,
  '42501', 'import_must_be_pending', 'Un connecteur ne publie jamais'
);
select throws_ok(
  $$ update public.resources set editorial_status = 'verified' where source_identifier = 'W1' $$,
  '42501', 'status_change_requires_moderation', 'Un connecteur ne change pas un statut'
);
select throws_ok(
  $$ insert into public.resources (type_code, title, authors, language_code, program_code, official_url,
                                    source_kind, source_name, source_identifier)
     values ('article', 'Doublon de source', array['Auteur Test'], 'en', 'computer_science',
             'https://exemple.invalid/w1', 'connector', 'openalex', 'W1') $$,
  '23505', null, 'Une même entrée d''une même source n''est importée qu''une fois'
);
select throws_ok(
  $$ update public.resources set submitted_by = null
     where id = (select id from tests.ids where label = 'a2') $$,
  '42501', 'status_change_requires_moderation', 'Un connecteur n''efface pas le contributeur d''une fiche'
);
select throws_ok(
  $$ update public.resources set visibility = 'organization' where source_identifier = 'W1' $$,
  '42501', 'status_change_requires_moderation', 'Un connecteur ne change pas la visibilité'
);
select throws_ok(
  $$ insert into public.resources (type_code, title, authors, language_code, program_code, official_url,
                                    source_kind, source_name, source_identifier, submitted_by)
     values ('article', 'Import avec contributeur', array['Auteur Test'], 'en', 'computer_science',
             'https://exemple.invalid/w3', 'connector', 'openalex', 'W3',
             'a0000000-0000-0000-0000-00000000ca01') $$,
  '42501', 'import_must_be_pending', 'Un connecteur n''attribue pas une fiche à un contributeur'
);
select throws_ok($$ delete from public.resources $$, '42501', null, 'Un connecteur ne supprime aucune fiche');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Règles de vérification : DOI en double, statut d'accès, autorisation
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-00000000ca01');
insert into tests.ids select 'x1', public.submit_resource(tests.payload('{"title": "Premier exemplaire", "doi": "10.5555/double"}'));
insert into tests.ids select 'x2', public.submit_resource(tests.payload('{"title": "Second exemplaire", "doi": "10.5555/double"}'));
insert into tests.ids select 'x3', public.submit_resource(tests.payload('{"title": "Accès non précisé", "access_status": "unknown"}'));
insert into tests.ids select 'x4', public.submit_resource(tests.payload('{"title": "Autorisation sans preuve", "license_code": "author-permission"}'));
select throws_ok(
  $$ select public.submit_resource(tests.payload('{"official_url": "https://vrai.example@hostile.example/"}')) $$,
  '23514', null, 'Une adresse avec identifiants est refusée'
);
select throws_ok(
  $$ select public.submit_resource(tests.payload(jsonb_build_object('title', 'Titre ' || U&'\202E' || 'déguisé'))) $$,
  '23514', null, 'Un caractère de format invisible dans le titre est refusé'
);
reset role;

select tests.login('d0000000-0000-0000-0000-00000000ca04', 'aal2');
select is(public.moderate_resource((select id from tests.ids where label = 'x1'), 'start_review'), 'under_review', 'x1 pris en charge');
select is(public.moderate_resource((select id from tests.ids where label = 'x1'), 'verify'), 'verified', 'x1 vérifié');
select is(public.moderate_resource((select id from tests.ids where label = 'x2'), 'start_review'), 'under_review', 'x2 pris en charge');
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'x2'), 'verify') $$,
  '23505', 'duplicate_doi', 'Deux fiches de même DOI ne sont pas vérifiées toutes les deux'
);
select is(public.moderate_resource((select id from tests.ids where label = 'x3'), 'start_review'), 'under_review', 'x3 pris en charge');
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'x3'), 'verify') $$,
  '23514', 'access_status_required', 'Rien ne se vérifie avec un statut d''accès inconnu'
);
select is(public.moderate_resource((select id from tests.ids where label = 'x4'), 'start_review'), 'under_review', 'x4 pris en charge');
select throws_ok(
  $$ select public.moderate_resource((select id from tests.ids where label = 'x4'), 'verify') $$,
  '23514', 'permission_proof_required', 'Une autorisation d''ayant droit se prouve'
);
reset role;

-- Un modérateur ne classe pas un signalement visant sa propre proposition.
select tests.login('c0000000-0000-0000-0000-00000000ca03', 'aal2');
insert into tests.ids select 'm2', public.submit_resource(tests.payload('{"title": "Proposition signalée de la modératrice"}'));
reset role;
select tests.login('d0000000-0000-0000-0000-00000000ca04', 'aal2');
select is(public.moderate_resource((select id from tests.ids where label = 'm2'), 'start_review'), 'under_review', 'm2 pris en charge par un collègue');
select is(public.moderate_resource((select id from tests.ids where label = 'm2'), 'verify'), 'verified', 'm2 vérifié');
select is(public.moderate_resource((select id from tests.ids where label = 'm2'), 'publish'), 'published', 'm2 publié');
reset role;
select tests.login('a0000000-0000-0000-0000-00000000ca01');
insert into tests.ids select 'r2', public.report_resource((select id from tests.ids where label = 'm2'), 'error', 'Erreur dans la fiche.');
reset role;
select tests.login('c0000000-0000-0000-0000-00000000ca03', 'aal2');
select is_empty(
  $$ select 1 from public.resource_reports where id = (select id from tests.ids where label = 'r2') $$,
  'La modératrice ne lit pas le signalement visant sa propre proposition'
);
select throws_ok(
  $$ select public.resolve_report((select id from tests.ids where label = 'r2'), 'dismissed') $$,
  '42501', 'own_submission', 'Elle ne le classe pas non plus'
);
reset role;

-- ---------------------------------------------------------------------------
-- Limite de débit des soumissions
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-00000000ca02');
select lives_ok(
  $$ select public.submit_resource(tests.payload(jsonb_build_object('title', 'Soumission en série ' || n)))
     from generate_series(1, 10) as n $$,
  'Dix soumissions par jour sont acceptées'
);
select throws_ok(
  $$ select public.submit_resource(tests.payload('{"title": "La onzième"}')) $$,
  'P0001', 'rate_limited', 'La onzième est refusée'
);
reset role;

select * from finish();
rollback;
