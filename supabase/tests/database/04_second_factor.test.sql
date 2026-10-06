-- Second facteur imposé en base (modèle de menaces M-48).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'facteur-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'facteur-b@test.invalid'),
  ('c0000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'facteur-c@test.invalid');

-- A a un facteur vérifié ; B a commencé une activation sans la terminer ; C n'a rien.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fb000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-0000000000f2', 'test', 'totp', 'unverified', now(), now(), 'secret-de-test');

-- Compte avec second facteur, session ouverte par le seul mot de passe.
select tests.login('a0000000-0000-0000-0000-0000000000f1', 'aal1');
select ok(not private.is_account_active(), 'Avec un second facteur activé, une session aal1 n''a aucun droit');
select is_empty($$ select 1 from public.profiles $$, 'Il ne lit pas son profil en aal1');
select is_empty($$ select 1 from public.countries $$, 'Il ne lit pas les référentiels en aal1');
update public.profiles set preferred_locale = 'en'
  where user_id = 'a0000000-0000-0000-0000-0000000000f1';
select is(public.account_deletion_check(), 'forbidden', 'Il ne peut pas demander la suppression de son compte en aal1');
select results_eq(
  $$ select has_verified_factor, session_verified from public.second_factor_status() $$,
  $$ values (true, false) $$,
  'L''application peut savoir qu''un code est attendu'
);
reset role;

select is(
  (select preferred_locale from public.profiles where user_id = 'a0000000-0000-0000-0000-0000000000f1'),
  'fr', 'Rien n''a été modifié en aal1'
);

-- Même compte, second facteur vérifié.
select tests.login('a0000000-0000-0000-0000-0000000000f1', 'aal2');
select ok(private.is_account_active(), 'Avec le second facteur vérifié, le compte retrouve ses droits');
select is((select count(*) from public.profiles), 1::bigint, 'Il lit son profil en aal2');
select results_eq(
  $$ select has_verified_factor, session_verified from public.second_factor_status() $$,
  $$ values (true, true) $$,
  'L''état reflète la vérification'
);
reset role;

-- Activation non terminée : elle ne verrouille pas le compte.
select tests.login('b0000000-0000-0000-0000-0000000000f2', 'aal1');
select ok(private.is_account_active(), 'Un facteur non vérifié ne change rien');
select results_eq(
  $$ select has_verified_factor, session_verified from public.second_factor_status() $$,
  $$ values (false, false) $$,
  'Un facteur non vérifié ne compte pas'
);
reset role;

-- Compte sans second facteur : inchangé.
select tests.login('c0000000-0000-0000-0000-0000000000f3', 'aal1');
select ok(private.is_account_active(), 'Sans second facteur, une session aal1 suffit');
reset role;

-- Le facteur d'un autre ne se lit pas.
select tests.login('c0000000-0000-0000-0000-0000000000f3', 'aal1');
select throws_ok('select * from auth.mfa_factors', '42501', null, 'Un utilisateur ne lit pas la table des facteurs');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.second_factor_status()', '42501', null, 'Un visiteur n''interroge pas l''état du second facteur');
reset role;

select * from finish();
rollback;
