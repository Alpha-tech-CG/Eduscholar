-- Sources d'un projet et fiches de lecture (C-02).

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
grant execute on all functions in schema tests to anon, authenticated, service_role;

create table tests.ids (label text primary key, id uuid);
grant all on tests.ids to authenticated;

-- Acteurs : A et B au profil complété ; M modératrice.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000023d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'src-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000023d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'src-b@test.invalid'),
  ('d0000000-0000-0000-0000-0000000023d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'src-m@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-0000000023d_';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000023d4', 'd0000000-0000-0000-0000-0000000023d4', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-0000000023d4', 'moderator');

-- Fiches du catalogue : P publiée, W en attente.
insert into public.resources
  (id, type_code, title, authors, publication_year, institution_name, language_code, program_code, source_kind,
   source_name, doi, official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('23d00000-0000-0000-0000-000000000001', 'article', 'Article publié du catalogue', array['Awa Diop', 'Kofi Mensah'], 2021,
   'Université de test', 'fr', 'computer_science', 'connector', 'test', '10.5555/src.test.1',
   'https://exemple.invalid/p', 'open_access', 'published', now(), now()),
  ('23d00000-0000-0000-0000-000000000002', 'article', 'Article en attente', array['Auteur Test'], 2022,
   null, 'fr', 'computer_science', 'connector', 'test', null,
   'https://exemple.invalid/w', 'open_access', 'pending', null, null);

-- Projets de A et de B.
insert into public.research_projects (id, owner_id, title) values
  ('23d00000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000023d1', 'Projet de A'),
  ('23d00000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000023d2', 'Projet de B');

-- ---------------------------------------------------------------------------
-- Sources saisies
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000023d1');
insert into tests.ids
select 's1', public.add_project_source('23d00000-0000-0000-0000-0000000000a1', jsonb_build_object(
  'source_type', 'article',
  'title', '  Apprentissage profond pour la détection  ',
  'authors', jsonb_build_array('Yann Martin', 'Awa Diop'),
  'publication_year', '2020',
  'container_title', 'Revue de test',
  'volume', '12', 'issue', '3', 'pages', '45-67',
  'doi', '10.5555/SRC.Saisie',
  'url', 'https://exemple.invalid/article',
  'accessed_on', '2026-09-30',
  'project_id', '23d00000-0000-0000-0000-0000000000b1',
  'resource_id', '23d00000-0000-0000-0000-000000000002'
));
select results_eq(
  $$ select project_id, resource_id, source_type, title, authors, publication_year, container_title, pages, doi, accessed_on
     from public.project_sources $$,
  $$ values ('23d00000-0000-0000-0000-0000000000a1'::uuid, null::uuid, 'article',
             'Apprentissage profond pour la détection', array['Yann Martin', 'Awa Diop'], 2020::smallint,
             'Revue de test', '45-67', '10.5555/src.saisie', '2026-09-30'::date) $$,
  'A ajoute une source à son projet ; projet et fiche du catalogue ne viennent pas de la requête'
);

select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "   "}') $$,
  '23514', null, 'Un titre vide est refusé'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Lien", "url": "javascript:alert(1)"}') $$,
  '23514', null, 'Une adresse dangereuse est refusée'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Lien", "url": "https://vrai.example@autre.example/"}') $$,
  '23514', null, 'Une adresse avec identifiants est refusée'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "DOI", "doi": "pas-un-doi"}') $$,
  '23514', null, 'Un DOI mal formé est refusé'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Année", "publication_year": "deux mille"}') $$,
  '22023', 'invalid_payload', 'Une année non numérique est refusée'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Date", "accessed_on": "today"}') $$,
  '22007', 'invalid_date', 'Une date de consultation spéciale est refusée'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Type", "source_type": "tweet"}') $$,
  '23514', null, 'Un type inconnu est refusé'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', jsonb_build_object('title', E'Titre ‮déguisé')) $$,
  '23514', null, 'Un caractère de format invisible est refusé'
);
select throws_ok(
  $$ insert into public.project_sources (project_id, title) values ('23d00000-0000-0000-0000-0000000000a1', 'Directe') $$,
  '42501', null, 'Aucune écriture directe dans les sources'
);
select throws_ok(
  $$ insert into public.literature_notes (source_id) values ((select id from tests.ids where label = 's1')) $$,
  '42501', null, 'Ni dans les fiches de lecture'
);

-- Modification partielle.
select lives_ok(
  $$ select public.update_project_source((select id from tests.ids where label = 's1'), '{"pages": "45-70", "issue": ""}') $$,
  'A corrige les pages et vide le numéro'
);
select results_eq(
  $$ select title, pages, issue, volume from public.project_sources $$,
  $$ values ('Apprentissage profond pour la détection', '45-70', null::text, '12') $$,
  'Seuls les champs présents sont écrits'
);

-- ---------------------------------------------------------------------------
-- Source reprise du catalogue
-- ---------------------------------------------------------------------------
insert into tests.ids
select 's2', public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '23d00000-0000-0000-0000-000000000001');
select results_eq(
  $$ select resource_id, source_type, title, authors, publication_year, publisher, doi, url, accessed_on
     from public.project_sources where id = (select id from tests.ids where label = 's2') $$,
  $$ values ('23d00000-0000-0000-0000-000000000001'::uuid, 'article', 'Article publié du catalogue',
             array['Awa Diop', 'Kofi Mensah'], 2021::smallint, null::text, '10.5555/src.test.1',
             'https://exemple.invalid/p', null::date) $$,
  'Une fiche publiée est reprise ; rien n''est complété, et l''institution d''un article n''est pas prise pour son éditeur'
);
select is(
  public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '23d00000-0000-0000-0000-000000000001'),
  (select id from tests.ids where label = 's2'),
  'Reprise deux fois, la même source est renvoyée'
);
select throws_ok(
  $$ select public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '23d00000-0000-0000-0000-000000000002') $$,
  null, 'not_found', 'Une fiche non publiée ne se reprend pas'
);
select throws_ok(
  $$ select public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '99999999-0000-0000-0000-000000000000') $$,
  null, 'not_found', 'Même réponse pour une fiche inexistante'
);
select is((select count(*) from public.project_sources), 2::bigint, 'Le projet a deux sources');
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', jsonb_build_object('title', E'Titre\uFEFFcaché')) $$,
  '23514', null, 'Une marque invisible est refusée dans un titre'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', jsonb_build_object('title', 'Titre', 'authors', jsonb_build_array(E'Nom\u2060caché'))) $$,
  '23514', null, 'Et dans un nom d''auteur'
);
select throws_ok(
  $$ update public.project_sources set title = 'Directe' $$, '42501', null, 'Aucune modification directe d''une source'
);
select throws_ok($$ delete from public.project_sources $$, '42501', null, 'Aucune suppression directe');


-- ---------------------------------------------------------------------------
-- Fiche de lecture
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.save_literature_note((select id from tests.ids where label = 's1'), jsonb_build_object(
       'problem', 'Détection d''attaques inconnues',
       'method', E'Réseau convolutif.\nValidation croisée.',
       'results', 'Précision de 97 %',
       'useful_quote', 'Le modèle généralise mal hors du jeu d''entraînement.',
       'quote_pages', 'p. 52',
       'target_chapter', 'État de l''art',
       'source_id', (select id from tests.ids where label = 's2')
     )) $$,
  'A rédige la fiche de lecture de sa source'
);
select results_eq(
  $$ select source_id, problem, method, results, quote_pages, target_chapter, limits is null from public.literature_notes $$,
  $$ values ((select id from tests.ids where label = 's1'), 'Détection d''attaques inconnues',
             E'Réseau convolutif.\nValidation croisée.', 'Précision de 97 %', 'p. 52', 'État de l''art', true) $$,
  'La fiche est rattachée à la source demandée, pas à celle de la requête'
);
select lives_ok(
  $$ select public.save_literature_note((select id from tests.ids where label = 's1'), '{"limits": "Un seul jeu de données", "results": ""}') $$,
  'Elle la complète ensuite'
);
select results_eq(
  $$ select problem, limits, results from public.literature_notes $$,
  $$ values ('Détection d''attaques inconnues', 'Un seul jeu de données', null::text) $$,
  'Une seule fiche par source ; seuls les champs présents changent'
);
select throws_ok(
  $$ select public.save_literature_note((select id from tests.ids where label = 's1'), jsonb_build_object('problem', repeat('a', 3001))) $$,
  '23514', null, 'Un texte trop long est refusé'
);
reset role;

-- ---------------------------------------------------------------------------
-- Cloisonnement
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-0000000023d2');
select is_empty($$ select 1 from public.project_sources $$, 'B ne lit pas les sources de A');
select is_empty($$ select 1 from public.literature_notes $$, 'Ni ses fiches de lecture');
select is_empty($$ select private.my_source_ids() $$, 'La fonction d''appui ne lui rend rien');
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Intruse"}') $$,
  null, 'not_found', 'B n''ajoute pas de source au projet de A'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "", "publication_year": "x", "accessed_on": "y"}') $$,
  null, 'not_found', 'Une requête invalide sur le projet de A répond aussi « introuvable »'
);
select throws_ok(
  $$ select public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '23d00000-0000-0000-0000-000000000001') $$,
  null, 'not_found', 'Ni ne reprend une fiche dans le projet de A'
);
select throws_ok(
  $$ select public.update_project_source((select id from tests.ids where label = 's1'), '{"title": "Piratée"}') $$,
  null, 'not_found', 'B ne modifie pas la source de A'
);
select throws_ok(
  $$ select public.update_project_source('99999999-0000-0000-0000-000000000000', '{"title": "Piratée"}') $$,
  null, 'not_found', 'Même réponse pour une source inexistante'
);
select throws_ok(
  $$ select public.update_project_source((select id from tests.ids where label = 's1'), '"texte"') $$,
  null, 'not_found', 'Et pour une charge utile mal formée'
);
select throws_ok(
  $$ select public.delete_project_source((select id from tests.ids where label = 's1')) $$,
  null, 'not_found', 'B ne supprime pas la source de A'
);
select throws_ok(
  $$ select public.save_literature_note((select id from tests.ids where label = 's1'), '{"problem": "Piratée"}') $$,
  null, 'not_found', 'B n''écrit pas la fiche de lecture de A'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '"texte"') $$,
  null, 'not_found', 'Une charge utile mal formée visant le projet de A répond « introuvable »'
);
select throws_ok(
  $$ select public.save_literature_note((select id from tests.ids where label = 's1'), '"texte"') $$,
  null, 'not_found', 'De même pour sa fiche de lecture'
);
-- B, dans son propre projet, ne peut pas viser la source de A.
select lives_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000b1', '{"title": "Source de B"}') $$,
  'B ajoute une source à son propre projet'
);
select is((select count(*) from public.project_sources), 1::bigint, 'B ne voit que la sienne');
reset role;

select tests.login('d0000000-0000-0000-0000-0000000023d4', 'aal2');
select is_empty($$ select 1 from public.project_sources $$, 'La modération ne lit aucune source de projet');
select is_empty($$ select 1 from public.literature_notes $$, 'Ni aucune fiche de lecture');
select throws_ok(
  $$ select public.delete_project_source((select id from tests.ids where label = 's1')) $$,
  null, 'not_found', 'Ni n''en supprime'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select 1 from public.project_sources $$, '42501', null, 'Le rôle serveur ne lit pas les sources');
select throws_ok($$ select 1 from public.literature_notes $$, '42501', null, 'Ni les fiches de lecture');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select 1 from public.project_sources $$, '42501', null, 'Un visiteur ne lit pas les sources');
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Visiteur"}') $$,
  '42501', null, 'Ni n''en ajoute'
);
reset role;

select is(
  (select count(*) from public.project_sources where project_id = '23d00000-0000-0000-0000-0000000000a1'),
  2::bigint, 'Les sources de A sont intactes'
);
select is(
  (select problem from public.literature_notes where source_id = (select id from tests.ids where label = 's1')),
  'Détection d''attaques inconnues', 'Sa fiche de lecture aussi'
);

-- ---------------------------------------------------------------------------
-- Fiche du catalogue retirée, plafond, suppressions
-- ---------------------------------------------------------------------------
-- La fiche reprise est retirée du catalogue : la source garde sa copie.
update public.resources set editorial_status = 'removed' where id = '23d00000-0000-0000-0000-000000000001';
select tests.login('a0000000-0000-0000-0000-0000000023d1');
select is(
  (select title from public.project_sources where id = (select id from tests.ids where label = 's2')),
  'Article publié du catalogue', 'Une source reprise survit au retrait de la fiche du catalogue'
);
reset role;
delete from public.resources where id = '23d00000-0000-0000-0000-000000000001';
select results_eq(
  $$ select title, resource_id from public.project_sources where id = (select id from tests.ids where label = 's2') $$,
  $$ values ('Article publié du catalogue', null::uuid) $$,
  'Et même à sa suppression : seul le lien est rompu'
);

-- Thèse reprise : l'établissement de soutenance est repris. Fiche suspendue : refusée.
insert into public.resources
  (id, type_code, title, authors, publication_year, institution_name, language_code, program_code, source_kind,
   source_name, official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('23d00000-0000-0000-0000-000000000003', 'thesis', 'Thèse publiée', array['Awa Diop'], 2019, 'Université de test',
   'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/these', 'open_access', 'published', now(), now()),
  ('23d00000-0000-0000-0000-000000000004', 'article', 'Article suspendu', array['Awa Diop'], 2019, null,
   'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/suspendu', 'open_access', 'suspended', now(), now());
select tests.login('a0000000-0000-0000-0000-0000000023d1');
insert into tests.ids
select 's3', public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '23d00000-0000-0000-0000-000000000003');
select is(
  (select publisher from public.project_sources where id = (select id from tests.ids where label = 's3')),
  'Université de test', 'Pour une thèse, l''établissement est repris'
);
select throws_ok(
  $$ select public.add_project_source_from_resource('23d00000-0000-0000-0000-0000000000a1', '23d00000-0000-0000-0000-000000000004') $$,
  null, 'not_found', 'Une fiche suspendue ne se reprend pas'
);
reset role;

-- Plafond de trois cents sources.
insert into public.project_sources (project_id, title)
select '23d00000-0000-0000-0000-0000000000a1', 'Source ' || g from generate_series(1, 297) g;
select tests.login('a0000000-0000-0000-0000-0000000023d1');
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Une de trop"}') $$,
  null, 'limit_reached', 'Trois cents sources au plus par projet'
);

-- Suppression d'une source : sa fiche de lecture part avec elle.
select lives_ok(
  $$ select public.delete_project_source((select id from tests.ids where label = 's1')) $$, 'A supprime une source'
);
select is_empty($$ select 1 from public.literature_notes $$, 'Sa fiche de lecture est supprimée');

-- Projet supprimé : ses sources cessent aussitôt d'être lisibles.
select lives_ok($$ select public.delete_project('23d00000-0000-0000-0000-0000000000a1') $$, 'A supprime son projet');
select is_empty($$ select 1 from public.project_sources $$, 'Ses sources ne sont plus lisibles');
select is_empty($$ select 1 from public.literature_notes $$, 'Ni leurs fiches de lecture');
select throws_ok(
  $$ select public.save_literature_note((select id from tests.ids where label = 's2'), '{"problem": "Revenante"}') $$,
  null, 'not_found', 'Une fiche de lecture ne s''écrit plus'
);
select throws_ok(
  $$ select public.delete_project_source((select id from tests.ids where label = 's2')) $$,
  null, 'not_found', 'Une source ne se supprime plus'
);
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000a1', '{"title": "Revenante"}') $$,
  null, 'not_found', 'Ni ne s''enrichissent'
);
select throws_ok(
  $$ select public.update_project_source((select id from tests.ids where label = 's2'), '{"title": "Revenante"}') $$,
  null, 'not_found', 'Ni ne se modifient'
);
reset role;

-- Plafond quotidien, projets supprimés compris : B a déjà ajouté une source.
insert into public.research_projects (id, owner_id, title, deleted_at) values
  ('23d00000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-0000000023d2', 'Projet supprimé de B', now());
insert into public.project_sources (project_id, title)
select '23d00000-0000-0000-0000-0000000000b2', 'Éphémère ' || g from generate_series(1, 599) g;
select tests.login('b0000000-0000-0000-0000-0000000023d2');
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000b1', '{"title": "Une de plus aujourd''hui"}') $$,
  null, 'rate_limited', 'Six cents ajouts par jour au plus, sources des projets supprimés comprises'
);
reset role;

-- Compte suspendu : ni lecture, ni écriture.
insert into private.account_status (user_id, status, changed_by)
values ('b0000000-0000-0000-0000-0000000023d2', 'suspended', 'd0000000-0000-0000-0000-0000000023d4');
select tests.login('b0000000-0000-0000-0000-0000000023d2');
select is_empty($$ select 1 from public.project_sources $$, 'Un compte suspendu ne lit plus ses sources');
select throws_ok(
  $$ select public.add_project_source('23d00000-0000-0000-0000-0000000000b1', '{"title": "Suspendu"}') $$,
  '42501', 'forbidden', 'Ni n''en ajoute'
);
reset role;

-- Purge du projet : tout part en cascade.
update public.research_projects set deleted_at = now() - interval '31 days'
  where id = '23d00000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok(public.purge_deleted_projects() >= 1, 'La purge efface le projet');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*) from public.project_sources where project_id = '23d00000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Ses sources sont effacées avec lui'
);

select * from finish();
rollback;
