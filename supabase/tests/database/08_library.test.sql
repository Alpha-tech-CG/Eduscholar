-- Favoris et collections privées (B-17).

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
  ('a0000000-0000-0000-0000-0000000011b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bib-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000011b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bib-b@test.invalid'),
  ('c0000000-0000-0000-0000-0000000011b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bib-u@test.invalid'),
  ('d0000000-0000-0000-0000-0000000011b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bib-m@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-0000000011b1', 'b0000000-0000-0000-0000-0000000011b2',
                    'd0000000-0000-0000-0000-0000000011b4');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000011b4', 'd0000000-0000-0000-0000-0000000011b4', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-0000000011b4', 'moderator');

-- Fiches : P publiée, Q publiée, W en attente.
insert into public.resources
  (id, type_code, title, authors, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('11b00000-0000-0000-0000-000000000001', 'article', 'Fiche publiée P', array['Auteur Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/p', 'open_access', 'published', now(), now()),
  ('11b00000-0000-0000-0000-000000000002', 'article', 'Fiche publiée Q', array['Auteur Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/q', 'open_access', 'published', now(), now()),
  ('11b00000-0000-0000-0000-000000000003', 'article', 'Fiche en attente W', array['Auteur Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/w', 'open_access', 'pending', null, null);

-- ---------------------------------------------------------------------------
-- Favoris
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000011b1');
select lives_ok($$ select public.set_favorite('11b00000-0000-0000-0000-000000000001', true) $$, 'A garde une fiche publiée');
select lives_ok($$ select public.set_favorite('11b00000-0000-0000-0000-000000000001', true) $$, 'Le refaire est sans effet');
select is((select count(*) from public.resource_favorites), 1::bigint, 'Un seul favori');
select throws_ok(
  $$ select public.set_favorite('11b00000-0000-0000-0000-000000000003', true) $$,
  null, 'not_found', 'Une fiche non publiée ne se garde pas'
);
select throws_ok(
  $$ select public.set_favorite('99999999-0000-0000-0000-000000000000', true) $$,
  null, 'not_found', 'Même réponse pour une fiche inexistante : pas d''indice sur les fiches cachées'
);
select throws_ok(
  $$ insert into public.resource_favorites (user_id, resource_id)
     values ('a0000000-0000-0000-0000-0000000011b1', '11b00000-0000-0000-0000-000000000003') $$,
  '42501', null, 'Aucune écriture directe dans les favoris'
);
select throws_ok(
  $$ delete from public.resource_favorites $$, '42501', null, 'Aucune suppression directe'
);

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
insert into tests.ids select 'a1', public.create_collection('  Mémoire de licence  ', 'Sources pour le chapitre 2');
select results_eq(
  $$ select name, description from public.collections $$,
  $$ values ('Mémoire de licence', 'Sources pour le chapitre 2') $$,
  'A crée une collection ; le nom est nettoyé de ses espaces'
);
select throws_ok(
  $$ select public.create_collection('MÉMOIRE DE LICENCE') $$,
  '23505', 'duplicate_name', 'Un nom ne sert qu''une fois, sans égard à la casse'
);
select throws_ok($$ select public.create_collection('   ') $$, '23514', null, 'Un nom vide est refusé');
select throws_ok(
  $$ select public.create_collection(repeat('a', 121)) $$, '23514', null, 'Un nom trop long est refusé'
);
select throws_ok(
  $$ select public.create_collection(E'Nom ‮déguisé') $$, '23514', null,
  'Un nom contenant un caractère de format est refusé'
);
select throws_ok(
  $$ insert into public.collections (owner_id, name) values ('a0000000-0000-0000-0000-0000000011b1', 'Directe') $$,
  '42501', null, 'Aucune création directe de collection'
);
select throws_ok(
  $$ update public.collections set name = 'Directe' $$, '42501', null, 'Aucune modification directe'
);

select lives_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '11b00000-0000-0000-0000-000000000001', true) $$,
  'A range une fiche publiée dans sa collection'
);
select lives_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '11b00000-0000-0000-0000-000000000002', true) $$,
  'Puis une seconde'
);
select throws_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '11b00000-0000-0000-0000-000000000003', true) $$,
  null, 'not_found', 'Une fiche non publiée ne se range pas'
);
select lives_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), 'Mémoire', null) $$,
  'A renomme sa collection'
);
select results_eq(
  $$ select name, description from public.collections $$,
  $$ values ('Mémoire', null::text) $$, 'Le nom et la description sont mis à jour'
);
reset role;

-- ---------------------------------------------------------------------------
-- Cloisonnement : B, la modératrice, le rôle serveur, un visiteur
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-0000000011b2');
select is_empty($$ select 1 from public.resource_favorites $$, 'B ne lit pas les favoris de A');
select is_empty($$ select 1 from public.collections $$, 'B ne lit pas les collections de A');
select is_empty($$ select 1 from public.collection_items $$, 'B ne lit pas le contenu des collections de A');
select throws_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '11b00000-0000-0000-0000-000000000001', true) $$,
  null, 'not_found', 'B n''ajoute rien à la collection de A'
);
select throws_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '11b00000-0000-0000-0000-000000000001', false) $$,
  null, 'not_found', 'B n''en retire rien'
);
select throws_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), 'Piratée', null) $$,
  null, 'not_found', 'B ne renomme pas la collection de A'
);
select throws_ok(
  $$ select public.delete_collection((select id from tests.ids where label = 'a1')) $$,
  null, 'not_found', 'B ne supprime pas la collection de A'
);
select lives_ok($$ select public.create_collection('Mémoire') $$, 'B peut utiliser le même nom que A');
select lives_ok(
  $$ select public.set_favorite('11b00000-0000-0000-0000-000000000001', false) $$,
  'Retirer un favori qu''on n''a pas est sans effet'
);
reset role;
select is((select count(*) from public.resource_favorites), 1::bigint, 'Le favori de A est intact');
select is((select count(*) from public.collection_items), 2::bigint, 'La collection de A est intacte');

select tests.login('d0000000-0000-0000-0000-0000000011b4', 'aal2');
select is_empty($$ select 1 from public.resource_favorites $$, 'La modération ne lit pas les favoris');
select is_empty($$ select 1 from public.collections $$, 'La modération ne lit pas les collections');
select is_empty($$ select 1 from public.collection_items $$, 'Ni leur contenu');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select 1 from public.collections $$, '42501', null, 'Le rôle serveur ne lit pas les collections');
select throws_ok($$ select 1 from public.resource_favorites $$, '42501', null, 'Ni les favoris');
select throws_ok(
  $$ select public.set_favorite('11b00000-0000-0000-0000-000000000001', true) $$, '42501', null,
  'Le rôle serveur n''appelle pas les fonctions de la bibliothèque'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select 1 from public.collections $$, '42501', null, 'Un visiteur ne lit pas les collections');
select throws_ok($$ select public.create_collection('Visiteur') $$, '42501', null, 'Un visiteur n''en crée pas');
reset role;

-- La modératrice ne touche pas davantage à la collection de A.
select tests.login('d0000000-0000-0000-0000-0000000011b4', 'aal2');
select throws_ok(
  $$ select public.delete_collection((select id from tests.ids where label = 'a1')) $$,
  null, 'not_found', 'La modération ne supprime pas la collection d''un utilisateur'
);
select throws_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), 'Modérée', null) $$,
  null, 'not_found', 'Ni ne la renomme'
);
reset role;

-- Compte à second facteur, session ouverte par le seul mot de passe.
select tests.login('d0000000-0000-0000-0000-0000000011b4', 'aal1');
select is_empty($$ select 1 from public.collections $$, 'En aal1, un compte à second facteur ne lit pas ses collections');
select throws_ok($$ select public.create_collection('En aal1') $$, '42501', 'forbidden', 'Et n''en crée pas');
reset role;

-- Profil non complété, compte suspendu.
select tests.login('c0000000-0000-0000-0000-0000000011b3');
select throws_ok(
  $$ select public.set_favorite('11b00000-0000-0000-0000-000000000001', true) $$,
  '42501', 'forbidden', 'Sans profil complété, pas de favori'
);
select throws_ok($$ select public.create_collection('Sans profil') $$, '42501', 'forbidden', 'Ni de collection');
reset role;

insert into private.account_status (user_id, status, changed_by)
values ('b0000000-0000-0000-0000-0000000011b2', 'suspended', 'd0000000-0000-0000-0000-0000000011b4');
select tests.login('b0000000-0000-0000-0000-0000000011b2');
select is_empty($$ select 1 from public.collections $$, 'Un compte suspendu ne lit plus ses collections');
select throws_ok($$ select public.create_collection('Suspendu') $$, '42501', 'forbidden', 'Et n''en crée plus');
reset role;

-- ---------------------------------------------------------------------------
-- Fiche suspendue après coup : elle reste rangée, n'est plus lisible, s'enlève
-- ---------------------------------------------------------------------------
update public.resources set editorial_status = 'suspended' where id = '11b00000-0000-0000-0000-000000000002';
select tests.login('a0000000-0000-0000-0000-0000000011b1');
select is((select count(*) from public.collection_items), 2::bigint, 'L''élément reste dans la collection');
select is(
  (select count(*) from public.resources r
   where r.id in (select resource_id from public.collection_items)),
  1::bigint, 'Mais la fiche suspendue n''est plus lisible'
);
select throws_ok(
  $$ select public.set_favorite('11b00000-0000-0000-0000-000000000002', true) $$,
  null, 'not_found', 'Elle ne se garde plus'
);
select lives_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '11b00000-0000-0000-0000-000000000002', false) $$,
  'Elle s''enlève toujours de la collection'
);
select is((select count(*) from public.collection_items), 1::bigint, 'Elle est enlevée');

-- Retrait : même réponse, que la fiche soit cachée, inexistante ou jamais gardée.
select lives_ok($$ select public.set_favorite('11b00000-0000-0000-0000-000000000003', false) $$, 'Retirer une fiche non publiée : sans effet, sans erreur');
select lives_ok($$ select public.set_favorite('99999999-0000-0000-0000-000000000000', false) $$, 'Retirer une fiche inexistante : même réponse');
select lives_ok(
  $$ select public.set_collection_item((select id from tests.ids where label = 'a1'), '99999999-0000-0000-0000-000000000000', false) $$,
  'Retirer d''une collection une fiche inexistante : même réponse'
);

-- Description et nom : mêmes exigences à la création et au renommage.
select throws_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), 'Mémoire', E'Texte \u202Edéguisé') $$,
  '23514', null, 'Une description contenant un caractère de format est refusée'
);
select throws_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), 'Mémoire', repeat('a', 1001)) $$,
  '23514', null, 'Une description trop longue est refusée'
);
select throws_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), E'\u00A0\u00A0', null) $$,
  '23514', null, 'Un nom sans caractère visible est refusé'
);
select lives_ok($$ select public.create_collection(E'Cafe\u0301') $$, 'Un nom en forme décomposée est accepté');
select throws_ok(
  $$ select public.create_collection(E'Caf\u00E9') $$,
  '23505', 'duplicate_name', 'Et reconnu comme le même nom sous sa forme composée'
);
select throws_ok(
  $$ select public.update_collection((select id from tests.ids where label = 'a1'), 'CAFÉ', null) $$,
  '23505', 'duplicate_name', 'Renommer vers un nom déjà pris est refusé'
);
select throws_ok(
  $$ update public.collections set owner_id = 'b0000000-0000-0000-0000-0000000011b2' $$,
  '42501', null, 'Le titulaire d''une collection ne se change pas'
);

-- Suppression de la collection : son contenu part avec elle, les fiches restent.
select lives_ok(
  $$ select public.delete_collection((select id from tests.ids where label = 'a1')) $$, 'A supprime sa collection'
);
select is_empty($$ select 1 from public.collection_items $$, 'Son contenu est supprimé');
reset role;
select is(
  (select count(*) from public.resources where id = '11b00000-0000-0000-0000-000000000001'), 1::bigint,
  'La fiche, elle, reste au catalogue'
);

-- Plafonds.
insert into public.collections (owner_id, name)
select 'a0000000-0000-0000-0000-0000000011b1', 'Collection ' || g from generate_series(1, 50) g;
select tests.login('a0000000-0000-0000-0000-0000000011b1');
select throws_ok(
  $$ select public.create_collection('Une de trop') $$, null, 'limit_reached', 'Cinquante collections au plus'
);
reset role;

-- Plafond des éléments d'une collection, et ordre des contrôles : au plafond,
-- une fiche cachée répond toujours « introuvable ».
insert into public.resources
  (id, type_code, title, authors, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, last_verified_at, published_at)
select gen_random_uuid(), 'article', 'Fiche de plafond ' || g, array['Auteur Test'], 'fr', 'computer_science',
       'connector', 'plafond', 'https://exemple.invalid/plafond/' || g, 'open_access', 'published', now(), now()
from generate_series(1, 500) g;
insert into public.collection_items (collection_id, resource_id)
select (select id from public.collections where owner_id = 'a0000000-0000-0000-0000-0000000011b1' and name = 'Collection 1'),
       r.id
from public.resources r where r.source_name = 'plafond';
select tests.login('a0000000-0000-0000-0000-0000000011b1');
select throws_ok(
  $$ select public.set_collection_item(
       (select id from public.collections where name = 'Collection 1'), '11b00000-0000-0000-0000-000000000001', true) $$,
  null, 'limit_reached', 'Cinq cents ressources au plus par collection'
);
select throws_ok(
  $$ select public.set_collection_item(
       (select id from public.collections where name = 'Collection 1'), '11b00000-0000-0000-0000-000000000003', true) $$,
  null, 'not_found', 'Au plafond, une fiche cachée répond « introuvable », pas « plafond atteint »'
);
reset role;

-- Suppression du compte : sa bibliothèque disparaît.
delete from auth.users where id = 'a0000000-0000-0000-0000-0000000011b1';
select is(
  (select count(*) from public.collections where owner_id = 'a0000000-0000-0000-0000-0000000011b1')
  + (select count(*) from public.resource_favorites where user_id = 'a0000000-0000-0000-0000-0000000011b1'),
  0::bigint, 'La suppression du compte efface ses favoris et ses collections'
);

select * from finish();
rollback;
