-- Administration des rôles et des comptes (D-01, D-02, D-16).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Session d'un utilisateur. `p_totp_age` : ancienneté, en secondes, de la
-- dernière présentation du second facteur ; null : jamais présenté.
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
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Acteurs : S super-administratrice ; P administrateur ; P2 second administrateur ;
-- M modératrice ; U utilisateur avec second facteur ; V utilisateur sans ; W suspendue.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000002801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-s@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000002802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-p@test.invalid', now()),
  ('b1000000-0000-0000-0000-000000002803', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-p2@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000002804', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-m@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000002805', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Adm-U@test.invalid', now()),
  ('e0000000-0000-0000-0000-000000002806', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-v@test.invalid', now()),
  ('f0000000-0000-0000-0000-000000002807', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-w@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000280_';

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select ('fa000000-0000-0000-0000-00000000' || right(id::text, 4))::uuid, id, 'test', 'totp', 'verified',
       now() - interval '1 day', now(), 'secret-de-test'
from auth.users
where id::text like '%-00000000280_' and email not in ('adm-v@test.invalid');

insert into public.platform_roles (user_id, role) values
  ('a0000000-0000-0000-0000-000000002801', 'super_admin'),
  ('b0000000-0000-0000-0000-000000002802', 'platform_admin'),
  ('b1000000-0000-0000-0000-000000002803', 'platform_admin'),
  ('c0000000-0000-0000-0000-000000002804', 'moderator');
insert into private.account_status (user_id, status, reason)
values ('f0000000-0000-0000-0000-000000002807', 'suspended', 'Test');

-- ---------------------------------------------------------------------------
-- Qui peut administrer
-- ---------------------------------------------------------------------------
select tests.login('d0000000-0000-0000-0000-000000002805', 'aal2', 10);
select results_eq($$ select role_rank, recent from public.admin_session() $$, $$ values (0, true) $$, 'Un utilisateur n''a aucun rang d''administration');
select throws_ok($$ select * from private.admin_find_user('adm-m@test.invalid') $$, '42501', 'forbidden', 'Un utilisateur ne cherche pas de compte');
select throws_ok($$ select * from private.admin_list_accounts() $$, '42501', 'forbidden', 'Ni ne liste les comptes');
select throws_ok(
  $$ select private.admin_set_role('e0000000-0000-0000-0000-000000002806', 'moderator', true) $$,
  '42501', 'forbidden', 'Ni n''attribue de rôle'
);
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'platform_admin', true) $$,
  '42501', 'forbidden', 'Ni ne s''en attribue un'
);
select throws_ok(
  $$ select private.admin_set_account_status('e0000000-0000-0000-0000-000000002806', true, 'Abus') $$,
  '42501', 'forbidden', 'Ni ne suspend de compte'
);
reset role;

select tests.login('c0000000-0000-0000-0000-000000002804', 'aal2', 10);
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$,
  '42501', 'forbidden', 'Une modératrice n''attribue pas de rôle'
);
select throws_ok($$ select * from private.admin_find_user('adm-u@test.invalid') $$, '42501', 'forbidden', 'Ni ne cherche de compte');
reset role;

-- Administrateur sans second facteur présenté, ou présenté il y a trop longtemps.
select tests.login('b0000000-0000-0000-0000-000000002802', 'aal1');
select results_eq($$ select role_rank, recent from public.admin_session() $$, $$ values (0, false) $$, 'En aal1, un administrateur n''a aucun rang');
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$,
  '42501', 'forbidden', 'Ni aucun pouvoir'
);
reset role;

select tests.login('b0000000-0000-0000-0000-000000002802', 'aal2', 700);
select results_eq($$ select role_rank, recent from public.admin_session() $$, $$ values (2, false) $$, 'Second facteur présenté il y a plus de dix minutes : rang reconnu, session non récente');
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$,
  '42501', 'recent_second_factor_required', 'L''attribution exige un second facteur récent'
);
select throws_ok(
  $$ select * from private.admin_find_user('adm-u@test.invalid') $$,
  '42501', 'recent_second_factor_required', 'La recherche aussi'
);
select throws_ok(
  $$ select private.admin_set_account_status('d0000000-0000-0000-0000-000000002805', true, 'Abus') $$,
  '42501', 'recent_second_factor_required', 'La suspension aussi'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select * from public.admin_session() $$, '42501', null, 'Un visiteur n''appelle aucune fonction d''administration');
select throws_ok($$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$, '42501', null, 'Ni n''attribue de rôle');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$, '42501', null, 'Le rôle serveur n''attribue pas de rôle par les fonctions');
select throws_ok($$ select * from private.admin_find_user('adm-u@test.invalid') $$, '42501', null, 'Ni ne cherche de compte');
reset role;

select is(
  (select count(*) from public.platform_roles where user_id::text like '%-00000000280_'), 4::bigint,
  'Aucun rôle n''a été créé par ces tentatives'
);

-- ---------------------------------------------------------------------------
-- Administrateur de plateforme, second facteur récent
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000002802', 'aal2', 30);
select results_eq($$ select role_rank, recent from public.admin_session() $$, $$ values (2, true) $$, 'Administrateur à la session récente');

select results_eq(
  $$ select user_id, email, confirmed, roles, suspended, has_second_factor from public.admin_find_user('  ADM-U@Test.invalid ') $$,
  $$ values ('d0000000-0000-0000-0000-000000002805'::uuid, 'Adm-U@test.invalid', true, '{}'::text[], false, true) $$,
  'Il trouve un compte par son adresse exacte, sans égard à la casse'
);
select is_empty($$ select * from public.admin_find_user('inconnu@test.invalid') $$, 'Une adresse inconnue ne rend rien');
select is_empty($$ select * from public.admin_find_user('adm-%@test.invalid') $$, 'Pas de recherche par motif');
select throws_ok($$ select * from public.admin_find_user('') $$, '22023', 'invalid_payload', 'Une adresse vide est refusée');

select lives_ok(
  $$ select public.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$,
  'Il attribue le rôle de modération à un compte doté d''un second facteur'
);
select lives_ok(
  $$ select public.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$,
  'Le refaire est sans effet'
);
select throws_ok(
  $$ select private.admin_set_role('e0000000-0000-0000-0000-000000002806', 'moderator', true) $$,
  '42501', 'second_factor_missing', 'Pas de rôle pour un compte sans second facteur'
);
select throws_ok(
  $$ select private.admin_set_role('f0000000-0000-0000-0000-000000002807', 'moderator', true) $$,
  '42501', 'account_suspended', 'Ni pour un compte suspendu'
);
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'platform_admin', true) $$,
  '42501', 'forbidden', 'Un administrateur n''attribue pas le rôle d''administrateur'
);
select throws_ok(
  $$ select private.admin_set_role('b1000000-0000-0000-0000-000000002803', 'platform_admin', false) $$,
  '42501', 'forbidden', 'Ni ne le retire à un pair'
);
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'super_admin', true) $$,
  '42501', 'forbidden', 'Le rôle de super-administrateur ne s''attribue pas par l''application'
);
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'owner', true) $$,
  '42501', 'forbidden', 'Un rôle inconnu est refusé'
);
select throws_ok(
  $$ select private.admin_set_role('b0000000-0000-0000-0000-000000002802', 'moderator', true) $$,
  '42501', 'own_account', 'Personne ne modifie ses propres rôles'
);
select throws_ok(
  $$ select public.admin_set_role('99999999-0000-0000-0000-000000000000', 'moderator', true) $$,
  null, 'not_found', 'Un compte inexistant est introuvable'
);

-- Suspension.
select throws_ok(
  $$ select public.admin_set_account_status('e0000000-0000-0000-0000-000000002806', true, '  ') $$,
  '22023', 'reason_required', 'Une suspension exige un motif'
);
select lives_ok(
  $$ select public.admin_set_account_status('e0000000-0000-0000-0000-000000002806', true, 'Abus répétés') $$,
  'Il suspend un compte sans rôle'
);
select lives_ok(
  $$ select public.admin_set_account_status('c0000000-0000-0000-0000-000000002804', true, 'Enquête') $$,
  'Il suspend une modératrice'
);
select throws_ok(
  $$ select private.admin_set_account_status('b1000000-0000-0000-0000-000000002803', true, 'Rivalité') $$,
  '42501', 'forbidden', 'Il ne suspend pas un autre administrateur'
);
select throws_ok(
  $$ select private.admin_set_account_status('a0000000-0000-0000-0000-000000002801', true, 'Coup de force') $$,
  '42501', 'forbidden', 'Ni la super-administratrice'
);
select throws_ok(
  $$ select private.admin_set_account_status('b0000000-0000-0000-0000-000000002802', true, 'Moi-même') $$,
  '42501', 'own_account', 'Personne ne se suspend soi-même'
);
-- Pas d'opération sans trace : le motif et l'auteur d'origine ne s'écrasent pas.
select throws_ok(
  $$ select public.admin_set_account_status('e0000000-0000-0000-0000-000000002806', true, 'Autre motif') $$,
  '22023', 'invalid_transition', 'Suspendre un compte déjà suspendu est refusé'
);
select throws_ok(
  $$ select public.admin_set_account_status('d0000000-0000-0000-0000-000000002805', false) $$,
  '22023', 'invalid_transition', 'Rétablir un compte actif est refusé'
);
-- Retrait d'un rôle : seulement à un compte de rang strictement inférieur.
select throws_ok(
  $$ select private.admin_set_role('b1000000-0000-0000-0000-000000002803', 'moderator', false) $$,
  '42501', 'forbidden', 'Il ne retire aucun rôle à un pair'
);
select throws_ok(
  $$ select private.admin_set_role('a0000000-0000-0000-0000-000000002801', 'moderator', false) $$,
  '42501', 'forbidden', 'Ni à la super-administratrice'
);

select results_eq(
  $$ select email, roles, suspended, suspension_reason from public.admin_list_accounts()
     where email like 'adm-%' or email like 'Adm-%' order by lower(email) $$,
  $$ values ('adm-m@test.invalid', array['moderator'], true, 'Enquête'),
            ('adm-p@test.invalid', array['platform_admin'], false, null::text),
            ('adm-p2@test.invalid', array['platform_admin'], false, null::text),
            ('adm-s@test.invalid', array['super_admin'], false, null::text),
            ('Adm-U@test.invalid', array['moderator'], false, null::text),
            ('adm-v@test.invalid', '{}'::text[], true, 'Abus répétés'),
            ('adm-w@test.invalid', '{}'::text[], true, 'Test') $$,
  'La liste montre les comptes à rôle et les comptes suspendus, et eux seuls'
);
reset role;

-- Effets : la modératrice suspendue n'a plus aucun droit ; le compte suspendu ne lit plus rien.
select tests.login('c0000000-0000-0000-0000-000000002804', 'aal2', 10);
select ok(not private.has_platform_role(array['moderator']), 'Une modératrice suspendue perd ses droits aussitôt');
reset role;
select tests.login('e0000000-0000-0000-0000-000000002806');
select is_empty($$ select 1 from public.profiles $$, 'Un compte suspendu ne lit plus son profil');
reset role;

-- La nouvelle modératrice a ses droits, son second facteur étant antérieur au rôle.
select tests.login('d0000000-0000-0000-0000-000000002805', 'aal2', 10);
select ok(private.has_platform_role(array['moderator']), 'Le rôle attribué est effectif');
reset role;

-- Journal : chaque opération y figure, avec son auteur.
select results_eq(
  $$ select action, count(*) from public.audit_logs
     where actor_id = 'b0000000-0000-0000-0000-000000002802' group by action order by action $$,
  $$ values ('account_status.insert', 2::bigint), ('platform_roles.insert', 1::bigint), ('user.lookup', 3::bigint) $$,
  'Attributions, suspensions et recherches sont journalisées au nom de l''administrateur'
);
select is(
  (select reason from private.account_status where user_id = 'e0000000-0000-0000-0000-000000002806'),
  'Abus répétés', 'Le motif d''origine est intact'
);

-- La cible ne lit pas, dans le journal, les opérations d'administration la concernant.
select tests.login('d0000000-0000-0000-0000-000000002805', 'aal2', 10);
select is_empty(
  $$ select 1 from public.audit_logs where action in ('user.lookup', 'platform_roles.insert')
       and subject_user_id = 'd0000000-0000-0000-0000-000000002805' $$,
  'La personne visée ne lit ni la recherche ni l''attribution, qui portent l''identifiant de l''administrateur'
);
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'user.lookup' and metadata::text like '%test.invalid%'),
  0::bigint, 'Le journal des recherches ne contient pas l''adresse cherchée'
);

-- ---------------------------------------------------------------------------
-- Super-administratrice
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000002801', 'aal2', 30);
select results_eq($$ select role_rank, recent from public.admin_session() $$, $$ values (3, true) $$, 'Super-administratrice à la session récente');
select lives_ok(
  $$ select public.admin_set_role('d0000000-0000-0000-0000-000000002805', 'platform_admin', true) $$,
  'Elle attribue le rôle d''administrateur'
);
select lives_ok(
  $$ select public.admin_set_account_status('b1000000-0000-0000-0000-000000002803', true, 'Départ') $$,
  'Elle suspend un administrateur'
);
select lives_ok(
  $$ select public.admin_set_role('b1000000-0000-0000-0000-000000002803', 'platform_admin', false) $$,
  'Et lui retire son rôle'
);
select lives_ok(
  $$ select public.admin_set_account_status('e0000000-0000-0000-0000-000000002806', false) $$,
  'Elle rétablit un compte suspendu'
);
-- Elle suspend à son tour un utilisateur : un rang inférieur ne lèvera pas cette suspension.
select lives_ok(
  $$ select public.admin_set_account_status('e0000000-0000-0000-0000-000000002806', true, 'Décision de la direction') $$,
  'Elle suspend un compte'
);
-- Réattribuer un rôle le renouvelle.
select lives_ok(
  $$ select public.admin_set_role('d0000000-0000-0000-0000-000000002805', 'moderator', true) $$,
  'Elle réattribue un rôle déjà détenu'
);
reset role;
select is(
  (select granted_by from public.platform_roles
   where user_id = 'd0000000-0000-0000-0000-000000002805' and role = 'moderator'),
  'a0000000-0000-0000-0000-000000002801'::uuid, 'L''auteur et la date de l''attribution sont renouvelés'
);
select tests.login('a0000000-0000-0000-0000-000000002801', 'aal2', 30);
-- Retrait d'un rôle à un compte de rang inférieur : permis et journalisé.
select lives_ok(
  $$ select public.admin_set_role('c0000000-0000-0000-0000-000000002804', 'moderator', false) $$,
  'Elle retire son rôle à la modératrice'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'platform_roles.delete' and actor_id = 'a0000000-0000-0000-0000-000000002801'
     and subject_user_id = 'c0000000-0000-0000-0000-000000002804'),
  1::bigint, 'Le retrait est journalisé à son nom'
);
select throws_ok(
  $$ select private.admin_set_role('a0000000-0000-0000-0000-000000002801', 'platform_admin', true) $$,
  '42501', 'own_account', 'Elle ne modifie pas ses propres rôles'
);
select throws_ok(
  $$ select private.admin_set_role('d0000000-0000-0000-0000-000000002805', 'super_admin', true) $$,
  '42501', 'forbidden', 'Elle non plus n''attribue pas le rôle de super-administrateur'
);
-- Dernier super-administrateur : pas de suppression de son compte.
select is(public.account_deletion_check(), 'last_super_admin', 'La dernière super-administratrice ne supprime pas son compte');
reset role;

-- Un administrateur ne lève pas la suspension décidée par la super-administratrice.
select tests.login('b0000000-0000-0000-0000-000000002802', 'aal2', 30);
select throws_ok(
  $$ select private.admin_set_account_status('e0000000-0000-0000-0000-000000002806', false) $$,
  '42501', 'forbidden', 'Une suspension décidée par un rang supérieur ne se lève pas par un rang inférieur'
);
-- Ni celle de l'ancien administrateur, redevenu simple compte.
select throws_ok(
  $$ select private.admin_set_account_status('b1000000-0000-0000-0000-000000002803', false) $$,
  '42501', 'forbidden', 'Y compris pour un ancien administrateur rétrogradé'
);
-- Il lève en revanche une suspension de son rang : celle de la modératrice.
select lives_ok(
  $$ select public.admin_set_account_status('c0000000-0000-0000-0000-000000002804', false) $$,
  'Il rétablit un compte qu''un administrateur avait suspendu'
);
reset role;

select tests.login('a0000000-0000-0000-0000-000000002801', 'aal2', 30);
select lives_ok(
  $$ select public.admin_set_account_status('e0000000-0000-0000-0000-000000002806', false) $$,
  'La super-administratrice lève sa propre décision'
);
reset role;

select tests.login('e0000000-0000-0000-0000-000000002806');
select is((select count(*) from public.profiles), 1::bigint, 'Le compte rétabli retrouve ses droits');
reset role;

-- Limites tenues en base.
insert into public.audit_logs (category, action, actor_id, target_type, target_id)
select 'platform', 'user.lookup', 'b0000000-0000-0000-0000-000000002802', 'account', 'unknown'
from generate_series(1, 60);
select tests.login('b0000000-0000-0000-0000-000000002802', 'aal2', 30);
select throws_ok(
  $$ select * from public.admin_find_user('adm-u@test.invalid') $$,
  null, 'rate_limited', 'Soixante recherches par quart d''heure et par administrateur, comptées en base'
);
reset role;

-- Second facteur récent : cas limites de la revendication du jeton.
create function tests.login_amr(p_user uuid, p_amr jsonb) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')
      || case when p_amr is null then '{}'::jsonb else jsonb_build_object('amr', p_amr) end)::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
grant execute on function tests.login_amr(uuid, jsonb) to authenticated;

select tests.login_amr('a0000000-0000-0000-0000-000000002801', null);
select ok(not private.has_recent_second_factor(), 'Sans revendication, le second facteur n''est pas récent');
reset role;
select tests.login_amr('a0000000-0000-0000-0000-000000002801', '"totp"'::jsonb);
select ok(not private.has_recent_second_factor(), 'Revendication mal formée : pas récent');
reset role;
select tests.login_amr('a0000000-0000-0000-0000-000000002801',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', 'hier')));
select ok(not private.has_recent_second_factor(), 'Horodatage illisible : pas récent');
reset role;
select tests.login_amr('a0000000-0000-0000-0000-000000002801',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)));
select ok(not private.has_recent_second_factor(), 'Mot de passe seul, même récent : pas de second facteur récent');
reset role;
select tests.login_amr('a0000000-0000-0000-0000-000000002801',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 601)));
select ok(not private.has_recent_second_factor(), 'Au-delà de dix minutes : plus récent');
reset role;
select tests.login_amr('a0000000-0000-0000-0000-000000002801',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 590)));
select ok(private.has_recent_second_factor(), 'En deçà de dix minutes : récent');
reset role;

-- Une autre super-administratrice, mais suspendue : elle ne compte pas.
select set_config('request.jwt.claims', '', true);
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-000000002805', 'super_admin');
insert into private.account_status (user_id, status, reason, suspended_by_rank)
values ('d0000000-0000-0000-0000-000000002805', 'suspended', 'Test', 3)
on conflict (user_id) do update set status = 'suspended';
select tests.login('a0000000-0000-0000-0000-000000002801', 'aal2', 30);
select is(public.account_deletion_check(), 'last_super_admin', 'Une super-administratrice suspendue ne compte pas');
reset role;

-- Effective, elle compte : la suppression redevient possible.
select set_config('request.jwt.claims', '', true);
delete from private.account_status where user_id = 'd0000000-0000-0000-0000-000000002805';
select tests.login('a0000000-0000-0000-0000-000000002801', 'aal2', 30);
select is(public.account_deletion_check(), 'ok', 'S''il en reste une autre, effective, la suppression est permise');
reset role;

-- Le rôle serveur ne modifie ni ne vide la table des rôles.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ update public.platform_roles set role = 'super_admin' $$, '42501', null, 'Le rôle serveur ne modifie pas les rôles');
select throws_ok($$ truncate public.platform_roles $$, '42501', null, 'Ni ne vide la table');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
