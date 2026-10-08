-- Référentiels (B-12) et profil académique (B-11).

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
  ('a0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profil-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profil-b@test.invalid');

-- ---------------------------------------------------------------------------
-- Données des référentiels
-- ---------------------------------------------------------------------------
select is((select count(*) from public.countries), 249::bigint, '249 pays ISO 3166-1');
select is(
  (select labels ->> 'fr' from public.countries where code = 'SN'), 'Sénégal',
  'Les pays portent un libellé français'
);
select is(
  (select labels ->> 'en' from public.countries where code = 'NG'), 'Nigeria',
  'Les pays portent un libellé anglais'
);
select is(
  (select count(*) from public.languages where is_interface), 2::bigint,
  'Deux langues d''interface : le français et l''anglais'
);
select is(
  (select count(*) from public.subjects where program_code = 'computer_science'), 29::bigint,
  'La filière informatique a ses 29 matières'
);
select is(
  (select count(*) from public.program_specialties where program_code = 'computer_science'),
  6::bigint, 'La filière informatique a ses 6 spécialités'
);
select ok(
  not (select is_active from public.education_levels where code = 'upper_secondary'),
  'Le niveau lycée est désactivé tant que l''accueil de mineurs n''est pas décidé'
);
select throws_ok(
  $$ insert into public.countries (code, labels) values ('ZZ', '{"fr": "Sans anglais"}') $$,
  '23514', null, 'Un libellé anglais manquant est refusé'
);
select throws_ok(
  $$ update public.countries set code = 'XX' where code = 'SN' $$,
  '42501', null, 'Un code de référentiel ne change jamais'
);

-- ---------------------------------------------------------------------------
-- Visiteur anonyme : aucun accès, pas même aux référentiels
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok('select code from public.countries', '42501', null, 'Un visiteur ne lit pas les pays par l''API');
select throws_ok('select code from public.subjects', '42501', null, 'Un visiteur ne lit pas les matières par l''API');
select throws_ok(
  $$ insert into public.countries (code, labels) values ('ZZ', '{"fr": "x", "en": "x"}') $$,
  '42501', null, 'Un visiteur n''ajoute pas de pays'
);
select throws_ok($$ delete from public.languages $$, '42501', null, 'Un visiteur ne supprime rien d''un référentiel');
select throws_ok('select * from public.profiles', '42501', null, 'Un visiteur ne lit pas les profils');
select throws_ok($$ update public.profiles set country_code = 'SN' $$, '42501', null, 'Un visiteur ne modifie pas les profils');
select throws_ok('select public.account_deletion_check()', '42501', null, 'Un visiteur n''appelle pas le contrôle de suppression');

reset role;

-- ---------------------------------------------------------------------------
-- Utilisateur : son profil académique
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000000a1');

select is(jsonb_array_length(public.reference_data() -> 'countries'), 249, 'Un utilisateur lit les pays, par la fonction des référentiels');
select is(
  jsonb_array_length(public.reference_data() -> 'education_levels'), 9,
  'Il ne voit que les niveaux actifs'
);
select throws_ok(
  $$ select 1 from public.countries $$, '42501', null,
  'Il ne lit plus les tables de référence directement : elles ne servent plus de maillon à une requête imbriquée'
);
select is(
  (select count(*) from unnest(array['countries', 'languages', 'licenses', 'resource_types', 'education_levels',
     'academic_domains', 'academic_programs', 'program_specialties', 'subjects']) t
   where has_table_privilege('authenticated', 'public.' || t, 'select')
      or has_table_privilege('anon', 'public.' || t, 'select')),
  0::bigint, 'Aucune des neuf tables de référence n''est lisible par l''API d''un compte'
);
select is(
  (select count(*) from jsonb_object_keys(public.reference_data())), 9::bigint,
  'Les neuf référentiels sont rendus en un seul objet'
);
select ok(not private.is_onboarded(), 'Un compte neuf n''a pas complété son profil');

-- Avant la complétion du profil, rien ne se publie, même par appel direct.
update public.profile_public set display_name = 'Avant complétion', is_public = true
  where user_id = 'a0000000-0000-0000-0000-0000000000a1';
select is(
  (select is_public from public.profile_public where user_id = 'a0000000-0000-0000-0000-0000000000a1'),
  false, 'Un compte qui n''a pas complété son profil ne publie rien'
);
select throws_ok(
  $$ update public.countries set is_active = false $$,
  '42501', null, 'Un utilisateur ne modifie pas un référentiel'
);

select lives_ok(
  $$ update public.profiles
     set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science',
         specialty_code = 'data_ai', subject_codes = array['algorithms', 'databases'],
         institution_name = 'Université de test', goals = array['thesis', 'research']
     where user_id = 'a0000000-0000-0000-0000-0000000000a1' $$,
  'Un utilisateur renseigne son profil académique'
);
select is(
  (select onboarded_at from public.profiles), null::timestamptz,
  'Sans déclaration d''âge, le profil n''est pas complet'
);

-- Déclaration d'âge : la date envoyée par le client est ignorée.
select lives_ok(
  $$ update public.profiles set age_confirmed_at = '2001-01-01T00:00:00Z'
     where user_id = 'a0000000-0000-0000-0000-0000000000a1' $$,
  'Un utilisateur déclare avoir l''âge requis'
);
select cmp_ok(
  (select age_confirmed_at from public.profiles), '>', now() - interval '1 minute',
  'La déclaration est datée par la base, pas par le client'
);
select isnt(
  (select onboarded_at from public.profiles), null::timestamptz,
  'Le profil est marqué complet par la base'
);

select ok(private.is_onboarded(), 'Le profil complété est reconnu par la base');
select lives_ok(
  $$ update public.profile_public set display_name = 'Étudiante A', is_public = true
     where user_id = 'a0000000-0000-0000-0000-0000000000a1' $$,
  'Une fois le profil complété, l''utilisateur peut publier un nom d''affichage'
);
select is(
  (select is_public from public.profile_public where user_id = 'a0000000-0000-0000-0000-0000000000a1'),
  true, 'La publication a bien pris effet'
);
select throws_ok(
  $$ update public.profiles set country_code = null $$,
  '23514', null, 'Un profil complété ne peut plus être vidé de son minimum'
);

-- La déclaration ne se retire pas et ne se redate pas.
update public.profiles set age_confirmed_at = null
  where user_id = 'a0000000-0000-0000-0000-0000000000a1';
select isnt(
  (select age_confirmed_at from public.profiles), null::timestamptz,
  'La déclaration d''âge ne se retire pas'
);
select throws_ok(
  $$ update public.profiles set onboarded_at = null $$,
  '42501', null, 'Un utilisateur ne modifie pas la date de complétion'
);

-- Valeurs refusées par la base, même en appel direct.
select throws_ok(
  $$ update public.profiles set level_code = 'upper_secondary' $$,
  '23514', null, 'Un niveau désactivé est refusé'
);
select throws_ok(
  $$ update public.profiles set country_code = 'ZZ' $$,
  '23514', null, 'Un pays inconnu est refusé'
);
select throws_ok(
  $$ update public.profiles set specialty_code = 'inexistante' $$,
  '23514', null, 'Une spécialité inconnue pour la filière est refusée'
);
select throws_ok(
  $$ update public.profiles set subject_codes = array['algorithms', 'cuisine'] $$,
  '23514', null, 'Une matière inconnue pour la filière est refusée'
);
select throws_ok(
  $$ update public.profiles set subject_codes = array['algorithms', 'algorithms'] $$,
  '23514', null, 'Une matière en double est refusée'
);
select throws_ok(
  $$ update public.profiles set goals = array['thesis', 'devenir_admin'] $$,
  '23514', null, 'Un objectif hors liste est refusé'
);
select throws_ok(
  $$ update public.profiles set institution_name = 'x' $$,
  '23514', null, 'Un nom d''établissement trop court est refusé'
);
select throws_ok(
  $$ update public.profiles set institution_name = 'ab' || repeat(' ', 5000) $$,
  '23514', null, 'Un nom d''établissement démesuré est refusé, espaces compris'
);
select throws_ok(
  $$ update public.profiles set institution_name = E'Université\nde test' $$,
  '23514', null, 'Un caractère de contrôle est refusé'
);
select throws_ok(
  $$ update public.profiles set subject_codes = array['algorithms', null] $$,
  '23514', null, 'Une matière nulle est refusée'
);
select throws_ok(
  $$ update public.profiles set goals = array['thesis', 'thesis'] $$,
  '23514', null, 'Un objectif en double est refusé'
);
select throws_ok(
  $$ update public.profiles set goals = array[null]::text[] $$,
  '23514', null, 'Un objectif nul est refusé'
);
select throws_ok(
  $$ update public.profiles set program_code = null $$,
  '23514', null, 'La filière ne se retire pas tant qu''une spécialité ou des matières en dépendent'
);

-- Tentative silencieuse sur le profil d'un autre.
update public.profiles set country_code = 'FR', institution_name = 'Piratée'
  where user_id = 'b0000000-0000-0000-0000-0000000000b2';

reset role;

select is(
  (select country_code from public.profiles where user_id = 'b0000000-0000-0000-0000-0000000000b2'),
  null, 'Le profil académique de B n''a pas été modifié par A'
);

-- B ne lit pas le profil académique de A.
select tests.login('b0000000-0000-0000-0000-0000000000b2');
select is_empty(
  $$ select 1 from public.profiles where institution_name is not null $$,
  'L''établissement d''un autre utilisateur n''est pas lisible'
);
reset role;

-- ---------------------------------------------------------------------------
-- Entrées désactivées : refusées même si elles existent
-- ---------------------------------------------------------------------------
update public.countries set is_active = false where code = 'FR';
update public.subjects set is_active = false
  where program_code = 'computer_science' and code = 'cryptography';
update public.program_specialties set is_active = false
  where program_code = 'computer_science' and code = 'web_mobile';

select tests.login('a0000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ update public.profiles set country_code = 'FR' $$,
  '23514', null, 'Un pays désactivé est refusé'
);
select throws_ok(
  $$ update public.profiles set subject_codes = array['cryptography'] $$,
  '23514', null, 'Une matière désactivée est refusée'
);
select throws_ok(
  $$ update public.profiles set specialty_code = 'web_mobile' $$,
  '23514', null, 'Une spécialité désactivée est refusée'
);
reset role;

-- ---------------------------------------------------------------------------
-- Déclaration d'âge : elle ne se redate pas
-- ---------------------------------------------------------------------------
-- La date est d'abord vieillie hors de l'API, puis l'utilisateur tente de la reposer.
alter table public.profiles disable trigger profiles_stamp_declarations;
update public.profiles set age_confirmed_at = '2026-01-01T00:00:00Z'
  where user_id = 'a0000000-0000-0000-0000-0000000000a1';
alter table public.profiles enable trigger profiles_stamp_declarations;

select tests.login('a0000000-0000-0000-0000-0000000000a1');
update public.profiles set age_confirmed_at = now()
  where user_id = 'a0000000-0000-0000-0000-0000000000a1';
reset role;

select is(
  (select age_confirmed_at from public.profiles where user_id = 'a0000000-0000-0000-0000-0000000000a1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'La déclaration d''âge ne se redate pas'
);

-- ---------------------------------------------------------------------------
-- Suppression de son compte : contrôle préalable et journal
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('c0000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profil-c@test.invalid'),
  ('d0000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profil-d@test.invalid');

insert into public.organizations (id, slug, name, status) values
  ('50000000-0000-0000-0000-000000000005', 'organisation-suppression', 'Organisation de test', 'verified');
insert into public.organization_members (organization_id, user_id, role, invited_by) values
  ('50000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000c3', 'org_admin', null),
  ('50000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-0000000000d4', 'member', 'c0000000-0000-0000-0000-0000000000c3');
insert into private.account_status (user_id, status, reason, changed_by) values
  ('b0000000-0000-0000-0000-0000000000b2', 'suspended', 'test', 'a0000000-0000-0000-0000-0000000000a1');

-- Compte ordinaire : autorisé, et la demande est journalisée.
select tests.login('a0000000-0000-0000-0000-0000000000a1');
select is(public.account_deletion_check(), 'ok', 'Un compte actif peut demander sa suppression');
reset role;
select is(
  (select count(*) from public.audit_logs
   where action = 'account.deletion_requested'
     and subject_user_id = 'a0000000-0000-0000-0000-0000000000a1'),
  1::bigint, 'La demande de suppression est journalisée'
);

-- Compte suspendu : il ne peut pas effacer sa suspension en se supprimant.
select tests.login('b0000000-0000-0000-0000-0000000000b2');
select is(public.account_deletion_check(), 'forbidden', 'Un compte suspendu ne peut pas demander sa suppression');
reset role;

-- Dernier administrateur d'une organisation.
select tests.login('c0000000-0000-0000-0000-0000000000c3', 'aal2');
select is(
  public.account_deletion_check(), 'last_org_admin',
  'Le dernier administrateur d''une organisation doit d''abord transmettre l''administration'
);
reset role;

-- Suppression effective : une ligne d'audit, et l'acteur n'est pas un tiers.
-- Le service d'authentification supprime sans jeton : les revendications
-- laissées par les connexions de test précédentes sont effacées.
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$ delete from auth.users where id = 'd0000000-0000-0000-0000-0000000000d4' $$,
  'Un membre ordinaire se supprime'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'account.deleted'
     and subject_user_id = 'd0000000-0000-0000-0000-0000000000d4'),
  1::bigint, 'La suppression d''un compte est journalisée, une seule fois'
);
select is(
  (select actor_id from public.audit_logs
   where action = 'organization_members.delete'
     and subject_user_id = 'd0000000-0000-0000-0000-0000000000d4'),
  null::uuid,
  'Le retrait en cascade n''est pas attribué à la personne qui avait invité le membre'
);
select is_empty(
  $$ select 1 from public.profiles where user_id = 'd0000000-0000-0000-0000-0000000000d4' $$,
  'Le profil du compte supprimé a disparu'
);
select is_empty(
  $$ select 1 from public.profile_public where user_id = 'd0000000-0000-0000-0000-0000000000d4' $$,
  'Sa fiche publique aussi'
);

select * from finish();
rollback;
