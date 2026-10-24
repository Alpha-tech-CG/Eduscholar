-- LOT 7 : bibliothèque enrichie — notes, tags personnels, historique de
-- consultation, import de références vers un projet.

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

-- Acteurs : A et B ont un profil complété ; U non ; M est modératrice.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000038a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot7-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000038b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot7-b@test.invalid'),
  ('c0000000-0000-0000-0000-0000000038c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot7-u@test.invalid'),
  ('d0000000-0000-0000-0000-0000000038d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot7-m@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-0000000038a1', 'b0000000-0000-0000-0000-0000000038b2',
                    'd0000000-0000-0000-0000-0000000038d4');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000038d4', 'd0000000-0000-0000-0000-0000000038d4', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-0000000038d4', 'moderator');

-- Fiches : P et Q publiées, W en attente.
insert into public.resources
  (id, type_code, title, authors, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('38000000-0000-0000-0000-000000000001', 'article', 'Fiche P', array['Auteur, Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/p', 'open_access', 'published', now(), now()),
  ('38000000-0000-0000-0000-000000000002', 'article', 'Fiche Q', array['Auteur, Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/q', 'open_access', 'published', now(), now()),
  ('38000000-0000-0000-0000-000000000003', 'article', 'Fiche W', array['Auteur, Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/w', 'open_access', 'pending', null, null);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
   where c.oid in ('public.favorite_tags'::regclass, 'public.resource_views'::regclass,
                   'public.library_settings'::regclass)),
  'RLS activée et forcée sur les trois tables nouvelles'
);
select is(
  (select count(*)::integer from cron.job
   where jobname = 'eduscholar-views-purge' and active and username = 'postgres'),
  1, 'La purge de l''historique est planifiée sous le rôle postgres'
);

-- ---------------------------------------------------------------------------
-- Notes privées
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.set_favorite('38000000-0000-0000-0000-000000000001', true);
select public.set_favorite('38000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ select public.set_favorite_note('38000000-0000-0000-0000-000000000001', E'  À relire\r\npour le chapitre 2  ') $$,
  'A annote son favori'
);
select is(
  (select note from public.resource_favorites where resource_id = '38000000-0000-0000-0000-000000000001'),
  E'À relire\npour le chapitre 2', 'La note est nettoyée : bords, fins de ligne'
);
select throws_ok(
  $$ select public.set_favorite_note('38000000-0000-0000-0000-000000000001', repeat('a', 2001)) $$,
  '23514', null, 'Une note de plus de 2 000 caractères est refusée'
);
select throws_ok(
  $$ select public.set_favorite_note('38000000-0000-0000-0000-000000000001', E'note \u202E cachée') $$,
  '23514', null, 'Un caractère de sens d''écriture est refusé'
);
select throws_ok(
  $$ select public.set_favorite_note('38000000-0000-0000-0000-000000000003', 'x') $$,
  null, 'not_found', 'Pas de note sur une fiche qui n''est pas un favori'
);
select throws_ok(
  $$ update public.resource_favorites set note = 'directe' $$, '42501', null, 'Aucune écriture directe d''une note'
);

insert into tests.ids select 'a-col', public.create_collection('Chapitre 2');
select public.set_collection_item((select id from tests.ids where label = 'a-col'), '38000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.set_collection_item_note((select id from tests.ids where label = 'a-col'), '38000000-0000-0000-0000-000000000001', 'Citation p. 12') $$,
  'A annote un élément de sa collection'
);
select is(
  (select note from public.collection_items), 'Citation p. 12', 'La note de l''élément est enregistrée'
);
select lives_ok(
  $$ select public.set_collection_item_note((select id from tests.ids where label = 'a-col'), '38000000-0000-0000-0000-000000000001', '   ') $$,
  'Une note vide efface la note'
);
select is((select note from public.collection_items), null, 'La note est effacée');
select public.set_collection_item_note((select id from tests.ids where label = 'a-col'), '38000000-0000-0000-0000-000000000001', 'Citation p. 12');
reset role;

-- ---------------------------------------------------------------------------
-- Tags personnels
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select lives_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', '  Méthode   mixte ', true) $$,
  'A pose un tag sur un favori'
);
select lives_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000002', 'MÉTHODE MIXTE', true) $$,
  'Le même tag, écrit autrement, sur un autre favori'
);
select results_eq(
  $$ select tag, favorite_count from public.my_library_tags() $$,
  $$ values ('Méthode mixte', 2) $$,
  'Un tag garde sa première graphie ; les espaces sont réduites'
);
select lives_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'méthode mixte', true) $$,
  'Le reposer est sans effet'
);
select is((select count(*)::integer from public.favorite_tags), 2, 'Toujours deux lignes');
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'a,b', true) $$,
  '23514', null, 'Une virgule est refusée'
);
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', repeat('t', 41), true) $$,
  '23514', null, 'Un tag de plus de 40 caractères est refusé'
);
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', '   ', true) $$,
  '23514', null, 'Un tag vide est refusé'
);
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000003', 'x', true) $$,
  null, 'not_found', 'Pas de tag sur une fiche qui n''est pas un favori'
);
select throws_ok(
  $$ insert into public.favorite_tags (user_id, resource_id, tag)
     values ('a0000000-0000-0000-0000-0000000038a1', '38000000-0000-0000-0000-000000000001', 'direct') $$,
  '42501', null, 'Aucune écriture directe de tag'
);

-- Dix tags au plus par favori.
select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'tag ' || n, true) from generate_series(1, 9) n;
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'onzième', true) $$,
  null, 'limit_reached', 'Dix tags au plus par favori'
);
reset role;

-- Cent tags distincts au plus par compte : A en a dix ; quatre-vingt-dix de plus posés directement sur Q.
insert into public.favorite_tags (user_id, resource_id, tag)
select 'a0000000-0000-0000-0000-0000000038a1', '38000000-0000-0000-0000-000000000002', 'lot ' || n
from generate_series(1, 90) n;
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select is((select count(*)::integer from public.my_library_tags()), 100, 'A a cent tags distincts');
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000002', 'cent-unième', true) $$,
  null, 'limit_reached', 'Cent tags distincts au plus par compte'
);
select lives_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'tag 9', false) $$,
  'Retirer un tag'
);
select lives_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'absent', false) $$,
  'Retirer un tag absent est sans effet'
);
reset role;
delete from public.favorite_tags where tag like 'lot %';

-- ---------------------------------------------------------------------------
-- Historique de consultation
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select lives_ok($$ select public.record_resource_view('38000000-0000-0000-0000-000000000001') $$, 'A consulte P');
select lives_ok($$ select public.record_resource_view('38000000-0000-0000-0000-000000000003') $$, 'A ouvre W, non publiée : sans erreur');
select lives_ok($$ select public.record_resource_view('99999999-0000-0000-0000-000000000000') $$, 'Ni pour une fiche inexistante');
select results_eq(
  $$ select resource_id from public.resource_views $$,
  $$ values ('38000000-0000-0000-0000-000000000001'::uuid) $$,
  'Seule la fiche publiée est enregistrée'
);
reset role;
update public.resource_views set viewed_at = now() - interval '30 minutes' where user_id = 'a0000000-0000-0000-0000-0000000038a1';
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.record_resource_view('38000000-0000-0000-0000-000000000001');
select ok(
  (select viewed_at < now() - interval '29 minutes' from public.resource_views),
  'Une consultation de moins d''une heure n''est pas réécrite'
);
reset role;
update public.resource_views set viewed_at = now() - interval '2 hours' where user_id = 'a0000000-0000-0000-0000-0000000038a1';
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.record_resource_view('38000000-0000-0000-0000-000000000001');
select ok((select viewed_at = now() from public.resource_views), 'Au-delà, la date est rafraîchie');
select is((select count(*)::integer from public.resource_views), 1, 'Une seule ligne par fiche');
select throws_ok(
  $$ insert into public.resource_views (user_id, resource_id)
     values ('a0000000-0000-0000-0000-0000000038a1', '38000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'Aucune écriture directe dans l''historique'
);
select throws_ok($$ delete from public.resource_views $$, '42501', null, 'Aucune suppression directe');
reset role;

-- U, profil non complété : rien n'est enregistré.
select tests.login('c0000000-0000-0000-0000-0000000038c3');
select throws_ok(
  $$ select public.record_resource_view('38000000-0000-0000-0000-000000000001') $$,
  '42501', 'forbidden', 'Un compte sans profil complété n''a pas d''historique'
);
reset role;

-- Un visiteur ne peut rien enregistrer.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select public.record_resource_view('38000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'Un visiteur n''appelle pas l''enregistrement'
);
select throws_ok($$ select 1 from public.resource_views $$, '42501', null, 'Ni ne lit l''historique');
reset role;

-- Plafond : mille fiches au plus, les plus anciennes partent.
insert into public.resources
  (id, type_code, title, authors, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, last_verified_at, published_at)
select ('38100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'article', 'Fiche ' || n, array['Auteur, Test'],
  'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/n' || n, 'open_access', 'published', now(), now()
from generate_series(1, 1000) n;
insert into public.resource_views (user_id, resource_id, viewed_at)
select 'a0000000-0000-0000-0000-0000000038a1', ('38100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  now() - interval '1 day' - n * interval '1 minute'
from generate_series(1, 999) n;
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select is((select count(*)::integer from public.resource_views), 1000, 'A a mille consultations');
select public.record_resource_view('38100000-0000-0000-0000-000000001000');
select is((select count(*)::integer from public.resource_views), 1000, 'Une de plus : toujours mille');
select ok(
  not exists (select 1 from public.resource_views where resource_id = '38100000-0000-0000-0000-000000000999'),
  'La plus ancienne est partie'
);
reset role;
delete from public.resource_views where resource_id::text like '38100000-%';

-- Cloisonnement de l'historique, des tags et des notes.
select tests.login('b0000000-0000-0000-0000-0000000038b2');
select is_empty($$ select 1 from public.resource_views $$, 'B ne lit pas l''historique de A');
select is_empty($$ select 1 from public.favorite_tags $$, 'B ne lit pas les tags de A');
select is_empty($$ select 1 from public.my_library_tags() $$, 'Ni par la fonction des tags');
select is_empty($$ select 1 from public.resource_favorites where note is not null $$, 'Ni les notes de A');
select is_empty($$ select 1 from public.library_settings $$, 'Ni ses réglages');
select throws_ok(
  $$ select public.set_favorite_note('38000000-0000-0000-0000-000000000001', 'B écrit chez A') $$,
  null, 'not_found', 'B n''annote pas le favori de A'
);
select throws_ok(
  $$ select public.set_collection_item_note((select id from tests.ids where label = 'a-col'), '38000000-0000-0000-0000-000000000001', 'B') $$,
  null, 'not_found', 'B n''annote pas la collection de A'
);
select throws_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'B', true) $$,
  null, 'not_found', 'B ne tague pas le favori de A'
);
select lives_ok(
  $$ select public.set_favorite_tag('38000000-0000-0000-0000-000000000001', 'Méthode mixte', false) $$,
  'Le retrait par B est sans effet…'
);
select lives_ok($$ select public.delete_resource_view('38000000-0000-0000-0000-000000000001') $$, '… comme l''effacement d''une ligne…');
select lives_ok($$ select public.clear_resource_views() $$, '… ou de tout l''historique');
reset role;
select is(
  (select count(*)::integer from public.favorite_tags where user_id = 'a0000000-0000-0000-0000-0000000038a1' and tag = 'Méthode mixte'), 2, 'Les tags de A sont intacts'
);
select is(
  (select count(*)::integer from public.resource_views where user_id = 'a0000000-0000-0000-0000-0000000038a1'),
  1, 'L''historique de A est intact'
);

select tests.login('d0000000-0000-0000-0000-0000000038d4', 'aal2');
select is_empty($$ select 1 from public.resource_views $$, 'La modération ne lit pas l''historique');
select is_empty($$ select 1 from public.favorite_tags $$, 'Ni les tags');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select 1 from public.resource_views $$, '42501', null, 'Le rôle serveur ne lit pas l''historique');
select throws_ok($$ select 1 from public.favorite_tags $$, '42501', null, 'Ni les tags');
reset role;

-- Effacement et désactivation par le titulaire.
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.record_resource_view('38000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.delete_resource_view('38000000-0000-0000-0000-000000000002') $$, 'A efface une ligne');
select results_eq(
  $$ select resource_id from public.resource_views $$,
  $$ values ('38000000-0000-0000-0000-000000000001'::uuid) $$, 'Seule cette ligne est partie'
);
select lives_ok($$ select public.set_history_enabled(false) $$, 'A désactive son historique');
select is_empty($$ select 1 from public.resource_views $$, 'Le désactiver efface l''historique');
select public.record_resource_view('38000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.resource_views $$, 'Désactivé, rien n''est enregistré');
select results_eq(
  $$ select history_enabled from public.library_settings $$, $$ values (false) $$, 'Le réglage est lisible par A'
);
select throws_ok($$ update public.library_settings set history_enabled = true $$, '42501', null, 'Aucune écriture directe du réglage');
select lives_ok($$ select public.set_history_enabled(true) $$, 'A le réactive');
select public.record_resource_view('38000000-0000-0000-0000-000000000002');
select public.record_resource_view('38000000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.resource_views), 2, 'Réactivé, les consultations sont enregistrées');
select lives_ok($$ select public.clear_resource_views() $$, 'A efface tout son historique');
select is_empty($$ select 1 from public.resource_views $$, 'L''historique est vide');
select public.record_resource_view('38000000-0000-0000-0000-000000000001');
reset role;

-- Conservation : douze mois.
update public.resource_views set viewed_at = now() - interval '13 months' where user_id = 'a0000000-0000-0000-0000-0000000038a1';
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select throws_ok($$ select private.purge_old_resource_views() $$, '42501', null, 'Un utilisateur ne lance pas la purge');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select private.purge_old_resource_views() $$, '42501', null, 'Le rôle serveur non plus');
reset role;
select cmp_ok(private.purge_old_resource_views(), '>=', 1, 'La purge efface les consultations de plus de douze mois');
select is_empty($$ select 1 from public.resource_views where user_id = 'a0000000-0000-0000-0000-0000000038a1' $$, 'Il n''en reste aucune');

-- ---------------------------------------------------------------------------
-- Import de références vers un projet
-- ---------------------------------------------------------------------------
insert into public.research_projects (id, owner_id, title) values
  ('38d00000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000038a1', 'Projet de A'),
  ('38d00000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000038a1', 'Projet plein');

select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.add_project_source('38d00000-0000-0000-0000-0000000000a1',
  jsonb_build_object('source_type', 'article', 'title', 'Déjà là', 'publication_year', '2020', 'doi', '10.1234/deja'));
select is(
  public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(
    jsonb_build_object('source_type', 'book', 'title', 'Nouveau livre', 'authors', jsonb_build_array('Ba, O.'), 'publication_year', '2019'),
    jsonb_build_object('source_type', 'article', 'title', 'Autre titre', 'doi', '10.1234/DEJA'),
    jsonb_build_object('source_type', 'article', 'title', 'DéJà Là', 'publication_year', '2020'),
    jsonb_build_object('source_type', 'article', 'title', ''),
    jsonb_build_object('source_type', 'inconnu', 'title', 'Type refusé'),
    '"pas un objet"'::jsonb,
    jsonb_build_object('source_type', 'web', 'title', 'Adresse refusée', 'url', 'javascript:alert(1)')
  )),
  jsonb_build_object('created', 1, 'rejected', jsonb_build_array(
    jsonb_build_object('index', 1, 'code', 'duplicate'),
    jsonb_build_object('index', 2, 'code', 'duplicate'),
    jsonb_build_object('index', 3, 'code', 'invalid'),
    jsonb_build_object('index', 4, 'code', 'invalid'),
    jsonb_build_object('index', 5, 'code', 'invalid'),
    jsonb_build_object('index', 6, 'code', 'invalid')
  )),
  'Import : une entrée créée, doublons et entrées invalides refusés une à une'
);
select results_eq(
  $$ select title, resource_id from public.project_sources where project_id = '38d00000-0000-0000-0000-0000000000a1' order by title $$,
  $$ values ('Déjà là', null::uuid), ('Nouveau livre', null::uuid) $$,
  'La source importée est privée au projet, sans fiche du catalogue'
);
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', '{"title":"x"}'::jsonb) $$,
  '22023', 'invalid_payload', 'Un objet au lieu d''un tableau est refusé'
);
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', '[]'::jsonb) $$,
  '22023', 'invalid_payload', 'Un tableau vide est refusé'
);
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1',
       (select jsonb_agg(jsonb_build_object('title', 'T' || n)) from generate_series(1, 201) n)) $$,
  '22023', 'invalid_payload', 'Plus de 200 entrées par appel sont refusées'
);
select is(
  public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(
    jsonb_build_object('title', 123),
    jsonb_build_object('title', 'Auteurs', 'authors', 'pas un tableau'),
    jsonb_build_object('title', 'Année', 'publication_year', 'abcd'),
    jsonb_build_object('title', 'Auteur vide', 'authors', jsonb_build_array('  ')),
    jsonb_build_object('title', 'Date', 'accessed_on', '2020-02-31'),
    jsonb_build_object('title', 'Volume', 'volume', repeat('9', 51))
  )),
  jsonb_build_object('created', 0, 'rejected', jsonb_build_array(
    jsonb_build_object('index', 0, 'code', 'invalid'),
    jsonb_build_object('index', 1, 'code', 'invalid'),
    jsonb_build_object('index', 2, 'code', 'invalid'),
    jsonb_build_object('index', 3, 'code', 'invalid'),
    jsonb_build_object('index', 4, 'code', 'invalid'),
    jsonb_build_object('index', 5, 'code', 'invalid')
  )),
  'Entrées de forme invalide refusées une à une, sans erreur'
);
reset role;

-- Plafond de 300 sources par projet : il reste une place.
insert into public.project_sources (project_id, title)
select '38d00000-0000-0000-0000-0000000000a2', 'Source ' || n from generate_series(1, 299) n;
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select is(
  public.import_project_sources('38d00000-0000-0000-0000-0000000000a2', jsonb_build_array(
    jsonb_build_object('title', 'Dernière place'),
    jsonb_build_object('title', 'De trop'),
    jsonb_build_object('title', 'De trop aussi')
  )),
  jsonb_build_object('created', 1, 'rejected', jsonb_build_array(
    jsonb_build_object('index', 1, 'code', 'limit_reached'),
    jsonb_build_object('index', 2, 'code', 'limit_reached')
  )),
  'Le plafond de 300 sources par projet s''applique à l''import'
);
reset role;

-- Limite de débit en base : 20 appels par 15 minutes, même tout refusés.
delete from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1';
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', '')))
from generate_series(1, 20);
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', ''))) $$,
  null, 'rate_limited', 'Le 21e appel en 15 minutes est refusé, même si toutes les entrées étaient invalides'
);
reset role;
select is(
  (select count(*)::integer from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1'), 20, 'Chaque appel est compté'
);

-- 2 000 entrées par jour, comptées même refusées.
delete from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1';
insert into private.source_import_calls (user_id, called_at, entries)
select 'a0000000-0000-0000-0000-0000000038a1', now() - interval '2 hours', 200 from generate_series(1, 10);
insert into private.source_import_calls (user_id, called_at, entries)
values ('a0000000-0000-0000-0000-0000000038a1', now() - interval '25 hours', 200);
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', 'Une de plus'))) $$,
  null, 'rate_limited', 'Au-delà de 2 000 entrées en un jour, l''import est refusé'
);
reset role;
select is(
  (select count(*)::integer from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1' and called_at < now() - interval '1 day'), 1,
  'Le refus annule aussi l''effacement des traces anciennes (transaction annulée)'
);

-- Le quota de 600 sources ajoutées par jour s'applique à l'import.
delete from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1';
insert into public.research_projects (id, owner_id, title) values
  ('38d00000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000038a1', 'Projet du quota');
insert into public.project_sources (project_id, title)
select '38d00000-0000-0000-0000-0000000000a3', 'Quota ' || n
from generate_series(1, 600 - (select count(*)::integer from public.project_sources s
                               join public.research_projects r on r.id = s.project_id
                               where r.owner_id = 'a0000000-0000-0000-0000-0000000038a1')) n;
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select is(
  public.import_project_sources('38d00000-0000-0000-0000-0000000000a3', jsonb_build_array(
    jsonb_build_object('title', 'Hors quota'), jsonb_build_object('title', 'Hors quota aussi')
  )),
  jsonb_build_object('created', 0, 'rejected', jsonb_build_array(
    jsonb_build_object('index', 0, 'code', 'rate_limited'),
    jsonb_build_object('index', 1, 'code', 'rate_limited')
  )),
  'Le quota de 600 ajouts par jour arrête l''import'
);
reset role;
select ok(
  not has_table_privilege('authenticated', 'private.source_import_calls', 'select')
  and not has_table_privilege('service_role', 'private.source_import_calls', 'select'),
  'Ni authenticated ni le rôle serveur ne lisent les traces d''import'
);
delete from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1';

-- B n'importe rien dans le projet de A ; la modération non plus.
select tests.login('b0000000-0000-0000-0000-0000000038b2');
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', 'Intrus'))) $$,
  null, 'not_found', 'B n''importe pas dans le projet de A'
);
reset role;
select tests.login('d0000000-0000-0000-0000-0000000038d4', 'aal2');
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', 'Intrus'))) $$,
  null, 'not_found', 'La modération non plus'
);
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', 'Intrus'))) $$,
  '42501', null, 'Un visiteur n''appelle pas l''import'
);
reset role;
select is(
  (select count(*)::integer from public.project_sources where title = 'Intrus'), 0, 'Aucune source intruse'
);
select is(
  (select count(*)::integer from public.resources where title in ('Nouveau livre', 'Dernière place')), 0,
  'L''import ne crée aucune fiche au catalogue'
);

-- ---------------------------------------------------------------------------
-- Suppression du compte : tout part
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000038a1');
select public.record_resource_view('38000000-0000-0000-0000-000000000001');
select public.set_history_enabled(true);
select public.import_project_sources('38d00000-0000-0000-0000-0000000000a1', jsonb_build_array(jsonb_build_object('title', '')));
reset role;
select ok(
  (select count(*) from public.resource_views where user_id = 'a0000000-0000-0000-0000-0000000038a1') = 1
  and (select count(*) from public.favorite_tags where user_id = 'a0000000-0000-0000-0000-0000000038a1') > 0
  and (select count(*) from public.library_settings where user_id = 'a0000000-0000-0000-0000-0000000038a1') = 1,
  'Avant suppression : historique, tags et réglage présents'
);
delete from auth.users where id = 'a0000000-0000-0000-0000-0000000038a1';
select is(
  (select count(*)::integer from public.resource_favorites where user_id = 'a0000000-0000-0000-0000-0000000038a1')
  + (select count(*)::integer from public.favorite_tags where user_id = 'a0000000-0000-0000-0000-0000000038a1')
  + (select count(*)::integer from public.resource_views where user_id = 'a0000000-0000-0000-0000-0000000038a1')
  + (select count(*)::integer from public.library_settings where user_id = 'a0000000-0000-0000-0000-0000000038a1')
  + (select count(*)::integer from private.source_import_calls where user_id = 'a0000000-0000-0000-0000-0000000038a1')
  + (select count(*)::integer from public.collection_items i
     where i.collection_id = (select id from tests.ids where label = 'a-col')),
  0, 'La suppression du compte efface favoris, notes, tags, historique et réglage'
);

select * from finish();
rollback;
