-- Tests d'isolation du schéma de fondation (authorization-model §8).
--
-- Chaque acteur est simulé comme le fait l'API : rôle PostgreSQL « authenticated »,
-- « anon » ou « service_role » et revendications du jeton dans request.jwt.claims.
-- Les contrôles portent donc sur la base elle-même, pas sur l'application (M-47).
--
-- Règle d'écriture : une tentative qui ne lève pas d'erreur (mise à jour filtrée
-- par la RLS) est toujours suivie, juste après, d'une vérification de l'état réel.

begin;

create extension if not exists pgtap with schema extensions;
-- Les fonctions de pgTAP sont ouvertes le temps de la transaction de test.
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

-- ---------------------------------------------------------------------------
-- Outils de test (annulés avec la transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(
  p_user uuid, p_aal text default 'aal1', p_extra jsonb default '{}'
)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', (
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal) || p_extra
  )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.login_claims(p_role text, p_claims jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  perform set_config('role', p_role, true);
end $$;

create function tests.logout()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Acteurs
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'etudiant-a@test.invalid'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'etudiant-b@test.invalid'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membre-org1@test.invalid'),
  ('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-org1@test.invalid'),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-org2@test.invalid'),
  ('f0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'moderateur@test.invalid'),
  ('a1000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-plateforme@test.invalid'),
  ('a2000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suspendu@test.invalid'),
  ('a3000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'super-admin@test.invalid');

-- Les contrôles portent sur les comptes créés ci-dessus : la base locale peut
-- contenir d'autres comptes, laissés par les tests de bout en bout.
select is(
  (select count(*) from public.profiles p
   join auth.users u on u.id = p.user_id
   where u.email like '%@test.invalid' and u.instance_id = '00000000-0000-0000-0000-000000000000'
     and u.id::text ~ '^[a-f][0-9]0{6}-0000-0000-0000-00000000000[1-9]$'),
  9::bigint,
  'Un profil est créé pour chaque nouveau compte'
);
select is(
  (select count(*) from public.profile_public
   where is_public and user_id::text ~ '^[a-f][0-9]0{6}-0000-0000-0000-00000000000[1-9]$'),
  0::bigint,
  'Aucun profil n''est public par défaut'
);

-- Amorçage par session directe (sans jeton) : seul chemin où l'acteur peut manquer.
insert into public.platform_roles (user_id, role) values
  ('a3000000-0000-0000-0000-000000000009', 'super_admin');

insert into public.platform_roles (user_id, role, granted_by) values
  ('f0000000-0000-0000-0000-000000000006', 'moderator', 'a3000000-0000-0000-0000-000000000009'),
  ('a1000000-0000-0000-0000-000000000007', 'platform_admin', 'a3000000-0000-0000-0000-000000000009'),
  ('a2000000-0000-0000-0000-000000000008', 'platform_admin', 'a3000000-0000-0000-0000-000000000009');

insert into public.organizations (id, slug, name, status, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'universite-un', 'Université Un', 'verified', 'a1000000-0000-0000-0000-000000000007'),
  ('20000000-0000-0000-0000-000000000002', 'universite-deux', 'Université Deux', 'verified', 'a1000000-0000-0000-0000-000000000007'),
  ('30000000-0000-0000-0000-000000000003', 'universite-trois', 'Université Trois', 'suspended', 'a1000000-0000-0000-0000-000000000007'),
  ('40000000-0000-0000-0000-000000000004', 'universite-quatre', 'Université Quatre', 'pending', 'a1000000-0000-0000-0000-000000000007');

insert into public.organization_members (organization_id, user_id, role, invited_by) values
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'member', 'd0000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'org_admin', 'a1000000-0000-0000-0000-000000000007'),
  ('20000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000005', 'org_admin', 'a1000000-0000-0000-0000-000000000007'),
  ('30000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'org_admin', 'a1000000-0000-0000-0000-000000000007');

insert into private.account_status (user_id, status, reason, changed_by) values
  ('a2000000-0000-0000-0000-000000000008', 'suspended', 'test', 'a3000000-0000-0000-0000-000000000009');

update public.profile_public set display_name = 'Étudiante B', is_public = true
  where user_id = 'b0000000-0000-0000-0000-000000000002';

-- A et B ont complété leur profil : sans cela, rien ne se publie.
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science',
      age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');

-- Un événement de sécurité par étudiant, pour tester la lecture du journal.
select private.write_audit('security', 'test.connexion', 'a0000000-0000-0000-0000-000000000001');
select private.write_audit('security', 'test.connexion', 'b0000000-0000-0000-0000-000000000002');
select private.write_audit('moderation', 'test.moderation', 'f0000000-0000-0000-0000-000000000006');

-- ---------------------------------------------------------------------------
-- Visiteur anonyme : aucun accès, pour les quatre opérations
-- ---------------------------------------------------------------------------
select tests.login_claims('anon', '{"role":"anon"}');

select throws_ok('select * from public.profiles', '42501', null, 'anon ne lit pas profiles');
select throws_ok('select * from public.profile_public', '42501', null, 'anon ne lit pas profile_public');
select throws_ok('select * from public.platform_roles', '42501', null, 'anon ne lit pas platform_roles');
select throws_ok('select id from public.organizations', '42501', null, 'anon ne lit pas organizations');
select throws_ok('select * from public.organization_members', '42501', null, 'anon ne lit pas organization_members');
select throws_ok('select * from public.audit_logs', '42501', null, 'anon ne lit pas audit_logs');
select throws_ok('select * from private.account_status', '42501', null, 'anon n''atteint pas le schéma private');
select throws_ok('select private.is_account_active()', '42501', null, 'anon n''exécute aucune fonction d''appui');
select throws_ok(
  $$ insert into public.profiles (user_id) values ('a0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon n''insère pas dans profiles'
);
select throws_ok($$ update public.profiles set preferred_locale = 'en' $$, '42501', null, 'anon ne modifie pas profiles');
select throws_ok($$ delete from public.profiles $$, '42501', null, 'anon ne supprime pas dans profiles');
select throws_ok($$ update public.profile_public set is_public = true $$, '42501', null, 'anon ne modifie pas profile_public');
select throws_ok($$ update public.organizations set name = 'x' $$, '42501', null, 'anon ne modifie pas organizations');
select throws_ok($$ delete from public.organization_members $$, '42501', null, 'anon ne supprime pas dans organization_members');
select throws_ok($$ delete from public.platform_roles $$, '42501', null, 'anon ne supprime pas dans platform_roles');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'anon ne supprime pas dans audit_logs');

reset role;

-- ---------------------------------------------------------------------------
-- Horizontal : l'étudiant A et l'étudiante B
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');

select results_eq(
  $$ select user_id from public.profiles $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'A ne voit que son propre profil'
);
select lives_ok(
  $$ update public.profiles set preferred_locale = 'en' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'A modifie sa langue préférée'
);
select throws_ok(
  $$ update public.profiles set preferred_locale = 'de' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'Une langue hors liste est refusée par la base'
);
select throws_ok(
  $$ update public.profiles set created_at = now() $$,
  '42501', null, 'A ne modifie pas une colonne non accordée'
);
select throws_ok(
  $$ insert into public.profiles (user_id) values ('a0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'A n''insère pas de profil'
);
select throws_ok($$ delete from public.profiles $$, '42501', null, 'A ne supprime pas de profil');
select throws_ok('select * from private.account_status', '42501', null, 'A ne lit pas l''état des comptes');

-- Tentatives silencieuses sur les données de B : vérifiées juste après.
update public.profiles set preferred_locale = 'en'
  where user_id = 'b0000000-0000-0000-0000-000000000002';
update public.profile_public set display_name = 'Usurpé'
  where user_id = 'b0000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.profile_public), 2::bigint,
  'A voit sa fiche et celle que B a publiée, rien d''autre'
);
select lives_ok(
  $$ update public.profile_public set display_name = 'Étudiant A' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'A modifie son nom d''affichage'
);
select is(
  (select display_name from public.profile_public where user_id = 'a0000000-0000-0000-0000-000000000001'),
  'Étudiant A', 'Le nom d''affichage de A a bien été modifié'
);
select throws_ok(
  $$ update public.profile_public set display_name = repeat('x', 81) where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'Un nom d''affichage trop long est refusé par la base'
);

-- Journal d'audit : A ne lit que ses événements de sécurité.
select results_eq(
  $$ select action, actor_id from public.audit_logs $$,
  $$ values ('test.connexion', 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'A ne lit que son propre événement de sécurité'
);
select throws_ok($$ update public.audit_logs set action = 'x' $$, '42501', null, 'A ne modifie pas le journal');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'A ne supprime rien du journal');
select throws_ok(
  $$ insert into public.audit_logs (category, action) values ('security', 'faux') $$,
  '42501', null, 'A n''insère pas dans le journal'
);
select throws_ok(
  $$ select private.write_audit('security', 'faux') $$,
  '42501', null, 'A n''appelle pas la fonction d''écriture du journal'
);

reset role;

select is(
  (select preferred_locale from public.profiles where user_id = 'b0000000-0000-0000-0000-000000000002'),
  'fr', 'Le profil de B n''a pas été modifié par A'
);
select is(
  (select display_name from public.profile_public where user_id = 'b0000000-0000-0000-0000-000000000002'),
  'Étudiante B', 'Le nom d''affichage de B n''a pas été modifié par A'
);

-- ---------------------------------------------------------------------------
-- Vertical : aucune élévation de privilège
-- ---------------------------------------------------------------------------
-- A déclare lui-même des rôles dans les métadonnées de son jeton.
select tests.login(
  'a0000000-0000-0000-0000-000000000001', 'aal2',
  '{"user_metadata": {"role": "platform_admin", "is_admin": true}, "app_metadata": {"role": "super_admin"}}'
);

select ok(
  not private.has_platform_role(array['moderator', 'platform_admin', 'super_admin']),
  'Un rôle déclaré dans les métadonnées du jeton ne donne aucun droit (M-05)'
);
select throws_ok(
  $$ insert into public.platform_roles (user_id, role) values ('a0000000-0000-0000-0000-000000000001', 'platform_admin') $$,
  '42501', null, 'Un utilisateur ne s''attribue pas un rôle de plateforme'
);
select throws_ok($$ update public.platform_roles set role = 'super_admin' $$, '42501', null, 'Un utilisateur ne modifie pas platform_roles');
select throws_ok($$ delete from public.platform_roles $$, '42501', null, 'Un utilisateur ne supprime pas dans platform_roles');
select is_empty($$ select 1 from public.platform_roles $$, 'A ne voit aucun rôle de plateforme : il n''en a pas');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'org_admin') $$,
  '42501', null, 'Un utilisateur ne s''ajoute pas à une organisation'
);
select throws_ok($$ update public.organization_members set role = 'org_admin' $$, '42501', null, 'Un utilisateur ne modifie pas organization_members');
select throws_ok($$ delete from public.organization_members $$, '42501', null, 'Un utilisateur ne supprime pas dans organization_members');
select throws_ok(
  $$ insert into public.organizations (slug, name) values ('fausse', 'Fausse organisation') $$,
  '42501', null, 'Un utilisateur ne crée pas d''organisation'
);
select throws_ok($$ update public.organizations set name = 'x' $$, '42501', null, 'Un utilisateur ne modifie pas organizations');
select throws_ok($$ delete from public.organizations $$, '42501', null, 'Un utilisateur ne supprime pas d''organisation');
select throws_ok(
  $$ select created_by from public.organizations $$,
  '42501', null, 'L''identifiant du créateur d''une organisation n''est pas lisible'
);
select throws_ok(
  $$ select granted_by from public.platform_roles $$,
  '42501', null, 'L''identifiant de celui qui attribue un rôle n''est pas lisible'
);

reset role;

-- ---------------------------------------------------------------------------
-- Second facteur imposé en base (M-48)
-- ---------------------------------------------------------------------------
select tests.login('f0000000-0000-0000-0000-000000000006', 'aal1');
select ok(not private.has_platform_role(array['moderator']), 'Un modérateur en session aal1 n''a aucun droit de modération');
select results_eq(
  $$ select role from public.platform_roles $$, $$ values ('moderator') $$,
  'Il lit tout de même son propre rôle'
);
select is_empty(
  $$ select 1 from public.audit_logs where category = 'moderation' $$,
  'En aal1, il ne lit pas les événements de modération'
);
reset role;

-- Jeton sans revendication aal.
select tests.login_claims('authenticated',
  '{"sub": "f0000000-0000-0000-0000-000000000006", "role": "authenticated"}');
select ok(not private.has_platform_role(array['moderator']), 'Sans revendication aal, aucun rôle de plateforme');
reset role;

select tests.login('f0000000-0000-0000-0000-000000000006', 'aal2');
select ok(private.has_platform_role(array['moderator']), 'Le même modérateur en session aal2 a son rôle');
select ok(
  not private.has_platform_role(array['platform_admin', 'super_admin']),
  'Un modérateur n''est pas administrateur de plateforme'
);
select results_eq(
  $$ select distinct category from public.audit_logs $$, $$ values ('moderation') $$,
  'Un modérateur ne lit que les événements de modération'
);
reset role;

-- Compte anonyme : jamais actif.
select tests.login('a0000000-0000-0000-0000-000000000001', 'aal1', '{"is_anonymous": true}');
select ok(not private.is_account_active(), 'Un compte anonyme n''est pas un compte actif');
select is_empty($$ select 1 from public.profiles $$, 'Un compte anonyme ne lit aucun profil');
reset role;

-- ---------------------------------------------------------------------------
-- Compte suspendu (M-49) : plus aucun droit, sans attendre l'expiration du jeton
-- ---------------------------------------------------------------------------
select tests.login('a2000000-0000-0000-0000-000000000008', 'aal2');
select ok(not private.is_account_active(), 'Le compte suspendu est vu comme inactif');
select ok(not private.has_platform_role(array['platform_admin']), 'Un administrateur suspendu perd son rôle');
select is_empty($$ select 1 from public.profiles $$, 'Un compte suspendu ne lit plus son profil');
select is_empty($$ select 1 from public.profile_public $$, 'Un compte suspendu ne lit plus les fiches publiques');
select is_empty($$ select 1 from public.organizations $$, 'Un compte suspendu ne lit plus les organisations');
select is_empty($$ select 1 from public.platform_roles $$, 'Un compte suspendu ne lit plus ses rôles');
select is_empty($$ select 1 from public.audit_logs $$, 'Un compte suspendu ne lit plus le journal');
update public.profiles set preferred_locale = 'en'
  where user_id = 'a2000000-0000-0000-0000-000000000008';
reset role;

select is(
  (select preferred_locale from public.profiles where user_id = 'a2000000-0000-0000-0000-000000000008'),
  'fr', 'Un compte suspendu ne modifie plus son profil'
);

-- ---------------------------------------------------------------------------
-- Organisations : isolation entre tenants
-- ---------------------------------------------------------------------------
-- Simple utilisateur : seules les organisations vérifiées.
select tests.login('b0000000-0000-0000-0000-000000000002');
select results_eq(
  $$ select slug from public.organizations order by slug $$,
  $$ values ('universite-deux'), ('universite-un') $$,
  'Un utilisateur ne voit que les organisations vérifiées'
);
select is_empty($$ select 1 from public.organization_members $$, 'Un utilisateur sans organisation ne voit aucun membre');
reset role;

-- Membre de l'organisation 1.
select tests.login('c0000000-0000-0000-0000-000000000003');
select results_eq(
  $$ select user_id from public.organization_members $$,
  $$ values ('c0000000-0000-0000-0000-000000000003'::uuid) $$,
  'Un membre ne voit que sa propre appartenance, pas la liste'
);
select is_empty($$ select 1 from public.audit_logs $$, 'Un membre ne lit aucun événement de son organisation');
reset role;

-- Administrateur de l'organisation 1 sans second facteur.
select tests.login('d0000000-0000-0000-0000-000000000004', 'aal1');
select is(
  (select count(*) from public.organization_members), 1::bigint,
  'Un org_admin en aal1 ne voit que sa propre ligne'
);
select ok(
  not private.has_org_role('10000000-0000-0000-0000-000000000001', array['org_admin']),
  'Un org_admin en aal1 n''a aucun droit d''administration'
);
reset role;

-- Administrateur de l'organisation 1 avec second facteur.
select tests.login('d0000000-0000-0000-0000-000000000004', 'aal2');
select results_eq(
  $$ select user_id from public.organization_members order by user_id $$,
  $$ values ('c0000000-0000-0000-0000-000000000003'::uuid), ('d0000000-0000-0000-0000-000000000004'::uuid) $$,
  'L''org_admin de l''organisation 1 voit ses deux membres, et eux seuls'
);
select ok(
  not private.has_org_role('20000000-0000-0000-0000-000000000002', array['org_admin', 'librarian', 'teacher', 'member']),
  'Il n''a aucun rôle dans l''organisation 2'
);
select is_empty(
  $$ select 1 from public.profiles where user_id = 'c0000000-0000-0000-0000-000000000003' $$,
  'L''org_admin ne lit pas le profil privé d''un membre de son organisation'
);
select ok(not private.has_platform_role(array['platform_admin']), 'Un org_admin n''a aucun rôle de plateforme');
select is_empty(
  $$ select 1 from public.audit_logs where organization_id is distinct from '10000000-0000-0000-0000-000000000001' $$,
  'L''org_admin ne lit aucun événement hors de son organisation, événements de plateforme compris'
);
select is(
  (select count(*) from public.audit_logs), 3::bigint,
  'Il lit exactement les trois événements de son organisation'
);
reset role;

-- Administrateur de l'organisation 2 : rien de l'organisation 1.
select tests.login('e0000000-0000-0000-0000-000000000005', 'aal2');
select results_eq(
  $$ select user_id from public.organization_members $$,
  $$ values ('e0000000-0000-0000-0000-000000000005'::uuid) $$,
  'L''org_admin de l''organisation 2 ne voit aucun membre de l''organisation 1'
);
select ok(
  not private.has_org_role('10000000-0000-0000-0000-000000000001', array['org_admin', 'librarian', 'teacher', 'member']),
  'Il n''a aucun rôle dans l''organisation 1'
);
select is_empty(
  $$ select 1 from public.audit_logs where organization_id = '10000000-0000-0000-0000-000000000001' $$,
  'Il ne lit aucun événement de l''organisation 1'
);
reset role;

-- Organisation suspendue : son administrateur perd ses droits d'organisation.
select tests.login('a0000000-0000-0000-0000-000000000001', 'aal2');
select ok(
  not private.has_org_role('30000000-0000-0000-0000-000000000003', array['org_admin']),
  'Dans une organisation suspendue, plus aucun rôle ne s''exerce'
);
select is_empty(
  $$ select 1 from public.organizations where id = '30000000-0000-0000-0000-000000000003' $$,
  'Une organisation suspendue n''est plus visible de ses membres'
);
reset role;

-- Administrateur de plateforme : voit les organisations et le journal, pas les données privées.
select tests.login('a1000000-0000-0000-0000-000000000007', 'aal2');
select is((select count(*) from public.organizations), 4::bigint, 'L''administrateur de plateforme voit toutes les organisations');
select is((select count(*) from public.profiles), 1::bigint, 'Il ne lit que son propre profil');
select is_empty($$ select 1 from public.organization_members $$, 'Il ne lit pas les listes de membres');
select cmp_ok(
  (select count(distinct category) from public.audit_logs), '>=', 3::bigint,
  'Il lit le journal de toutes les catégories'
);
reset role;

select tests.login('a1000000-0000-0000-0000-000000000007', 'aal1');
select is_empty(
  $$ select 1 from public.organizations where status <> 'verified' $$,
  'Sans second facteur, l''administrateur de plateforme n''a que la vue d''un utilisateur'
);
reset role;

-- ---------------------------------------------------------------------------
-- Opérations serveur (service_role) : l'acteur est obligatoire
-- ---------------------------------------------------------------------------
select tests.login_claims('service_role', '{"role":"service_role"}');

select throws_ok(
  $$ insert into public.platform_roles (user_id, role) values ('b0000000-0000-0000-0000-000000000002', 'moderator') $$,
  '23502', null, 'Une attribution de rôle sans auteur est refusée'
);
select throws_ok(
  $$ insert into public.platform_roles (user_id, role, granted_by) values ('b0000000-0000-0000-0000-000000000002', 'moderator', 'b0000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'Personne ne s''attribue un rôle à soi-même'
);
select lives_ok(
  $$ insert into public.platform_roles (user_id, role, granted_by) values ('b0000000-0000-0000-0000-000000000002', 'moderator', 'a1000000-0000-0000-0000-000000000007') $$,
  'Une attribution de rôle avec auteur est acceptée'
);
select throws_ok(
  $$ insert into public.organizations (slug, name) values ('sans-auteur', 'Sans auteur') $$,
  '23502', null, 'Une création d''organisation sans auteur est refusée'
);
select throws_ok(
  $$ insert into public.audit_logs (category, action) values ('platform', 'faux') $$,
  '42501', null, 'Le serveur n''écrit pas directement dans le journal'
);
select throws_ok(
  $$ select private.write_audit('platform', 'faux') $$,
  '42501', null, 'Le serveur n''appelle pas la fonction d''écriture du journal'
);
select throws_ok(
  $$ delete from public.profiles $$,
  '42501', null, 'Le serveur ne supprime pas de profil'
);

reset role;
select tests.logout();

select is(
  (select actor_id from public.audit_logs
   where action = 'platform_roles.insert'
     and subject_user_id = 'b0000000-0000-0000-0000-000000000002'),
  'a1000000-0000-0000-0000-000000000007'::uuid,
  'L''attribution faite par le serveur est journalisée avec son auteur'
);
select is(
  (select count(*) from public.audit_logs
   where action like 'platform_roles.%' and actor_id is null),
  1::bigint,
  'Seul l''amorçage du premier super_admin est sans auteur'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'account_status.insert' and actor_id is not null),
  1::bigint,
  'La suspension d''un compte est journalisée avec son auteur'
);

-- ---------------------------------------------------------------------------
-- Intégrité : colonnes de propriété, dernier administrateur
-- (sous le rôle propriétaire : ces règles valent même côté serveur)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.profiles set user_id = 'b0000000-0000-0000-0000-000000000002' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', 'La colonne user_id de public.profiles ne peut pas être modifiée.',
  'Le propriétaire d''un profil ne change pas'
);
select throws_ok(
  $$ update public.profile_public set user_id = 'b0000000-0000-0000-0000-000000000002' where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', 'La colonne user_id de public.profile_public ne peut pas être modifiée.',
  'Le propriétaire d''une fiche publique ne change pas'
);
select throws_ok(
  $$ update public.platform_roles set role = 'super_admin' where user_id = 'f0000000-0000-0000-0000-000000000006' $$,
  '42501', 'La colonne role de public.platform_roles ne peut pas être modifiée.',
  'Un rôle de plateforme ne se transforme pas : il se retire et se réattribue'
);
select throws_ok(
  $$ update public.organizations set slug = 'autre' where id = '10000000-0000-0000-0000-000000000001' $$,
  '42501', 'La colonne slug de public.organizations ne peut pas être modifiée.',
  'L''identifiant public d''une organisation ne change pas'
);
select throws_ok(
  $$ update public.organization_members set organization_id = '20000000-0000-0000-0000-000000000002' where user_id = 'c0000000-0000-0000-0000-000000000003' $$,
  '42501', 'La colonne organization_id de public.organization_members ne peut pas être modifiée.',
  'Une appartenance ne se déplace pas vers une autre organisation'
);

create table tests.cible (id int primary key, valeur text);
create trigger cible_colonne_inexistante before update on tests.cible
  for each row execute function private.prevent_key_change('colonne_absente');
insert into tests.cible values (1, 'a');
select throws_ok(
  $$ update tests.cible set valeur = 'b' $$,
  'P0001', 'Colonne colonne_absente absente de tests.cible.',
  'Un déclencheur de protection mal configuré échoue au lieu de ne rien protéger'
);

select throws_ok(
  $$ delete from public.organization_members where organization_id = '10000000-0000-0000-0000-000000000001' and user_id = 'd0000000-0000-0000-0000-000000000004' $$,
  '23514', null, 'Le dernier org_admin ne peut pas être retiré'
);
select throws_ok(
  $$ update public.organization_members set role = 'member' where organization_id = '10000000-0000-0000-0000-000000000001' and user_id = 'd0000000-0000-0000-0000-000000000004' $$,
  '23514', null, 'Le dernier org_admin ne peut pas être rétrogradé'
);
select throws_ok(
  $$ delete from auth.users where id = 'd0000000-0000-0000-0000-000000000004' $$,
  '23514', null,
  'Le compte du dernier org_admin ne peut pas être supprimé : l''administration doit d''abord être transférée'
);

-- Avec un second administrateur, le premier peut partir ; les deux ensemble, non.
insert into public.organization_members (organization_id, user_id, role, invited_by) values
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'org_admin', 'd0000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ delete from public.organization_members where organization_id = '10000000-0000-0000-0000-000000000001' and role = 'org_admin' $$,
  '23514', null, 'Deux administrateurs ne peuvent pas être retirés en une seule instruction'
);
select lives_ok(
  $$ delete from public.organization_members where organization_id = '10000000-0000-0000-0000-000000000001' and user_id = 'd0000000-0000-0000-0000-000000000004' $$,
  'Un administrateur peut être retiré s''il en reste un autre'
);

-- ---------------------------------------------------------------------------
-- Journal d'audit : écrit par la base, en ajout seul, pour tous les rôles
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.audit_logs set action = 'modifié' $$,
  '42501', null, 'Le journal ne se modifie pas, même pour le propriétaire de la table'
);
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'Le journal ne se supprime pas');
select throws_ok($$ truncate public.audit_logs $$, '42501', null, 'Le journal ne se vide pas');

-- La suppression d'un compte n'efface aucune ligne du journal.
select lives_ok(
  $$ delete from auth.users where id = 'f0000000-0000-0000-0000-000000000006' $$,
  'Un compte ordinaire se supprime'
);
select cmp_ok(
  (select count(*) from public.audit_logs where subject_user_id = 'f0000000-0000-0000-0000-000000000006'),
  '>=', 1::bigint,
  'Les lignes d''audit du compte supprimé sont conservées'
);

select * from finish();
rollback;
