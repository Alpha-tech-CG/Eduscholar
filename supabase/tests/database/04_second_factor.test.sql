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
select throws_ok($$ select public.reference_data() $$, '42501', 'forbidden', 'Il ne lit pas les référentiels en aal1');
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
select throws_ok(
  $$ select private.hook_mfa_verification_attempt('{}'::jsonb) $$,
  '42501', null, 'Un utilisateur n''appelle pas le hook de vérification'
);
select throws_ok(
  'select * from private.second_factor_attempts', '42501', null,
  'Un utilisateur ne lit pas les compteurs d''essais'
);
select ok(not public.must_keep_second_factor(), 'Un compte sans rôle peut désactiver son second facteur');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.second_factor_status()', '42501', null, 'Un visiteur n''interroge pas l''état du second facteur');
reset role;

-- ---------------------------------------------------------------------------
-- Hook de vérification : essais bornés par facteur, rejeu refusé
-- ---------------------------------------------------------------------------
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fa000000-0000-0000-0000-0000000000f1", "valid": true}') ->> 'decision',
  'continue', 'Un code juste est accepté'
);
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fa000000-0000-0000-0000-0000000000f1", "valid": true}') ->> 'message',
  'code_already_used', 'Le même pas de trente secondes ne sert qu''une fois'
);
-- Le service accepte aussi le code des pas voisins : aucun second succès tant
-- que le premier code peut encore être reçu.
update private.second_factor_attempts set last_success_at = now() - interval '45 seconds'
  where factor_id = 'fa000000-0000-0000-0000-0000000000f1';
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fa000000-0000-0000-0000-0000000000f1", "valid": true}') ->> 'message',
  'code_already_used', 'Un second succès trois quarts de minute plus tard est encore refusé'
);
select is(
  (select last_success_at < now() - interval '40 seconds' from private.second_factor_attempts
   where factor_id = 'fa000000-0000-0000-0000-0000000000f1'),
  true, 'Un refus ne prolonge pas l''attente'
);
update private.second_factor_attempts set last_success_at = now() - interval '120 seconds'
  where factor_id = 'fa000000-0000-0000-0000-0000000000f1';
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fa000000-0000-0000-0000-0000000000f1", "valid": true}') ->> 'decision',
  'continue', 'Deux minutes plus tard, un nouveau code est accepté'
);

-- Bornes exactes : refusé pendant tout le deuxième pas suivant, accepté au troisième.
update private.second_factor_attempts
  set last_success_at = to_timestamp((floor(extract(epoch from now()) / 30) - 2) * 30 + 29)
  where factor_id = 'fa000000-0000-0000-0000-0000000000f1';
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fa000000-0000-0000-0000-0000000000f1", "valid": true}') ->> 'message',
  'code_already_used', 'Au deuxième pas suivant, le code du premier vaut encore : refus'
);
update private.second_factor_attempts
  set last_success_at = to_timestamp((floor(extract(epoch from now()) / 30) - 3) * 30 + 29)
  where factor_id = 'fa000000-0000-0000-0000-0000000000f1';
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fa000000-0000-0000-0000-0000000000f1", "valid": true}') ->> 'decision',
  'continue', 'Au troisième, il ne vaut plus : un nouveau code est accepté'
);

-- L'attente restante, lue par le titulaire seulement.
select set_config('request.jwt.claims',
  (select jsonb_build_object('sub', f.user_id, 'role', 'authenticated', 'aal', 'aal1')::text
   from auth.mfa_factors f where f.id = 'fa000000-0000-0000-0000-0000000000f1'), true);
set local role authenticated;
select cmp_ok(public.second_factor_wait_seconds(), '>', 60, 'Juste après un succès, plus d''une minute d''attente est annoncée');
select cmp_ok(public.second_factor_wait_seconds(), '<=', 90, 'Et une minute et demie au plus');
reset role;
update private.second_factor_attempts set last_success_at = now() - interval '120 seconds'
  where factor_id = 'fa000000-0000-0000-0000-0000000000f1';
set local role authenticated;
select is(public.second_factor_wait_seconds(), 0, 'Passé ce délai, aucune attente');
reset role;
update private.second_factor_attempts set last_success_at = now()
  where factor_id = 'fa000000-0000-0000-0000-0000000000f1';
select set_config('request.jwt.claims',
  (select jsonb_build_object('sub', f.user_id, 'role', 'authenticated', 'aal', 'aal1')::text
   from auth.mfa_factors f where f.id = 'fb000000-0000-0000-0000-0000000000f2'), true);
set local role authenticated;
select is(public.second_factor_wait_seconds(), 0, 'L''attente d''un compte ne se lit pas depuis un autre');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*) from unnest(array['anon', 'service_role']) r
   where has_function_privilege(r, 'public.second_factor_wait_seconds()', 'execute')),
  0::bigint, 'Ni le visiteur ni le rôle serveur ne lisent cette attente'
);
select is(
  (select count(*) from generate_series(1, 10) as n
   where private.hook_mfa_verification_attempt('{"factor_id": "fb000000-0000-0000-0000-0000000000f2", "valid": false}') ->> 'decision' = 'continue'),
  10::bigint, 'Dix codes faux sont traités'
);
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fb000000-0000-0000-0000-0000000000f2", "valid": true}') ->> 'message',
  'too_many_attempts', 'Au-delà, même un code juste est refusé'
);
update private.second_factor_attempts set window_start = now() - interval '16 minutes'
  where factor_id = 'fb000000-0000-0000-0000-0000000000f2';
select is(
  private.hook_mfa_verification_attempt('{"factor_id": "fb000000-0000-0000-0000-0000000000f2", "valid": true}') ->> 'decision',
  'continue', 'Le blocage se lève à la fin de la fenêtre'
);

select * from finish();
rollback;
