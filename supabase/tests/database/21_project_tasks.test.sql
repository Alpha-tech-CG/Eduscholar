-- E-04 : tâches et échéances d'un projet partagé.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create table tests.ids (label text primary key, id uuid);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.ids to authenticated;

-- A : propriétaire. S : encadreur. V : lecteur. B : tiers.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000005201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tache-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000005202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tache-s@test.invalid', now()),
  ('60000000-0000-0000-0000-000000005203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tache-v@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000005204', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tache-b@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000520_';
insert into public.research_projects (id, owner_id, title) values
  ('52000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000005201', 'Mémoire de A'),
  ('52000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000005204', 'Projet de B');
insert into public.research_project_members (project_id, user_id, role) values
  ('52000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005202', 'supervisor'),
  ('52000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000005203', 'viewer');

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'public.project_tasks', p)),
  0::bigint, 'Les tâches ne se lisent ni ne s''écrivent directement'
);

-- ---------------------------------------------------------------------------
-- Créer
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000005202');
insert into tests.ids
select 't-s', public.add_project_task('52000000-0000-0000-0000-0000000000a1',
  '{"title": "  Reprendre la problématique  ", "details": "Voir mes commentaires.", "due_date": "2026-11-15"}');
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "   "}') $$,
  '22023', 'invalid_payload', 'Une tâche sans intitulé est refusée'
);
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": {"a": 1}}') $$,
  '22023', 'invalid_payload', 'Un intitulé qui n''est pas une chaîne est refusé'
);
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', jsonb_build_object('title', repeat('a', 201))) $$,
  '22023', 'invalid_payload', 'Un intitulé trop long aussi'
);
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "Date", "due_date": "1999-12-31"}') $$,
  '22007', 'invalid_date', 'Une date hors bornes est refusée'
);
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "Date", "due_date": "2026-02-30"}') $$,
  '22007', 'invalid_date', 'Une date impossible aussi'
);
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "Date", "due_date": "demain"}') $$,
  '22007', 'invalid_date', 'Et une date mal écrite'
);
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000b1', '{"title": "Chez B"}') $$,
  null, 'not_found', 'On ne crée pas de tâche dans un projet où l''on n''est pas'
);
reset role;
select is(
  (select title || '/' || due_date from public.project_tasks where id = (select id from tests.ids where label = 't-s')),
  'Reprendre la problématique/2026-11-15', 'La tâche est rangée nettoyée, avec son échéance'
);
select tests.login('50000000-0000-0000-0000-000000005202');
insert into tests.ids
select 't-lignes', public.add_project_task('52000000-0000-0000-0000-0000000000a1', jsonb_build_object('title', E'Sur\ndeux lignes'));
select is((select count(*) from public.my_project_tasks()), 2::bigint, 'L''encadreur retrouve dans sa copie de données les tâches qu''il a posées');
reset role;
select is(
  (select title from public.project_tasks where id = (select id from tests.ids where label = 't-lignes')),
  'Sur deux lignes', 'L''intitulé tient sur une ligne'
);
delete from public.project_tasks where id = (select id from tests.ids where label = 't-lignes');

select tests.login('a0000000-0000-0000-0000-000000005201');
insert into tests.ids
select 't-a', public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "Rédiger la méthode"}');
reset role;

select tests.login('60000000-0000-0000-0000-000000005203');
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "Lecteur"}') $$,
  '42501', 'forbidden', 'Un lecteur simple ne crée pas de tâche'
);
-- ... mais il les lit, sans pouvoir en modifier aucune.
select is(
  (select string_agg((t ->> 'title') || ':' || (t ->> 'author_role') || ':' || (t ->> 'editable'), ',' order by t ->> 'title')
   from jsonb_array_elements(public.project_tasks('52000000-0000-0000-0000-0000000000a1') -> 'tasks') t),
  'Rédiger la méthode:owner:false,Reprendre la problématique:supervisor:false',
  'Le lecteur lit les tâches et qui les a posées, sans pouvoir les modifier'
);
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-a'), '{"done": true}') $$,
  '42501', 'forbidden', 'Il n''en clôt aucune'
);
reset role;

select tests.login('b0000000-0000-0000-0000-000000005204');
select throws_ok(
  $$ select public.project_tasks('52000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Un tiers ne lit pas les tâches'
);
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-a'), '{"done": true}') $$,
  null, 'not_found', 'Ni ne modifie une tâche dont il connaîtrait l''identifiant'
);
select throws_ok(
  $$ select public.delete_project_task('99999999-0000-0000-0000-000000000000') $$,
  null, 'not_found', 'Une tâche inconnue reçoit la même réponse'
);
reset role;

-- ---------------------------------------------------------------------------
-- Modifier, clore, supprimer
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000005202');
select is(
  (select string_agg((t ->> 'title') || ':' || (t ->> 'editable'), ',' order by t ->> 'title')
   from jsonb_array_elements(public.project_tasks('52000000-0000-0000-0000-0000000000a1') -> 'tasks') t),
  'Rédiger la méthode:false,Reprendre la problématique:true', 'L''encadreur ne peut modifier que les tâches qu''il a créées'
);
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-a'), '{"title": "Réécrite"}') $$,
  '42501', 'forbidden', 'Il ne modifie pas celle de l''étudiant'
);
select throws_ok(
  $$ select public.delete_project_task((select id from tests.ids where label = 't-a')) $$,
  '42501', 'forbidden', 'Ni ne la supprime'
);
select lives_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"due_date": "2026-12-01"}') $$,
  'Il repousse l''échéance de la sienne'
);
reset role;
select is(
  (select title || '/' || details || '/' || due_date from public.project_tasks where id = (select id from tests.ids where label = 't-s')),
  'Reprendre la problématique/Voir mes commentaires./2026-12-01', 'Seule l''échéance a changé'
);

-- Le propriétaire modifie et clôt toutes les tâches, y compris celles de l'encadreur.
select tests.login('a0000000-0000-0000-0000-000000005201');
select lives_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"done": true}') $$,
  'Le propriétaire clôt la tâche posée par son encadreur'
);
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"done": "oui"}') $$,
  '22023', 'invalid_payload', 'L''état d''une tâche est vrai ou faux'
);
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"title": ""}') $$,
  '22023', 'invalid_payload', 'On ne vide pas l''intitulé'
);
select is(
  (select string_agg(t ->> 'title', ',' order by ordinality)
   from jsonb_array_elements(public.project_tasks('52000000-0000-0000-0000-0000000000a1') -> 'tasks') with ordinality as x(t, ordinality)),
  'Rédiger la méthode,Reprendre la problématique', 'Les tâches ouvertes viennent d''abord'
);
select lives_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"done": false, "due_date": ""}') $$,
  'Il la rouvre et retire son échéance'
);
reset role;
select is(
  (select (done_at is null) || '/' || (due_date is null) from public.project_tasks where id = (select id from tests.ids where label = 't-s')),
  'true/true', 'La tâche est rouverte, sans échéance'
);
select tests.login('a0000000-0000-0000-0000-000000005201');
select lives_ok($$ select public.delete_project_task((select id from tests.ids where label = 't-a')) $$, 'Il supprime une tâche');
select is((select count(*) from public.my_project_tasks()), 1::bigint, 'Sa copie de données porte les tâches de ses projets');
reset role;

-- Trente tâches ouvertes au plus pour un membre : le propriétaire garde la main.
insert into public.project_tasks (project_id, title, created_by)
select '52000000-0000-0000-0000-0000000000a1', 'De l''encadreur ' || g, '50000000-0000-0000-0000-000000005202'
from generate_series(1, 29) g;
delete from private.rate_limit_buckets where bucket_key like 'project-task:%';
select tests.login('50000000-0000-0000-0000-000000005202');
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "De trop"}') $$,
  'P0001', 'limit_reached', 'Trente tâches ouvertes au plus pour un membre'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000005201');
select lives_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "Le propriétaire crée encore"}') $$,
  'Le propriétaire crée encore quand son encadreur a atteint son plafond'
);
reset role;
delete from public.project_tasks where title like 'De l''encadreur %' or title = 'Le propriétaire crée encore';

-- Les modifications ont leur propre compteur : elles n'entament pas celui des créations.
select is(
  (select count(*) from private.rate_limit_buckets where bucket_key like 'project-task-update:%'), 2::bigint,
  'Modifier et créer sont comptés à part'
);

-- ---------------------------------------------------------------------------
-- Plafond, second facteur, retrait, suppression de compte
-- ---------------------------------------------------------------------------
insert into public.project_tasks (project_id, title, created_by)
select '52000000-0000-0000-0000-0000000000a1', 'Remplissage ' || g, 'a0000000-0000-0000-0000-000000005201'
from generate_series(1, 99) g;
select tests.login('a0000000-0000-0000-0000-000000005201');
select throws_ok(
  $$ select public.add_project_task('52000000-0000-0000-0000-0000000000a1', '{"title": "De trop"}') $$,
  'P0001', 'limit_reached', 'Cent tâches au plus par projet'
);
reset role;

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000005202', '50000000-0000-0000-0000-000000005202', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('50000000-0000-0000-0000-000000005202', 'aal1');
select throws_ok(
  $$ select public.project_tasks('52000000-0000-0000-0000-0000000000a1') $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne lit pas les tâches'
);
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"done": true}') $$,
  '42501', 'forbidden', 'Ni n''en modifie'
);
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000005202';

-- Retiré du projet, l'encadreur ne touche plus à ses tâches ; redevenu lecteur non plus.
update public.research_project_members set role = 'viewer' where user_id = '50000000-0000-0000-0000-000000005202';
select tests.login('50000000-0000-0000-0000-000000005202');
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"done": true}') $$,
  '42501', 'forbidden', 'Redevenu lecteur, il ne modifie plus ses tâches'
);
reset role;
delete from public.research_project_members where user_id = '50000000-0000-0000-0000-000000005202';
update public.project_tasks set title = 'Réécrite par le propriétaire après le retrait'
where id = (select id from tests.ids where label = 't-s');
select tests.login('50000000-0000-0000-0000-000000005202');
select throws_ok(
  $$ select public.update_project_task((select id from tests.ids where label = 't-s'), '{"done": true}') $$,
  null, 'not_found', 'Retiré, plus rien'
);
select is(
  (select count(*) from public.my_project_tasks()), 0::bigint,
  'Sa copie de données ne lui rend plus les tâches d''un projet dont il a été retiré'
);
reset role;
update public.project_tasks set title = 'Reprendre la problématique'
where id = (select id from tests.ids where label = 't-s');

select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = '50000000-0000-0000-0000-000000005202' $$, 'L''encadreur supprime son compte');
select is(
  (select (created_by is null) || '/' || title from public.project_tasks where id = (select id from tests.ids where label = 't-s')),
  'true/Reprendre la problématique', 'Sa tâche reste dans le projet de l''étudiant, sans son identifiant'
);
select lives_ok($$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000005201' $$, 'Le propriétaire supprime son compte');
select is(
  (select count(*) from public.project_tasks where project_id = '52000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Les tâches partent avec le projet'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('add_project_task', 'update_project_task', 'delete_project_task', 'project_tasks', 'my_project_tasks')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent les fonctions de tâche'
);

select * from finish();
rollback;
