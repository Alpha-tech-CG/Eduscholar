-- D-26 : historique des suspensions, tentatives refusées, attribution des suppressions.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
create function tests.login(p_user uuid, p_aal text default 'aal1', p_totp_age integer default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
      'amr', case when p_totp_age is null
        then jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
        else jsonb_build_array(
          jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - p_totp_age - 60),
          jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_totp_age))
      end
    )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- P : administrateur. P2 : second administrateur. U : utilisateur. M : modératrice.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('b0000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suivi-p@test.invalid', now()),
  ('b1000000-0000-0000-0000-000000006302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suivi-p2@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000006303', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suivi-u@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000006304', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suivi-m@test.invalid', now());
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select ('fa000000-0000-0000-0000-00000000' || right(id::text, 4))::uuid, id, 'test', 'totp', 'verified',
       now() - interval '1 day', now(), 'secret-de-test'
from auth.users where id::text like '%-00000000630_';
insert into public.platform_roles (user_id, role, granted_by) values
  ('b0000000-0000-0000-0000-000000006301', 'platform_admin', null),
  ('b1000000-0000-0000-0000-000000006302', 'platform_admin', null),
  ('c0000000-0000-0000-0000-000000006304', 'moderator', 'b0000000-0000-0000-0000-000000006301');

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'private.account_status_history', p)),
  0::bigint, 'L''historique ne se lit ni ne s''écrit directement'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname in ('admin_account_history', 'log_admin_refusal')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent ces fonctions'
);

-- ---------------------------------------------------------------------------
-- Historique des suspensions
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000006301', 'aal2', 30);
select is(
  (select count(*) from public.admin_account_history('d0000000-0000-0000-0000-000000006303')), 0::bigint,
  'Un compte jamais suspendu n''a pas d''historique'
);
select public.admin_set_account_status('d0000000-0000-0000-0000-000000006303', true, 'Premier motif.');
select public.admin_set_account_status('d0000000-0000-0000-0000-000000006303', false);
reset role;
select tests.login('b1000000-0000-0000-0000-000000006302', 'aal2', 30);
select public.admin_set_account_status('d0000000-0000-0000-0000-000000006303', true, 'Second motif.');
select results_eq(
  $$ select status, reason, changed_by_email from public.admin_account_history('d0000000-0000-0000-0000-000000006303') $$,
  $$ values ('suspended', 'Second motif.', 'suivi-p2@test.invalid'),
            ('active', null, 'suivi-p@test.invalid'),
            ('suspended', 'Premier motif.', 'suivi-p@test.invalid') $$,
  'Chaque décision est gardée, avec son motif et son auteur : rien ne s''écrase'
);
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'user.history_read'
     and subject_user_id = 'd0000000-0000-0000-0000-000000006303'),
  2::bigint, 'La lecture de l''historique est journalisée'
);
select tests.login('b0000000-0000-0000-0000-000000006301', 'aal2', 30);
select throws_ok(
  $$ select * from public.admin_account_history('99999999-0000-0000-0000-000000006399') $$,
  'P0001', 'not_found', 'L''historique d''un compte inexistant est refusé'
);
select results_eq(
  $$ select email from public.admin_list_accounts() where email like 'suivi-%' $$,
  $$ values ('suivi-m@test.invalid'), ('suivi-p@test.invalid'), ('suivi-p2@test.invalid'), ('suivi-u@test.invalid') $$,
  'La liste montre d''abord les détenteurs d''un rôle, puis les comptes suspendus'
);
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'user.history_read'
     and subject_user_id = '99999999-0000-0000-0000-000000006399'),
  0::bigint, 'Et n''écrit aucune ligne de lecture'
);
select is(
  (select count(*) from public.audit_logs
   where subject_user_id = 'd0000000-0000-0000-0000-000000006303' and metadata::text like '%motif%'),
  0::bigint, 'Le motif n''entre toujours pas au journal d''audit'
);

-- Qui ne peut pas le lire.
select tests.login('d0000000-0000-0000-0000-000000006303');
select throws_ok(
  $$ select * from public.admin_account_history('d0000000-0000-0000-0000-000000006303') $$, '42501', null,
  'Le titulaire ne lit pas l''historique de ses suspensions'
);
reset role;
select tests.login('c0000000-0000-0000-0000-000000006304', 'aal2', 30);
select throws_ok(
  $$ select * from public.admin_account_history('d0000000-0000-0000-0000-000000006303') $$, '42501', 'forbidden',
  'Une modératrice non plus'
);
reset role;
select tests.login('b0000000-0000-0000-0000-000000006301', 'aal2', 700);
select throws_ok(
  $$ select * from public.admin_account_history('d0000000-0000-0000-0000-000000006303') $$,
  '42501', 'recent_second_factor_required', 'Ni un administrateur dont le second facteur n''est plus récent'
);
reset role;

-- ---------------------------------------------------------------------------
-- Tentatives refusées
-- ---------------------------------------------------------------------------
delete from private.rate_limit_buckets where bucket_key like 'admin-refusal:%';
select tests.login('d0000000-0000-0000-0000-000000006303');
select lives_ok($$ select public.log_admin_refusal('set_role', 'forbidden') $$, 'Un refus se consigne sous la session de qui l''a essuyé');
select lives_ok($$ select public.log_admin_refusal('set_role', 'suivi-u@test.invalid') $$, 'Un motif hors liste est ignoré, sans erreur');
select lives_ok($$ select public.log_admin_refusal('n''importe quoi', 'forbidden') $$, 'Une opération hors liste aussi');
select lives_ok($$ select public.log_admin_refusal(null, null) $$, 'Des valeurs absentes aussi');
reset role;
select results_eq(
  $$ select actor_id, subject_user_id, target_type, target_id, metadata
     from public.audit_logs where action = 'admin.refused'
       and actor_id = 'd0000000-0000-0000-0000-000000006303' $$,
  $$ values ('d0000000-0000-0000-0000-000000006303'::uuid, null::uuid, 'operation', 'set_role', '{"code": "forbidden", "source": "app"}'::jsonb) $$,
  'Une seule ligne : qui, quelle opération, quel refus, et d''où vient la trace — pas la cible, rien de libre'
);
-- Sans rôle d'administration, on ne déclare pas un refus que l'on n'a pas pu essuyer.
select tests.login('d0000000-0000-0000-0000-000000006303');
select public.log_admin_refusal('set_account_status', 'own_account');
select public.log_admin_refusal('set_role', 'second_factor_missing');
select public.log_admin_refusal('set_role', 'recent_second_factor_required');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'admin.refused'
     and actor_id = 'd0000000-0000-0000-0000-000000006303'),
  1::bigint, 'Un compte sans rôle ne se donne pas l''air d''avoir franchi le contrôle d''administration'
);
-- Cinq par heure pour un compte sans rôle ; le dépassement laisse une ligne, une seule.
select tests.login('d0000000-0000-0000-0000-000000006303');
select public.log_admin_refusal('find_user', 'forbidden') from generate_series(1, 20);
select lives_ok($$ select public.log_admin_refusal('find_user', 'forbidden') $$, 'Au-delà du plafond, l''appel ne lève rien');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'admin.refused'
     and actor_id = 'd0000000-0000-0000-0000-000000006303'),
  5::bigint, 'Cinq refus consignés par heure pour un compte sans rôle'
);
select is(
  (select count(*) from public.audit_logs where action = 'admin.refusal_overflow'
     and actor_id = 'd0000000-0000-0000-0000-000000006303'),
  1::bigint, 'Le dépassement laisse une ligne, une seule : le silence qui suit se voit'
);
-- Un administrateur déclare les refus qui lui sont propres, jusqu'à trente par heure.
select tests.login('b0000000-0000-0000-0000-000000006301', 'aal2', 30);
select public.log_admin_refusal('set_account_status', 'own_account');
select public.log_admin_refusal('set_role', 'forbidden') from generate_series(1, 40);
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'admin.refused'
     and actor_id = 'b0000000-0000-0000-0000-000000006301'),
  30::bigint, 'Trente pour un administrateur, dont le refus d''agir sur son propre compte'
);
select is(
  (select count(*) from public.audit_logs where action = 'admin.refused'
     and actor_id = 'b0000000-0000-0000-0000-000000006301' and metadata ->> 'code' = 'own_account'),
  1::bigint, 'Son motif propre est gardé'
);
-- Plafond de la plateforme : cinq cents par heure, tous comptes confondus.
insert into public.audit_logs (category, action, metadata)
select 'platform', 'admin.refused', '{"source": "test"}'::jsonb from generate_series(1, 500);
delete from private.rate_limit_buckets where bucket_key like 'admin-refusal%';
select tests.login('b1000000-0000-0000-0000-000000006302', 'aal2', 30);
select public.log_admin_refusal('set_role', 'forbidden');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'admin.refused'
     and actor_id = 'b1000000-0000-0000-0000-000000006302'),
  0::bigint, 'Au-delà du plafond de la plateforme, plus rien ne s''ajoute'
);
-- Sans session : rien.
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
select set_config('role', 'authenticated', true);
select lives_ok($$ select public.log_admin_refusal('set_role', 'forbidden') $$, 'Sans identité, l''appel ne fait rien');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'admin.refused' and actor_id is null
     and metadata ->> 'source' = 'app'),
  0::bigint, 'Aucun refus sans auteur'
);

-- ---------------------------------------------------------------------------
-- Suppression en cascade : l'auteur n'est pas celui qui avait accordé le rôle
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = 'c0000000-0000-0000-0000-000000006304' $$, 'La modératrice supprime son compte');
select is(
  (select actor_id from public.audit_logs
   where action = 'platform_roles.delete' and subject_user_id = 'c0000000-0000-0000-0000-000000006304'),
  null::uuid, 'Le retrait de son rôle n''est pas attribué à l''administrateur qui l''avait accordé'
);

-- L'auteur d'une décision supprime son compte : l'historique reste, sans son identifiant.
select lives_ok($$ delete from auth.users where id = 'b1000000-0000-0000-0000-000000006302' $$, 'Le second administrateur supprime son compte');
select is(
  (select count(*) from private.account_status_history
   where user_id = 'd0000000-0000-0000-0000-000000006303' and changed_by is null and reason = 'Second motif.'),
  1::bigint, 'Sa décision reste, sans son identifiant'
);
-- Le compte concerné est supprimé : son historique part avec lui.
select lives_ok($$ delete from auth.users where id = 'd0000000-0000-0000-0000-000000006303' $$, 'Le compte suspendu est supprimé');
select is(
  (select count(*) from private.account_status_history where user_id = 'd0000000-0000-0000-0000-000000006303'),
  0::bigint, 'Son historique part avec lui'
);

select * from finish();
rollback;
