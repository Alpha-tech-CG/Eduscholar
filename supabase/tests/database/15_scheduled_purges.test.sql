-- Purges planifiées (D-12, D-23).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

-- Comptes : jamais confirmé et ancien (à purger) ; jamais confirmé mais récent ;
-- confirmé et ancien ; jamais confirmé, ancien, mais qui s'est déjà connecté ;
-- jamais confirmé, ancien, détenant un rôle, membre d'une organisation ou suspendu
-- (anomalies à examiner, pas à effacer) ; jamais confirmé, ancien, à qui un courriel
-- vient d'être envoyé ; ancien, confirmé par téléphone ; ancien, à connexion unique.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, last_sign_in_at, created_at) values
  ('a0000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-ancien@test.invalid', null, null, now() - interval '8 days'),
  ('b0000000-0000-0000-0000-000000003202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-recent@test.invalid', null, null, now() - interval '6 days'),
  ('c0000000-0000-0000-0000-000000003203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-confirme@test.invalid', now() - interval '30 days', null, now() - interval '30 days'),
  ('d0000000-0000-0000-0000-000000003204', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-connecte@test.invalid', null, now() - interval '9 days', now() - interval '10 days'),
  ('e0000000-0000-0000-0000-000000003205', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-role@test.invalid', null, null, now() - interval '10 days'),
  ('f0000000-0000-0000-0000-000000003206', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-membre@test.invalid', null, null, now() - interval '10 days'),
  ('f0000000-0000-0000-0000-000000003207', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-suspendu@test.invalid', null, null, now() - interval '10 days'),
  ('f0000000-0000-0000-0000-000000003208', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-courriel@test.invalid', null, null, now() - interval '10 days'),
  ('f0000000-0000-0000-0000-000000003209', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-telephone@test.invalid', null, null, now() - interval '10 days'),
  ('f0000000-0000-0000-0000-000000003210', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-sso@test.invalid', null, null, now() - interval '10 days');
update auth.users set confirmation_sent_at = now() - interval '10 minutes' where id = 'f0000000-0000-0000-0000-000000003208';
update auth.users set phone_confirmed_at = now() - interval '9 days' where id = 'f0000000-0000-0000-0000-000000003209';
update auth.users set is_sso_user = true where id = 'f0000000-0000-0000-0000-000000003210';
insert into public.organizations (id, name, slug) values
  ('32000000-0000-0000-0000-0000000000b1', 'Organisation du test de purge', 'purge-test-3200');
insert into public.organization_members (organization_id, user_id, role) values
  ('32000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-000000003206', 'member');
insert into private.account_status (user_id, status, reason) values
  ('f0000000-0000-0000-0000-000000003207', 'suspended', 'Inscriptions abusives');
insert into public.platform_roles (user_id, role) values ('e0000000-0000-0000-0000-000000003205', 'moderator');

-- Projets du compte confirmé : supprimé depuis longtemps, supprimé récemment, vivant.
insert into public.research_projects (id, owner_id, title, deleted_at) values
  ('32000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000003203', 'Supprimé il y a longtemps', now() - interval '31 days'),
  ('32000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000003203', 'Supprimé récemment', now() - interval '29 days'),
  ('32000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-000000003203', 'Vivant', null);
insert into public.project_sources (project_id, title) values
  ('32000000-0000-0000-0000-0000000000a1', 'Source d''un projet purgé');

-- Compteurs de débit : un ancien, un récent.
insert into private.rate_limit_buckets (bucket_key, window_start, hits) values
  ('purge-test:ancien', now() - interval '3 days', 1),
  ('purge-test:recent', now() - interval '1 hour', 1);

-- ---------------------------------------------------------------------------
-- Qui peut lancer la purge
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from cron.job where jobname = 'eduscholar-purges' and active
     and username = 'postgres'
     and schedule = '17 3 * * *' and command = 'select private.run_scheduled_purges()'),
  1::bigint, 'La purge est planifiée chaque nuit, sous le propriétaire de la base'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_schema_privilege(r, 'cron', 'usage')),
  0::bigint, 'Aucun rôle de l''API n''accède au planificateur'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select private.run_scheduled_purges() $$, '42501', null, 'Le rôle serveur n''a pas le droit d''exécuter la purge');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000003203","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select private.run_scheduled_purges() $$, '42501', null, 'Un utilisateur non plus');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Effet
-- ---------------------------------------------------------------------------
select is(
  (private.run_scheduled_purges() ->> 'unconfirmed_accounts')::integer >= 1, true,
  'La purge efface au moins le compte jamais confirmé de ce test'
);
select results_eq(
  $$ select email::text from auth.users where email like 'purge-%@test.invalid' order by email $$,
  $$ values ('purge-confirme@test.invalid'), ('purge-connecte@test.invalid'),
            ('purge-courriel@test.invalid'), ('purge-membre@test.invalid'),
            ('purge-recent@test.invalid'), ('purge-role@test.invalid'),
            ('purge-sso@test.invalid'), ('purge-suspendu@test.invalid'),
            ('purge-telephone@test.invalid') $$,
  'Seul le compte jamais confirmé, jamais connecté, sans rôle, ni organisation, ni suspension, ni courriel récent, et vieux de plus de sept jours est effacé'
);
select is(
  (select count(*) from public.profiles where user_id = 'a0000000-0000-0000-0000-000000003201'),
  0::bigint, 'Son profil part avec lui'
);
select results_eq(
  $$ select title from public.research_projects where owner_id = 'c0000000-0000-0000-0000-000000003203' order by title $$,
  $$ values ('Supprimé récemment'), ('Vivant') $$,
  'Seul le projet supprimé depuis plus de trente jours est effacé'
);
select is(
  (select count(*) from public.project_sources where project_id = '32000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Ses sources partent avec lui'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'account.deleted' and subject_user_id = 'a0000000-0000-0000-0000-000000003201'),
  0::bigint, 'Le compte purgé ne laisse pas de ligne à son identifiant dans le journal'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'retention.purged' and actor_id is null and occurred_at = now()
     and (metadata ->> 'unconfirmed_accounts')::integer >= 1
     and metadata::text not like '%test.invalid%'),
  1::bigint, 'Le passage est inscrit au journal : des nombres, aucun identifiant'
);

select results_eq(
  $$ select bucket_key from private.rate_limit_buckets where bucket_key like 'purge-test:%' $$,
  $$ values ('purge-test:recent') $$,
  'Les compteurs de débit de plus de deux jours sont effacés'
);

-- Un second passage n'a plus rien à effacer et n'écrit rien.
select is(
  private.run_scheduled_purges(), '{"deleted_projects": 0, "unconfirmed_accounts": 0}'::jsonb,
  'Un second passage n''efface rien'
);
select is(
  (select count(*) from public.audit_logs where action = 'retention.purged' and occurred_at = now()),
  1::bigint, 'Et n''ajoute pas de ligne au journal'
);

-- Hors purge, la suppression d'un compte reste inscrite au journal, même si
-- le marqueur de la purge a été posé puis levé dans la transaction.
delete from auth.users where id = 'b0000000-0000-0000-0000-000000003202';
select is(
  (select count(*) from public.audit_logs
   where action = 'account.deleted' and subject_user_id = 'b0000000-0000-0000-0000-000000003202'),
  1::bigint, 'Une suppression ordinaire reste inscrite au journal'
);

select * from finish();
rollback;
