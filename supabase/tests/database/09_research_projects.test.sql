-- Projets de recherche privés (C-01).

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

-- Acteurs : A et B au profil complété ; U non ; M modératrice ; P administratrice.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000021c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prj-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000021c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prj-b@test.invalid'),
  ('c0000000-0000-0000-0000-0000000021c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prj-u@test.invalid'),
  ('d0000000-0000-0000-0000-0000000021c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prj-m@test.invalid'),
  ('e0000000-0000-0000-0000-0000000021c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prj-p@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-0000000021c1', 'b0000000-0000-0000-0000-0000000021c2',
                    'd0000000-0000-0000-0000-0000000021c4', 'e0000000-0000-0000-0000-0000000021c5');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000021c4', 'd0000000-0000-0000-0000-0000000021c4', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-0000000021c5', 'e0000000-0000-0000-0000-0000000021c5', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values
  ('d0000000-0000-0000-0000-0000000021c4', 'moderator'),
  ('e0000000-0000-0000-0000-0000000021c5', 'super_admin');

-- ---------------------------------------------------------------------------
-- Création et modification par la propriétaire
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000021c1');
insert into tests.ids
select 'a1', public.create_project('{"title": "  Détection d''intrusions par apprentissage  ", "program_code": "computer_science", "owner_id": "b0000000-0000-0000-0000-0000000021c2", "status": "completed"}');

select results_eq(
  $$ select title, program_code, status, owner_id, deleted_at is null from public.research_projects $$,
  $$ values ('Détection d''intrusions par apprentissage', 'computer_science', 'draft',
             'a0000000-0000-0000-0000-0000000021c1'::uuid, true) $$,
  'A crée un projet : elle en est propriétaire, à l''état de brouillon, quoi que dise la requête'
);

select lives_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), jsonb_build_object(
       'title', 'Détection d''intrusions',
       'program_code', 'computer_science',
       'status', 'in_progress',
       'due_date', '2027-06-30',
       'supervisor_name', 'Pr Ndiaye',
       'problem_statement', E'Première ligne.\nSeconde ligne.',
       'main_question', 'Quels modèles détectent le mieux ?',
       'secondary_questions', jsonb_build_array('Quel coût ?', 'Quelles données ?'),
       'hypotheses', jsonb_build_array('Les forêts aléatoires suffisent.'),
       'outline', E'1. Introduction\n2. État de l''art',
       'owner_id', 'b0000000-0000-0000-0000-0000000021c2',
       'deleted_at', '2020-01-01'
     )) $$,
  'A complète la fiche de son projet'
);
select results_eq(
  $$ select title, status, due_date, supervisor_name, problem_statement, secondary_questions, hypotheses,
            owner_id, deleted_at is null, context is null
     from public.research_projects $$,
  $$ values ('Détection d''intrusions', 'in_progress', '2027-06-30'::date, 'Pr Ndiaye',
             E'Première ligne.\nSeconde ligne.', array['Quel coût ?', 'Quelles données ?'],
             array['Les forêts aléatoires suffisent.'],
             'a0000000-0000-0000-0000-0000000021c1'::uuid, true, true) $$,
  'Les champs sont enregistrés ; propriétaire et suppression ne se changent pas par la fiche'
);

-- Refus.
select throws_ok($$ select public.create_project('{"title": "ab", "program_code": "filiere_inconnue"}') $$, '23503', null, 'Une filière hors référentiel est refusée');
select throws_ok($$ select public.create_project('{"title": "   "}') $$, '23514', null, 'Un titre vide est refusé');
select throws_ok($$ select public.create_project('"texte"') $$, '22023', 'invalid_payload', 'Une charge utile mal formée est refusée');
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('title', 'Titre', 'status', 'published')) $$,
  '23514', null, 'Un statut inconnu est refusé'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('title', 'Titre', 'context', E'Texte ‮déguisé')) $$,
  '23514', null, 'Un caractère de format invisible est refusé dans un texte long'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('title', 'Titre', 'context', repeat('a', 5001))) $$,
  '23514', null, 'Un texte trop long est refusé'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('title', 'Titre', 'hypotheses',
         (select jsonb_agg('h' || g) from generate_series(1, 21) g))) $$,
  '23514', null, 'Plus de vingt hypothèses sont refusées'
);
select throws_ok(
  $$ insert into public.research_projects (owner_id, title) values ('a0000000-0000-0000-0000-0000000021c1', 'Directe') $$,
  '42501', null, 'Aucune création directe'
);
select throws_ok($$ update public.research_projects set title = 'Directe' $$, '42501', null, 'Aucune modification directe');
select throws_ok($$ delete from public.research_projects $$, '42501', null, 'Aucune suppression directe');
select is(
  (select title from public.research_projects), 'Détection d''intrusions', 'Les refus n''ont rien changé'
);
-- Modification partielle : seuls les champs présents sont écrits.
select lives_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"context": "Contexte ajouté"}') $$,
  'Une requête partielle est acceptée'
);
select results_eq(
  $$ select title, status, context, problem_statement, hypotheses from public.research_projects $$,
  $$ values ('Détection d''intrusions', 'in_progress', 'Contexte ajouté', E'Première ligne.\nSeconde ligne.',
             array['Les forêts aléatoires suffisent.']) $$,
  'Les champs absents de la requête sont conservés'
);
select lives_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"context": ""}') $$,
  'Un champ présent et vide est effacé'
);
select is((select context from public.research_projects), null, 'Le contexte est vidé, lui seul');

-- Fiche modifiée entre-temps : la version lue ne s'impose pas.
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('title', 'Écrasement', 'expected_updated_at', '2020-01-01T00:00:00Z')) $$,
  '40001', 'conflict', 'Une fiche modifiée depuis sa lecture n''est pas écrasée'
);
select lives_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('title', 'Détection d''intrusions',
         'expected_updated_at', (select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.research_projects))) $$,
  'Avec la bonne date de lecture, l''enregistrement passe'
);

-- Échéance : format strict et bornes.
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"due_date": "infinity"}') $$,
  '22007', 'invalid_date', 'Une échéance « infinity » est refusée'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"due_date": "today"}') $$,
  '22007', 'invalid_date', 'Une échéance « today » est refusée'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"due_date": "30/06/2027"}') $$,
  '22007', 'invalid_date', 'Une échéance mal formée est refusée'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"due_date": "1500-01-01"}') $$,
  '23514', null, 'Une échéance hors bornes est refusée'
);

-- Caractères invisibles et normalisation.
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), jsonb_build_object('context', E'Texte\u0085caché')) $$,
  '23514', null, 'Un caractère de contrôle C1 est refusé'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), jsonb_build_object('context', E'Texte\uFEFFcaché')) $$,
  '23514', null, 'Une marque invisible est refusée'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), jsonb_build_object('context', E'Ligne\u2028suivante')) $$,
  '23514', null, 'Un séparateur de ligne invisible est refusé'
);
select lives_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), jsonb_build_object('context', E'Ligne\r\n\tsuivante')) $$,
  'Retour à la ligne et tabulation sont admis'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       jsonb_build_object('hypotheses', jsonb_build_array(E'Cafe\u0301', E'Caf\u00E9'))) $$,
  '23514', null, 'Deux éléments identiques sous deux formes Unicode sont reconnus comme doublons'
);

reset role;

-- ---------------------------------------------------------------------------
-- Personne d'autre : autre utilisateur, modération, administration, serveur, visiteur
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-0000000021c2');
select is_empty($$ select 1 from public.research_projects $$, 'B ne lit pas le projet de A');
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"title": "Piraté"}') $$,
  null, 'not_found', 'B ne modifie pas le projet de A'
);
select throws_ok(
  $$ select public.update_project('99999999-0000-0000-0000-000000000000', '{"title": "Piraté"}') $$,
  null, 'not_found', 'Même réponse pour un projet inexistant'
);
select throws_ok(
  $$ select public.delete_project((select id from tests.ids where label = 'a1')) $$,
  null, 'not_found', 'B ne supprime pas le projet de A'
);
-- Aucun indice par la validation : une requête invalide sur le projet d'autrui
-- répond « introuvable », comme sur un projet inexistant.
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'),
       '{"due_date": "pas-une-date", "status": "published", "program_code": "inconnue", "secondary_questions": "texte"}') $$,
  null, 'not_found', 'Requête invalide sur le projet de A : « introuvable »'
);
select throws_ok(
  $$ select public.update_project('99999999-0000-0000-0000-000000000000',
       '{"due_date": "pas-une-date", "status": "published", "program_code": "inconnue", "secondary_questions": "texte"}') $$,
  null, 'not_found', 'Même réponse sur un projet inexistant'
);
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '"texte"') $$,
  null, 'not_found', 'Même réponse pour une charge utile mal formée'
);
select ok(not private.is_project_owner((select id from tests.ids where label = 'a1')), 'B n''est pas reconnu propriétaire du projet de A');
select is_empty($$ select private.my_project_ids() $$, 'B n''a aucun projet');
select throws_ok($$ select public.purge_deleted_projects() $$, '42501', null, 'Un utilisateur ne lance pas la purge');

reset role;

select tests.login('d0000000-0000-0000-0000-0000000021c4', 'aal2');
select is_empty($$ select 1 from public.research_projects $$, 'La modération ne lit aucun projet');
select throws_ok(
  $$ select public.delete_project((select id from tests.ids where label = 'a1')) $$,
  null, 'not_found', 'Ni n''en supprime'
);
reset role;

select tests.login('e0000000-0000-0000-0000-0000000021c5', 'aal2');
select is_empty($$ select 1 from public.research_projects $$, 'Un super-administrateur ne lit aucun projet');
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"title": "Administré"}') $$,
  null, 'not_found', 'Ni n''en modifie'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select 1 from public.research_projects $$, '42501', null, 'Le rôle serveur ne lit pas les projets');
select throws_ok($$ select public.create_project('{"title": "Serveur"}') $$, '42501', null, 'Ni n''en crée');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select 1 from public.research_projects $$, '42501', null, 'Un visiteur ne lit pas les projets');
select throws_ok($$ select public.create_project('{"title": "Visiteur"}') $$, '42501', null, 'Ni n''en crée');
reset role;

select tests.login('c0000000-0000-0000-0000-0000000021c3');
select throws_ok($$ select public.create_project('{"title": "Sans profil"}') $$, '42501', 'forbidden', 'Sans profil complété, pas de projet');
reset role;

-- Compte à second facteur en session aal1 : aucun droit.
select tests.login('d0000000-0000-0000-0000-0000000021c4', 'aal1');
select throws_ok($$ select public.create_project('{"title": "En aal1"}') $$, '42501', 'forbidden', 'En aal1, un compte à second facteur ne crée pas de projet');
reset role;

select is(
  (select count(*) from public.research_projects where owner_id::text like '%-0000000021c_'), 1::bigint,
  'Un seul projet existe chez les acteurs du test : celui de A, intact'
);
select is(
  (select title from public.research_projects where owner_id = 'a0000000-0000-0000-0000-0000000021c1'),
  'Détection d''intrusions', 'Son titre est inchangé'
);

-- ---------------------------------------------------------------------------
-- Suppression logique, plafond, suspension, suppression du compte
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000021c1');
select ok(private.is_project_owner((select id from tests.ids where label = 'a1')), 'A est reconnue propriétaire');
select lives_ok($$ select public.delete_project((select id from tests.ids where label = 'a1')) $$, 'A supprime son projet');
select is_empty($$ select 1 from public.research_projects $$, 'Il cesse aussitôt d''être lisible');
select ok(not private.is_project_owner((select id from tests.ids where label = 'a1')), 'Elle n''en est plus reconnue propriétaire');
select throws_ok(
  $$ select public.update_project((select id from tests.ids where label = 'a1'), '{"title": "Revenant"}') $$,
  null, 'not_found', 'Un projet supprimé ne se modifie plus'
);
select throws_ok(
  $$ select public.delete_project((select id from tests.ids where label = 'a1')) $$,
  null, 'not_found', 'Ni ne se supprime deux fois'
);
reset role;
select is(
  (select count(*) from public.research_projects where deleted_at is not null and owner_id = 'a0000000-0000-0000-0000-0000000021c1'), 1::bigint,
  'La ligne est conservée jusqu''à la purge'
);

-- Purge : trente jours après la suppression, pas avant.
insert into public.research_projects (id, owner_id, title, deleted_at, created_at) values
  ('21c00000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000021c2', 'Supprimé il y a longtemps', now() - interval '31 days', now() - interval '40 days'),
  ('21c00000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000021c2', 'Supprimé récemment', now() - interval '29 days', now() - interval '40 days'),
  ('21c00000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-0000000021c2', 'Toujours vivant', null, now() - interval '400 days');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.purge_deleted_projects(), 1, 'La purge efface un projet');
reset role;
select set_config('request.jwt.claims', '', true);
select results_eq(
  $$ select title from public.research_projects where owner_id = 'b0000000-0000-0000-0000-0000000021c2' order by title $$,
  $$ values ('Supprimé récemment'), ('Toujours vivant') $$,
  'Seul le projet supprimé depuis plus de trente jours est effacé'
);

-- Vingt créations par jour, projets supprimés compris.
update public.research_projects set created_at = now() - interval '2 days'
  where owner_id = 'a0000000-0000-0000-0000-0000000021c1';
insert into public.research_projects (owner_id, title, deleted_at)
select 'a0000000-0000-0000-0000-0000000021c1', 'Éphémère ' || g, now() from generate_series(1, 20) g;
select tests.login('a0000000-0000-0000-0000-0000000021c1');
select throws_ok(
  $$ select public.create_project('{"title": "Un de plus aujourd''hui"}') $$,
  null, 'rate_limited', 'Créer puis supprimer en boucle ne contourne pas la limite quotidienne'
);
reset role;
update public.research_projects set created_at = now() - interval '2 days'
  where owner_id = 'a0000000-0000-0000-0000-0000000021c1';

insert into public.research_projects (owner_id, title)
select 'a0000000-0000-0000-0000-0000000021c1', 'Projet ' || g from generate_series(1, 20) g;
update public.research_projects set created_at = now() - interval '2 days'
  where owner_id = 'a0000000-0000-0000-0000-0000000021c1';
select tests.login('a0000000-0000-0000-0000-0000000021c1');
select throws_ok($$ select public.create_project('{"title": "Un de trop"}') $$, null, 'limit_reached', 'Vingt projets au plus ; un projet supprimé ne compte pas');
reset role;

insert into private.account_status (user_id, status, changed_by)
values ('a0000000-0000-0000-0000-0000000021c1', 'suspended', 'e0000000-0000-0000-0000-0000000021c5');
select tests.login('a0000000-0000-0000-0000-0000000021c1');
select is_empty($$ select 1 from public.research_projects $$, 'Un compte suspendu ne lit plus ses projets');
select ok(not private.is_project_owner((select id from public.research_projects limit 1)), 'Ni n''en est reconnu propriétaire');
select is_empty($$ select private.my_project_ids() $$, 'La fonction d''appui des tables enfants ne lui rend rien');
select throws_ok($$ select public.create_project('{"title": "Suspendu"}') $$, '42501', 'forbidden', 'Il ne crée plus de projet');
reset role;

delete from auth.users where id = 'a0000000-0000-0000-0000-0000000021c1';
select is(
  (select count(*) from public.research_projects where owner_id = 'a0000000-0000-0000-0000-0000000021c1'),
  0::bigint, 'La suppression du compte efface ses projets'
);

select * from finish();
rollback;
