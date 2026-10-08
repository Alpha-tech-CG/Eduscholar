-- E-05 (suite) : courriel des notifications et rappel d'échéance.

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
create function tests.as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create table tests.vals (label text primary key, val text);
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;
grant all on tests.vals to authenticated, service_role;

-- A : propriétaire. S : encadreur. V : lecteur. L : encadreur à accès limité. X : suspendu.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000005901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'courriel-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000005902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'courriel-s@test.invalid', now()),
  ('60000000-0000-0000-0000-000000005903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'courriel-v@test.invalid', now()),
  ('70000000-0000-0000-0000-000000005904', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'courriel-l@test.invalid', now()),
  ('80000000-0000-0000-0000-000000005905', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'courriel-x@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000590_';
insert into public.research_projects (id, owner_id, title) values
  ('59000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000005901', 'Mémoire de A'),
  ('59000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-000000005905', 'Mémoire de X');
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('59000000-0000-0000-0000-0000000000d1', '59000000-0000-0000-0000-0000000000a1', 1, 'Introduction', 'Texte de A.'),
  ('59000000-0000-0000-0000-0000000000d2', '59000000-0000-0000-0000-0000000000a1', 2, 'Méthode', 'Méthode de A.');
insert into public.research_project_members (project_id, user_id, role, full_access) values
  ('59000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005902', 'supervisor', true),
  ('59000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000005903', 'viewer', true),
  ('59000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-000000005904', 'supervisor', false),
  ('59000000-0000-0000-0000-0000000000a2', '50000000-0000-0000-0000-000000005902', 'supervisor', true);
insert into public.research_project_member_sections (project_id, user_id, section_id) values
  ('59000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-000000005904', '59000000-0000-0000-0000-0000000000d1');

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'public.notification_preferences', p)),
  0::bigint, 'Les préférences ne se lisent ni ne s''écrivent directement'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('claim_notification_digests', 'unsubscribe_notifications')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni un utilisateur n''appellent les fonctions du serveur'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('my_notification_preferences', 'set_notification_preferences')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur ne fixent le choix de quelqu''un'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname in ('notify_due_tasks', 'notification_visible_to')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Le rappel d''échéance et la règle de visibilité ne s''appellent pas'
);

-- ---------------------------------------------------------------------------
-- Le choix : désactivé par défaut
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000005901');
select is(public.my_notification_preferences(), false, 'Aucun courriel par défaut');
select throws_ok(
  $$ select public.set_notification_preferences('{"email_digest": "oui"}') $$,
  '22023', 'invalid_payload', 'Un choix qui n''est pas un booléen est refusé'
);
select throws_ok(
  $$ select public.set_notification_preferences('{}') $$,
  '22023', 'invalid_payload', 'Un choix absent aussi'
);
select lives_ok($$ select public.set_notification_preferences('{"email_digest": true}') $$, 'Le propriétaire demande le courriel');
select is(public.my_notification_preferences(), true, 'Son choix est enregistré');
reset role;
select is(
  (select count(*) from public.notification_preferences where user_id <> 'a0000000-0000-0000-0000-000000005901'
     and user_id::text like '%-00000000590_'),
  0::bigint, 'Il ne vaut que pour lui'
);
select tests.login('50000000-0000-0000-0000-000000005902');
select public.set_notification_preferences('{"email_digest": true}');
reset role;
select tests.login('70000000-0000-0000-0000-000000005904');
select public.set_notification_preferences('{"email_digest": true}');
reset role;
select tests.login('80000000-0000-0000-0000-000000005905');
select public.set_notification_preferences('{"email_digest": true}');
reset role;

-- Les autres comptes de la base locale ne comptent pas dans ce test.
update public.notification_preferences set email_digest = false where user_id::text not like '%-00000000590_';

-- ---------------------------------------------------------------------------
-- Qui est prévenu
-- ---------------------------------------------------------------------------
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(50)), 0::bigint, 'Sans notification, personne n''est prévenu');
reset role;

-- L'encadreur commente la section « Méthode » : le propriétaire a du nouveau.
select tests.login('50000000-0000-0000-0000-000000005902');
select public.add_project_comment('59000000-0000-0000-0000-0000000000d2', '{"body": "Précisez l''échantillon."}');
reset role;
-- Le propriétaire répond : l'encadreur a du nouveau ; l'encadreur limité, à qui
-- la section est fermée, n'a rien qu'il puisse voir.
select tests.login('a0000000-0000-0000-0000-000000005901');
select public.add_project_comment('59000000-0000-0000-0000-0000000000d2', '{"body": "Note pour la méthode."}');
reset role;
-- Une notification que son destinataire ne peut pas voir ne le prévient pas.
insert into public.notifications (user_id, kind, project_id, section_id) values
  ('70000000-0000-0000-0000-000000005904', 'comment', '59000000-0000-0000-0000-0000000000a1', '59000000-0000-0000-0000-0000000000d2');
-- Le compte suspendu a du nouveau, lui aussi.
insert into public.notifications (user_id, kind, project_id) values
  ('80000000-0000-0000-0000-000000005905', 'task_added', '59000000-0000-0000-0000-0000000000a2');
insert into private.account_status (user_id, status, reason, changed_by) values
  ('80000000-0000-0000-0000-000000005905', 'suspended', 'Test', 'a0000000-0000-0000-0000-000000005901');

select tests.as_service();
insert into tests.vals
select 'jeton-' || email, unsubscribe_token from public.claim_notification_digests(50);
reset role;
select results_eq(
  $$ select label from tests.vals order by label $$,
  $$ values ('jeton-courriel-a@test.invalid'), ('jeton-courriel-s@test.invalid') $$,
  'Sont prévenus le propriétaire et l''encadreur : ni l''accès limité hors de sa portée, ni le compte suspendu'
);
select ok(
  (select bool_and(val ~ '^[0-9a-f]{64}$') from tests.vals),
  'Chacun reçoit son jeton de désabonnement'
);
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(50)), 0::bigint, 'Un second appel ne prévient personne deux fois');
reset role;

-- Du nouveau moins de vingt heures après : pas de second courriel.
select tests.login('50000000-0000-0000-0000-000000005902');
select public.add_project_task('59000000-0000-0000-0000-0000000000a1', '{"title": "Revoir le plan"}');
reset role;
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(50)), 0::bigint, 'Au plus un courriel par vingt heures');
reset role;
-- Vingt et une heures plus tard, avec ce nouveau : un courriel.
update public.notification_preferences set last_emailed_at = now() - interval '21 hours'
where user_id::text like '%-00000000590_';
update public.notifications set created_at = now() - interval '22 hours'
where user_id::text like '%-00000000590_' and kind <> 'task_added';
select tests.as_service();
select results_eq(
  $$ select email from public.claim_notification_digests(50) $$,
  $$ values ('courriel-a@test.invalid') $$,
  'Le lendemain, seul qui a du nouveau depuis le dernier courriel est prévenu'
);
reset role;
-- Tout lu : plus rien à dire.
update public.notification_preferences set last_emailed_at = null, updated_at = now() - interval '2 days'
where user_id::text like '%-00000000590_';
select tests.login('a0000000-0000-0000-0000-000000005901');
select public.mark_notifications_read();
reset role;
select tests.as_service();
select results_eq(
  $$ select email from public.claim_notification_digests(50) $$,
  $$ values ('courriel-s@test.invalid') $$,
  'Qui a tout lu n''est pas prévenu'
);
reset role;
-- Adresse non confirmée : pas de courriel.
update public.notification_preferences set last_emailed_at = null, updated_at = now() - interval '2 days'
where user_id::text like '%-00000000590_';
update auth.users set email_confirmed_at = null where id = '50000000-0000-0000-0000-000000005902';
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(50)), 0::bigint, 'Une adresse non confirmée ne reçoit rien');
reset role;
update auth.users set email_confirmed_at = now() where id = '50000000-0000-0000-0000-000000005902';
-- La limite demandée est respectée, et bornée.
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(0)), 1::bigint, 'La limite demandée vaut au moins un');
reset role;
select cmp_ok(
  (select count(*) from public.audit_logs where action = 'notifications.digest_claimed'
     and actor_id is null and subject_user_id is null and metadata ? 'count'), '>=', 3::bigint,
  'Chaque envoi laisse une trace : un nombre, personne'
);
select is(
  (select count(*) from public.audit_logs where action = 'notifications.digest_claimed'
     and metadata::text ~ '@|[0-9a-f]{20,}'),
  0::bigint, 'Ni adresse ni jeton dans cette trace'
);

-- Banni auprès du service d'authentification, projet supprimé : pas de courriel.
update public.notification_preferences set last_emailed_at = null, updated_at = now() - interval '2 days'
where user_id::text like '%-00000000590_';
update auth.users set banned_until = now() + interval '1 day' where id = '50000000-0000-0000-0000-000000005902';
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(1000)), 0::bigint, 'Un compte banni ne reçoit rien');
reset role;
update auth.users set banned_until = null where id = '50000000-0000-0000-0000-000000005902';
update public.research_projects set deleted_at = now() where id = '59000000-0000-0000-0000-0000000000a1';
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(1000)), 0::bigint, 'Les notifications d''un projet supprimé ne préviennent personne');
reset role;
update public.research_projects set deleted_at = null where id = '59000000-0000-0000-0000-0000000000a1';
-- Activer le courriel ne prévient pas de ce qui attendait déjà.
update public.notification_preferences set updated_at = clock_timestamp() where user_id = '50000000-0000-0000-0000-000000005902';
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(1000)), 0::bigint, 'Ce qui attendait avant le réglage ne déclenche pas de courriel');
reset role;
update public.notification_preferences set updated_at = now() - interval '2 days' where user_id = '50000000-0000-0000-0000-000000005902';
select tests.as_service();
select is((select count(*) from public.claim_notification_digests(1000)), 1::bigint, 'Une limite démesurée est bornée, et l''encadreur est prévenu');
reset role;

-- ---------------------------------------------------------------------------
-- Désabonnement
-- ---------------------------------------------------------------------------
select tests.as_service();
select lives_ok($$ select public.unsubscribe_notifications('zz') $$, 'Un jeton mal formé ne fait rien, sans le dire');
select lives_ok($$ select public.unsubscribe_notifications(repeat('0', 64)) $$, 'Un jeton inconnu non plus');
reset role;
select is(
  (select count(*) from public.notification_preferences where email_digest and user_id::text like '%-00000000590_'),
  4::bigint, 'Personne n''est désabonné par un jeton inconnu'
);
select tests.as_service();
select lives_ok(
  $$ select public.unsubscribe_notifications((select val from tests.vals where label = 'jeton-courriel-a@test.invalid')) $$,
  'Le jeton du courriel désabonne'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000005901');
select is(public.my_notification_preferences(), false, 'Le propriétaire ne reçoit plus de courriel');
select is(
  (select count(*) from public.my_account_events() where action = 'notifications.unsubscribed_by_link'), 1::bigint,
  'Il lit ce désabonnement parmi les événements de son compte'
);
reset role;
select isnt(
  (select unsubscribe_token from public.notification_preferences where user_id = 'a0000000-0000-0000-0000-000000005901'),
  (select val from tests.vals where label = 'jeton-courriel-a@test.invalid'), 'Le jeton utilisé est remplacé'
);
select is(
  (select count(*) from public.audit_logs where action = 'notifications.unsubscribed_by_link'
     and subject_user_id::text like '%-00000000590_'), 1::bigint,
  'Un jeton inconnu ne laisse pas de trace'
);
select is(
  (select count(*) from public.notification_preferences where email_digest and user_id::text like '%-00000000590_'),
  3::bigint, 'Les autres ne sont pas touchés'
);
-- Il réactive : le jeton de l'ancien courriel ne vaut plus.
select tests.login('a0000000-0000-0000-0000-000000005901');
select public.set_notification_preferences('{"email_digest": true}');
reset role;
select tests.as_service();
select public.unsubscribe_notifications((select val from tests.vals where label = 'jeton-courriel-a@test.invalid'));
reset role;
select tests.login('a0000000-0000-0000-0000-000000005901');
select is(public.my_notification_preferences(), true, 'Un jeton déjà utilisé ne désabonne plus');
reset role;

-- Un utilisateur n'appelle ni l'une ni l'autre des fonctions du serveur.
select tests.login('50000000-0000-0000-0000-000000005902');
select throws_ok($$ select * from public.claim_notification_digests(50) $$, '42501', null, 'Un utilisateur ne lit pas la liste des personnes à prévenir');
select throws_ok($$ select public.unsubscribe_notifications(repeat('0', 64)) $$, '42501', null, 'Ni ne désabonne par jeton');
reset role;

-- Session au seul mot de passe d'un compte à second facteur : pas de réglage.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('fa000000-0000-0000-0000-000000005903', '60000000-0000-0000-0000-000000005903', 'Test', 'totp', 'verified', now(), now(), 'x');
select tests.login('60000000-0000-0000-0000-000000005903');
select throws_ok(
  $$ select public.set_notification_preferences('{"email_digest": true}') $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne règle rien'
);
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000005903';

-- ---------------------------------------------------------------------------
-- Rappel d'échéance
-- ---------------------------------------------------------------------------
delete from public.project_tasks where project_id = '59000000-0000-0000-0000-0000000000a1';
insert into public.project_tasks (id, project_id, title, due_date, done_at) values
  ('59000000-0000-0000-0000-0000000000e1', '59000000-0000-0000-0000-0000000000a1', 'Demain', current_date + 1, null),
  ('59000000-0000-0000-0000-0000000000e2', '59000000-0000-0000-0000-0000000000a1', 'Dans un mois', current_date + 30, null),
  ('59000000-0000-0000-0000-0000000000e3', '59000000-0000-0000-0000-0000000000a1', 'Faite', current_date + 1, now()),
  ('59000000-0000-0000-0000-0000000000e4', '59000000-0000-0000-0000-0000000000a1', 'Passée', current_date - 1, null),
  ('59000000-0000-0000-0000-0000000000e5', '59000000-0000-0000-0000-0000000000a1', 'Sans date', null, null);
delete from public.notifications where user_id::text like '%-00000000590_';

select tests.login('a0000000-0000-0000-0000-000000005901');
select throws_ok($$ select private.notify_due_tasks() $$, '42501', null, 'Un utilisateur ne lance pas le rappel');
reset role;
select lives_ok($$ select private.notify_due_tasks() $$, 'Le rappel passe');
select results_eq(
  $$ select id from public.project_tasks
     where project_id = '59000000-0000-0000-0000-0000000000a1' and reminded_for is not null $$,
  $$ values ('59000000-0000-0000-0000-0000000000e1'::uuid) $$,
  'Seule la tâche non faite à échéance proche est rappelée'
);
select results_eq(
  $$ select user_id, kind from public.notifications
     where project_id = '59000000-0000-0000-0000-0000000000a1' order by user_id $$,
  $$ values ('50000000-0000-0000-0000-000000005902'::uuid, 'task_due'),
            ('a0000000-0000-0000-0000-000000005901'::uuid, 'task_due') $$,
  'Sont avertis le propriétaire et l''encadreur à accès complet : ni le lecteur, ni l''accès limité'
);
select tests.login('a0000000-0000-0000-0000-000000005901');
select results_eq(
  $$ select kind, scope from public.my_notifications() $$,
  $$ values ('task_due', 'owner') $$,
  'Le propriétaire lit le rappel'
);
select public.mark_notifications_read();
reset role;
select lives_ok($$ select private.notify_due_tasks() $$, 'Le rappel repasse le lendemain');
select is(
  (select count(*) from public.notifications
   where user_id = 'a0000000-0000-0000-0000-000000005901' and read_at is null),
  0::bigint, 'Une tâche n''est rappelée qu''une fois'
);
-- L'échéance est déplacée : elle est rappelée de nouveau.
update public.project_tasks set due_date = current_date + 2 where id = '59000000-0000-0000-0000-0000000000e1';
select lives_ok($$ select private.notify_due_tasks() $$, 'Le rappel repasse après un report');
select is(
  (select count(*) from public.notifications
   where user_id = 'a0000000-0000-0000-0000-000000005901' and read_at is null and kind = 'task_due'),
  1::bigint, 'Une échéance déplacée est rappelée de nouveau'
);
-- Projet supprimé : ses tâches ne sont pas rappelées.
update public.project_tasks set due_date = current_date + 1 where id = '59000000-0000-0000-0000-0000000000e2';
update public.research_projects set deleted_at = now() where id = '59000000-0000-0000-0000-0000000000a1';
select private.notify_due_tasks();
select is(
  (select reminded_for from public.project_tasks where id = '59000000-0000-0000-0000-0000000000e2'), null::date,
  'Les tâches d''un projet supprimé ne sont pas rappelées'
);
update public.research_projects set deleted_at = null where id = '59000000-0000-0000-0000-0000000000a1';
-- Un rappel qui ne peut pas s'écrire (cinquante non lues sur le projet) est retenté.
delete from public.notifications where user_id = 'a0000000-0000-0000-0000-000000005901';
insert into public.notifications (user_id, kind, project_id, version_id)
select 'a0000000-0000-0000-0000-000000005901', 'version_decided', '59000000-0000-0000-0000-0000000000a1', gen_random_uuid()
from generate_series(1, 50);
select private.notify_due_tasks();
select is(
  (select reminded_for from public.project_tasks where id = '59000000-0000-0000-0000-0000000000e2'), null::date,
  'Un rappel qui n''a pas pu s''écrire n''est pas marqué comme fait'
);
delete from public.notifications where user_id = 'a0000000-0000-0000-0000-000000005901';
select private.notify_due_tasks();
select is(
  (select reminded_for from public.project_tasks where id = '59000000-0000-0000-0000-0000000000e2'), current_date + 1,
  'Il est retenté au passage suivant'
);
select is(
  (select count(*) from cron.job where jobname = 'eduscholar-task-reminders' and active and username = 'postgres'),
  1::bigint, 'Le rappel est planifié chaque jour'
);

-- Suppression du compte : le choix part avec lui.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = '50000000-0000-0000-0000-000000005902' $$, 'L''encadreur supprime son compte');
select is(
  (select count(*) from public.notification_preferences where user_id = '50000000-0000-0000-0000-000000005902'),
  0::bigint, 'Son choix part avec son compte'
);

select * from finish();
rollback;
