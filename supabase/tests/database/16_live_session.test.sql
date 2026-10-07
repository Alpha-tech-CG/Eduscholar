-- Session fermée : le jeton encore valable ne vaut plus rien en base (D-19).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
create function tests.claims(p_user uuid, p_session text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)
      || case when p_session is null then '{}'::jsonb else jsonb_build_object('session_id', p_session) end)::text,
    true);
  perform set_config('role', 'authenticated', true);
end $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- A : profil complété, deux projets. B : un autre compte. C : second facteur et rôle.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000003601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'session-a@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000003602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'session-b@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000003603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'session-c@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000360_';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000003603', 'c0000000-0000-0000-0000-000000003603', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('c0000000-0000-0000-0000-000000003603', 'moderator');
insert into auth.sessions (id, user_id, not_after) values
  ('5e000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-000000003601', null),
  ('5e000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-000000003601', now() + interval '1 hour'),
  ('5e000000-0000-0000-0000-00000000a003', 'a0000000-0000-0000-0000-000000003601', now() - interval '1 minute'),
  ('5e000000-0000-0000-0000-00000000b001', 'b0000000-0000-0000-0000-000000003602', null),
  ('5e000000-0000-0000-0000-00000000c001', 'c0000000-0000-0000-0000-000000003603', null);
insert into public.research_projects (id, owner_id, title) values
  ('36000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000003601', 'Projet de A'),
  ('36000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000003601', 'Second projet de A');

-- Session vivante : lecture et écriture.
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000a001');
select is((select count(*) from public.research_projects), 2::bigint, 'Une session vivante lit ses projets');
select is((select count(*) from public.profiles), 1::bigint, 'Et son profil');
select lives_ok(
  $$ select public.delete_project('36000000-0000-0000-0000-0000000000a2') $$,
  'Et écrit'
);
reset role;

-- La session d'un autre compte ne vaut pas pour celui-ci.
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000b001');
select is((select count(*) from public.research_projects), 0::bigint, 'La session d''un autre compte ne donne rien');
reset role;

-- Identifiant de session mal formé, inconnu, ou session arrivée à son terme.
select tests.claims('a0000000-0000-0000-0000-000000003601', 'pas-un-identifiant');
select is((select count(*) from public.research_projects), 0::bigint, 'Un identifiant de session mal formé ne donne rien');
reset role;
select tests.claims('a0000000-0000-0000-0000-000000003601', '5E000000-0000-0000-0000-00000000A001');
select is((select count(*) from public.research_projects), 0::bigint, 'Ni le même identifiant écrit autrement');
reset role;
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000ffff');
select is((select count(*) from public.research_projects), 0::bigint, 'Une session inconnue ne donne rien');
reset role;
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000a003');
select is((select count(*) from public.research_projects), 0::bigint, 'Une session arrivée à son terme ne donne rien');
reset role;
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000a002');
select is((select count(*) from public.research_projects), 1::bigint, 'Une session dont le terme est à venir reste valable');
reset role;

-- La session est fermée : son jeton ne lit ni n'écrit plus.
delete from auth.sessions where id = '5e000000-0000-0000-0000-00000000a001';
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000a001');
select is((select count(*) from public.research_projects), 0::bigint, 'Une session fermée ne lit plus ses projets');
select is((select count(*) from public.profiles), 0::bigint, 'Ni son profil');
select throws_ok(
  $$ select public.delete_project('36000000-0000-0000-0000-0000000000a1') $$,
  '42501', 'forbidden', 'Ni n''écrit, alors que la même écriture passait session ouverte'
);
reset role;
select is(
  (select deleted_at is null from public.research_projects where id = '36000000-0000-0000-0000-0000000000a1'),
  true, 'Le projet est intact'
);

-- L'autre session du même compte reste valable.
select tests.claims('a0000000-0000-0000-0000-000000003601', '5e000000-0000-0000-0000-00000000a002');
select is((select count(*) from public.research_projects), 1::bigint, 'Une autre session du compte reste valable');
reset role;

-- Compte à second facteur et à rôle, session ouverte par le seul mot de passe.
select tests.claims('c0000000-0000-0000-0000-000000003603', '5e000000-0000-0000-0000-00000000c001');
select is(public.must_keep_second_factor(), true, 'Session ouverte : le compte apprend qu''il doit garder son second facteur');
select is(
  public.redeem_recovery_code('AAAA-BBBB-CCCC-DDDD'), false,
  'Session ouverte : un code de secours erroné est examiné, et refusé comme tel'
);
reset role;
select is(
  (select failures from private.recovery_code_attempts where user_id = 'c0000000-0000-0000-0000-000000003603'),
  1, 'L''essai est compté'
);
delete from auth.sessions where id = '5e000000-0000-0000-0000-00000000c001';
select tests.claims('c0000000-0000-0000-0000-000000003603', '5e000000-0000-0000-0000-00000000c001');
select is(public.must_keep_second_factor(), false, 'Session fermée : plus de réponse sur les rôles du compte');
select throws_ok(
  $$ select public.redeem_recovery_code('AAAA-BBBB-CCCC-DDDD') $$,
  '42501', 'forbidden', 'Session fermée : un code de secours n''est plus examiné'
);
reset role;
select is(
  (select failures from private.recovery_code_attempts where user_id = 'c0000000-0000-0000-0000-000000003603'),
  1, 'Et l''essai n''est pas compté'
);

-- Ses propres signalements suivent la règle entière du compte actif.
select is(
  (select count(*) from pg_proc p
   where p.oid = 'private.my_report_ids()'::regprocedure and p.prosrc like '%private.is_account_active()%'),
  1::bigint, 'my_report_ids exige un compte actif, donc une session ouverte'
);

-- Hypothèse écrite : un jeton sans identifiant de session n'est pas refusé par
-- ce contrôle. Le service d'authentification n'en émet pas pour un utilisateur ;
-- à revoir avant d'accepter les jetons d'un autre émetteur.
select tests.claims('a0000000-0000-0000-0000-000000003601', null);
select is((select count(*) from public.research_projects), 1::bigint, 'Un jeton sans identifiant de session n''est pas refusé par ce contrôle');
reset role;

-- Suspension : les sessions du compte sont fermées dans la même transaction.
insert into auth.sessions (id, user_id) values
  ('5e000000-0000-0000-0000-00000000b002', 'b0000000-0000-0000-0000-000000003602');
insert into auth.refresh_tokens (token, user_id, session_id) values
  ('jeton-de-test-3602', 'b0000000-0000-0000-0000-000000003602', '5e000000-0000-0000-0000-00000000b002');
insert into private.account_status (user_id, status, reason, changed_by)
values ('b0000000-0000-0000-0000-000000003602', 'suspended', 'Test', 'c0000000-0000-0000-0000-000000003603');
select is(
  (select count(*) from auth.sessions where user_id = 'b0000000-0000-0000-0000-000000003602'),
  0::bigint, 'La suspension ferme toutes les sessions du compte'
);
select is(
  (select count(*) from auth.refresh_tokens where token = 'jeton-de-test-3602'),
  0::bigint, 'Et leurs jetons de rafraîchissement'
);
select is(
  (select count(*) from auth.sessions where user_id = 'a0000000-0000-0000-0000-000000003601'),
  2::bigint, 'Sans toucher aux sessions des autres comptes'
);
-- Suspendu, le compte n'ouvre plus de session — y compris sous le rôle du
-- service d'authentification, qui est celui qui les crée.
select throws_ok(
  $$ insert into auth.sessions (id, user_id) values ('5e000000-0000-0000-0000-00000000b009', 'b0000000-0000-0000-0000-000000003602') $$,
  '42501', 'account_suspended', 'Un compte suspendu n''ouvre plus de session'
);
select is(
  has_function_privilege('supabase_auth_admin', 'private.refuse_session_when_suspended()', 'execute'),
  true, 'Le service d''authentification, qui crée les sessions, exécute ce contrôle'
);
select lives_ok(
  $$ insert into auth.sessions (id, user_id) values ('5e000000-0000-0000-0000-00000000a009', 'a0000000-0000-0000-0000-000000003601') $$,
  'Les sessions des autres comptes s''ouvrent toujours'
);
delete from auth.sessions where id = '5e000000-0000-0000-0000-00000000a009';

-- Rétablir ne ferme rien ; suspendre à nouveau ferme la session ouverte entre-temps.
update private.account_status set status = 'active', changed_by = 'c0000000-0000-0000-0000-000000003603'
  where user_id = 'b0000000-0000-0000-0000-000000003602';
insert into auth.sessions (id, user_id) values
  ('5e000000-0000-0000-0000-00000000b003', 'b0000000-0000-0000-0000-000000003602');
update private.account_status set reason = 'Motif précisé', changed_by = 'c0000000-0000-0000-0000-000000003603'
  where user_id = 'b0000000-0000-0000-0000-000000003602';
select is(
  (select count(*) from auth.sessions where user_id = 'b0000000-0000-0000-0000-000000003602'),
  1::bigint, 'Un compte rétabli garde la session qu''il rouvre'
);
update private.account_status set status = 'suspended', changed_by = 'c0000000-0000-0000-0000-000000003603'
  where user_id = 'b0000000-0000-0000-0000-000000003602';
select is(
  (select count(*) from auth.sessions where user_id = 'b0000000-0000-0000-0000-000000003602'),
  0::bigint, 'Une nouvelle suspension la ferme'
);

-- Le contrôle n'est exécutable par aucun rôle de l'API.
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, 'private.is_session_live()', 'execute')),
  0::bigint, 'Aucun rôle de l''API n''appelle le contrôle directement'
);

select * from finish();
rollback;
