-- E-05 : notifications internes du suivi d'un projet.

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
  ('a0000000-0000-0000-0000-000000005401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000005402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-s@test.invalid', now()),
  ('60000000-0000-0000-0000-000000005403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-v@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000005404', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-b@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000540_';
insert into public.research_projects (id, owner_id, title) values
  ('54000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000005401', 'Mémoire de A');
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('54000000-0000-0000-0000-0000000000d1', '54000000-0000-0000-0000-0000000000a1', 1, 'Introduction', 'Texte de A.');
insert into public.research_project_members (project_id, user_id, role) values
  ('54000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005402', 'supervisor'),
  ('54000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000005403', 'viewer');

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'public.notifications', p)),
  0::bigint, 'Les notifications ne se lisent ni ne s''écrivent directement'
);

-- Aucun appel ne fabrique une notification : les fonctions d'écriture ne sont pas exécutables.
select tests.login('b0000000-0000-0000-0000-000000005404');
select throws_ok(
  $$ select private.notify('a0000000-0000-0000-0000-000000005401', null, 'comment', '54000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'Un utilisateur n''écrit pas de notification'
);
select throws_ok(
  $$ select private.notify_counterpart(null, 'comment', '54000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'Ni par l''autre fonction d''écriture'
);
reset role;
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('my_notifications', 'my_unread_notification_count', 'mark_notifications_read')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent les fonctions de notification'
);

-- L'encadreur commente : le propriétaire est averti, pas l'encadreur lui-même, ni le lecteur.
select tests.login('50000000-0000-0000-0000-000000005402');
insert into tests.ids
select 'c1', public.add_project_comment('54000000-0000-0000-0000-0000000000d1', '{"body": "Précisez la question."}');
select is((select count(*) from public.my_notifications()), 0::bigint, 'L''auteur d''un commentaire n''en est pas averti');
reset role;
select tests.login('60000000-0000-0000-0000-000000005403');
select is((select count(*) from public.my_notifications()), 0::bigint, 'Ni le lecteur simple');
reset role;
select tests.login('a0000000-0000-0000-0000-000000005401');
select results_eq(
  $$ select kind, is_read, project_title, scope, section_id from public.my_notifications() $$,
  $$ values ('comment', false, 'Mémoire de A', 'owner', '54000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'Le propriétaire est averti du commentaire, et de la section visée'
);
select is(public.my_unread_notification_count(), 1, 'Une notification non lue');
reset role;
-- Un second commentaire sur la même section, la première notification n'étant pas lue : pas de doublon.
select tests.login('50000000-0000-0000-0000-000000005402');
select public.add_project_comment('54000000-0000-0000-0000-0000000000d1', '{"body": "Et aussi la méthode."}');
reset role;
select tests.login('a0000000-0000-0000-0000-000000005401');
select is(public.my_unread_notification_count(), 1, 'La même notification, encore non lue, n''est pas répétée');

-- Il répond, pose une tâche, soumet une version : l'encadreur est averti de chacune.
select public.add_project_comment('54000000-0000-0000-0000-0000000000d1',
  jsonb_build_object('body', 'C''est fait.', 'parent_id', (select id from tests.ids where label = 'c1')));
select public.add_project_task('54000000-0000-0000-0000-0000000000a1', '{"title": "Relire"}');
insert into tests.ids select 'v1', public.submit_thesis_version('54000000-0000-0000-0000-0000000000a1', '{}');
select is(public.my_unread_notification_count(), 1, 'Ses propres actions ne l''avertissent pas');
select lives_ok($$ select public.mark_notifications_read() $$, 'Il marque ses notifications comme lues');
select is(public.my_unread_notification_count(), 0, 'Plus aucune non lue');
select is((select count(*) from public.my_notifications() where is_read), 1::bigint, 'Elles restent lisibles');
reset role;

select tests.login('50000000-0000-0000-0000-000000005402');
select results_eq(
  $$ select kind, scope from public.my_notifications() order by kind $$,
  $$ values ('reply', 'member'), ('task_added', 'member'), ('version_submitted', 'member') $$,
  'L''encadreur est averti de la réponse, de la tâche et de la version soumise'
);
select is(
  (select version_id from public.my_notifications() where kind = 'version_submitted'),
  (select id from tests.ids where label = 'v1'), 'La version soumise est désignée'
);
-- Il décide : le propriétaire est averti.
select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "accepted"}');
reset role;
select tests.login('a0000000-0000-0000-0000-000000005401');
select is(
  (select kind from public.my_notifications() where not is_read), 'version_decided',
  'Le propriétaire est averti de la décision'
);
reset role;

-- Le lecteur simple n'est averti de rien ; un tiers non plus, et ne marque rien chez les autres.
select tests.login('60000000-0000-0000-0000-000000005403');
select is((select count(*) from public.my_notifications()), 0::bigint, 'Le lecteur simple n''est averti de rien');
reset role;
select tests.login('b0000000-0000-0000-0000-000000005404');
select is((select count(*) from public.my_notifications()), 0::bigint, 'Un tiers ne voit aucune notification');
select lives_ok($$ select public.mark_notifications_read() $$, 'Marquer comme lu ne touche que les siennes');
reset role;
select is(
  (select count(*) from public.notifications where user_id = '50000000-0000-0000-0000-000000005402' and read_at is null),
  3::bigint, 'Celles de l''encadreur sont toujours non lues'
);

-- Passé en accès limité, l'encadreur ne voit plus les notifications du projet.
update public.research_project_members set full_access = false where user_id = '50000000-0000-0000-0000-000000005402';
select tests.login('50000000-0000-0000-0000-000000005402');
select is((select count(*) from public.my_notifications()), 0::bigint, 'En accès limité, il ne voit plus les notifications du projet');
reset role;
update public.research_project_members set full_access = true where user_id = '50000000-0000-0000-0000-000000005402';

-- Retiré du projet, ses notifications partent avec son appartenance.
delete from public.research_project_members where user_id = '50000000-0000-0000-0000-000000005402';
select tests.login('50000000-0000-0000-0000-000000005402');
select is((select count(*) from public.my_notifications()), 0::bigint, 'Retiré, il ne voit plus les notifications du projet');
select is(public.my_unread_notification_count(), 0, 'Ni leur nombre');
reset role;
select is(
  (select count(*) from public.notifications where user_id = '50000000-0000-0000-0000-000000005402'),
  0::bigint, 'Elles sont effacées : rien de masqué ne pèse sur son plafond'
);

-- Une notification ne porte aucun contenu.
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'notifications'
     and column_name not in ('id', 'user_id', 'kind', 'project_id', 'section_id', 'version_id', 'created_at', 'read_at')),
  0::bigint, 'Une notification dit ce qui s''est passé et où, rien d''autre'
);

-- Pas d'inondation : cinquante non lues au plus par projet, sans étouffer les autres projets.
insert into public.research_projects (id, owner_id, title) values
  ('54000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000005401', 'Second projet de A');
insert into public.thesis_sections (id, project_id, position, title) values
  ('54000000-0000-0000-0000-0000000000d2', '54000000-0000-0000-0000-0000000000a2', 1, 'Section du second projet');
insert into public.research_project_members (project_id, user_id, role) values
  ('54000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005402', 'supervisor'),
  ('54000000-0000-0000-0000-0000000000a2', '50000000-0000-0000-0000-000000005402', 'supervisor');
insert into public.notifications (user_id, kind, project_id, section_id)
select 'a0000000-0000-0000-0000-000000005401', 'comment', '54000000-0000-0000-0000-0000000000a1', gen_random_uuid()
from generate_series(1, 50 - (select count(*)::integer from public.notifications
                              where user_id = 'a0000000-0000-0000-0000-000000005401'
                                and project_id = '54000000-0000-0000-0000-0000000000a1' and read_at is null));
select tests.login('50000000-0000-0000-0000-000000005402');
select public.add_project_task('54000000-0000-0000-0000-0000000000a1', '{"title": "Dans le projet saturé"}');
select public.add_project_comment('54000000-0000-0000-0000-0000000000d2', '{"body": "Dans le second projet."}');
reset role;
select is(
  (select count(*) from public.notifications
   where user_id = 'a0000000-0000-0000-0000-000000005401' and project_id = '54000000-0000-0000-0000-0000000000a1' and read_at is null),
  50::bigint, 'Au-delà de cinquante non lues sur un projet, aucune notification ne s''y ajoute'
);
select is(
  (select count(*) from public.notifications
   where user_id = 'a0000000-0000-0000-0000-000000005401' and project_id = '54000000-0000-0000-0000-0000000000a2'),
  1::bigint, 'Un projet saturé n''étouffe pas les notifications d''un autre'
);

-- Second facteur.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000005401', 'a0000000-0000-0000-0000-000000005401', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('a0000000-0000-0000-0000-000000005401', 'aal1');
select is((select count(*) from public.my_notifications()), 0::bigint, 'En session au seul mot de passe, un compte à second facteur ne lit pas ses notifications');
select throws_ok($$ select public.mark_notifications_read() $$, '42501', 'forbidden', 'Ni ne les marque');
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000005401';

-- Purge : par le propriétaire de la base seulement.
update public.notifications set read_at = now() - interval '31 days'
where id = (select id from public.notifications where user_id = 'a0000000-0000-0000-0000-000000005401' limit 1);
select tests.login('a0000000-0000-0000-0000-000000005401');
select throws_ok($$ select private.purge_old_notifications() $$, '42501', null, 'Un utilisateur ne lance pas la purge');
reset role;
select cmp_ok(private.purge_old_notifications(), '>=', 1, 'La purge efface les notifications lues depuis plus de trente jours');
select is(
  (select count(*) from cron.job where jobname = 'eduscholar-notifications-purge' and active and username = 'postgres'),
  1::bigint, 'Elle est planifiée chaque nuit'
);

-- Suppression de compte : les notifications partent avec le projet.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000005401' $$, 'Le propriétaire supprime son compte');
select is(
  (select count(*) from public.notifications where project_id = '54000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Les notifications partent avec le projet'
);

select * from finish();
rollback;
