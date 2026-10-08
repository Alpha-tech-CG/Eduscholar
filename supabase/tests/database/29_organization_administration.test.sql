-- D-01, D-04 : administration des organisations par la plateforme.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
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
create table tests.ids (label text primary key, id uuid);
create table tests.tokens (label text primary key, token text);
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant all on tests.ids, tests.tokens to authenticated;

-- Acteurs : P administrateur de plateforme ; Q administrateur de plateforme,
-- membre de l'organisation B ; U utilisateur avec second facteur ; V sans second
-- facteur ; N adresse non confirmée ; W suspendue ; O profil non complété ;
-- M modératrice ; R second candidat avec second facteur.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('b0000000-0000-0000-0000-000000007101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-p@test.invalid', now()),
  ('b1000000-0000-0000-0000-000000007102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-q@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000007103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-u@test.invalid', now()),
  ('e0000000-0000-0000-0000-000000007104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-v@test.invalid', now()),
  ('e1000000-0000-0000-0000-000000007105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-n@test.invalid', null),
  ('f0000000-0000-0000-0000-000000007106', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-w@test.invalid', now()),
  ('f1000000-0000-0000-0000-000000007107', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-o@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000007108', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-m@test.invalid', now()),
  ('d1000000-0000-0000-0000-000000007109', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-r@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000710_' and user_id <> 'f1000000-0000-0000-0000-000000007107';

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select ('fa000000-0000-0000-0000-00000000' || right(id::text, 4))::uuid, id, 'test', 'totp', 'verified',
       now() - interval '1 day', now(), 'secret-de-test'
from auth.users
where id::text like '%-00000000710_' and email <> 'orga-v@test.invalid';

insert into public.platform_roles (user_id, role) values
  ('b0000000-0000-0000-0000-000000007101', 'platform_admin'),
  ('b1000000-0000-0000-0000-000000007102', 'platform_admin'),
  ('c0000000-0000-0000-0000-000000007108', 'moderator');
insert into private.account_status (user_id, status, reason)
values ('f0000000-0000-0000-0000-000000007106', 'suspended', 'Test');

-- S1, S2 : super-administrateurs.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000007110', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-s1@test.invalid', now()),
  ('a1000000-0000-0000-0000-000000007111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-s2@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-000000007110', 'a1000000-0000-0000-0000-000000007111');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000007110', 'a0000000-0000-0000-0000-000000007110', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-000000007111', 'a1000000-0000-0000-0000-000000007111', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values
  ('a0000000-0000-0000-0000-000000007110', 'super_admin'),
  ('a1000000-0000-0000-0000-000000007111', 'super_admin');
-- T1 : invité avec second facteur, sans aucun rôle.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('d2000000-0000-0000-0000-000000007112', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'orga-t1@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id = 'd2000000-0000-0000-0000-000000007112';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000007112', 'd2000000-0000-0000-0000-000000007112', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'secret-de-test');

-- Organisation B : Q en est membre. Organisation C : portera une ressource.
insert into public.organizations (id, slug, name, status) values
  ('71000000-0000-0000-0000-0000000000b1', 'orga-test-b', 'Organisation B du test', 'verified'),
  ('71000000-0000-0000-0000-0000000000c1', 'orga-test-c', 'Organisation C du test', 'suspended');
insert into public.organization_members (organization_id, user_id, role) values
  ('71000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-000000007102', 'member');
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility, organization_id, last_verified_at, published_at)
values
  ('71000000-0000-0000-0000-000000000001', 'article', 'Ressource réservée du test 71', array['Awa Diop'], '{}',
   'fr', 'computer_science', 'organization', 'test', 'https://exemple.invalid/o71', 'open_access',
   'published', 'organization', '71000000-0000-0000-0000-0000000000c1', now(), now());

-- ---------------------------------------------------------------------------
-- Le rôle serveur n'écrit plus dans les deux tables
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['public.organizations', 'public.organization_members']) t,
     unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('service_role', t, p)),
  0::bigint, 'service_role n''a plus aucun droit d''écriture sur organizations ni organization_members'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'private.organization_decisions', 'select,insert,update,delete')),
  0::bigint, 'Les motifs des décisions ne se lisent ni ne s''écrivent directement'
);

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'private.organization_departures', 'select,insert,update,delete')),
  0::bigint, 'La trace des départs ne se lit ni ne s''écrit directement'
);
-- Toute table liée à une organisation doit être prise en compte par la
-- dissolution : une nouvelle clé étrangère oblige à modifier cette liste.
select results_eq(
  $$ select conrelid::regclass::text, confdeltype::text from pg_constraint
     where contype = 'f' and confrelid = 'public.organizations'::regclass order by 1 $$,
  $$ values ('organization_invitations', 'c'), ('organization_members', 'r'),
            ('private.organization_departures', 'c'), ('resources', 'r') $$,
  'Les clés étrangères vers organizations sont celles que la dissolution connaît'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok(
  $$ insert into public.organizations (slug, name, created_by) values ('orga-serveur', 'Par le serveur', 'b0000000-0000-0000-0000-000000007101') $$,
  '42501', null, 'Le rôle serveur ne crée pas d''organisation'
);
select throws_ok(
  $$ update public.organizations set status = 'verified' where id = '71000000-0000-0000-0000-0000000000c1' $$,
  '42501', null, 'Ni n''en change l''état'
);
select throws_ok($$ delete from public.organizations $$, '42501', null, 'Ni n''en supprime');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role, invited_by) values ('71000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-000000007103', 'org_admin', 'b0000000-0000-0000-0000-000000007101') $$,
  '42501', null, 'Ni n''ajoute de membre'
);
select throws_ok($$ update public.organization_members set role = 'org_admin' $$, '42501', null, 'Ni ne change un rôle');
select throws_ok($$ delete from public.organization_members $$, '42501', null, 'Ni ne retire un membre');
select throws_ok(
  $$ select public.admin_create_organization('{"name": "Par le serveur", "slug": "orga-serveur"}') $$,
  '42501', null, 'Ni n''appelle les fonctions d''administration'
);
select throws_ok(
  $$ select private.admin_dissolve_organization('71000000-0000-0000-0000-0000000000b1', 'x') $$,
  '42501', null, 'Ni leurs fonctions internes'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select public.admin_create_organization('{"name": "Visiteur", "slug": "orga-visiteur"}') $$,
  '42501', null, 'Un visiteur n''appelle aucune fonction d''administration des organisations'
);
select throws_ok($$ select * from public.admin_list_organizations() $$, '42501', null, 'Ni la liste');
reset role;

-- ---------------------------------------------------------------------------
-- Qui peut administrer : chaque refus, consigné, rendu en 403
-- ---------------------------------------------------------------------------
select tests.login('d0000000-0000-0000-0000-000000007103', 'aal2', 10);
select throws_ok($$ select private.admin_create_organization('{"name": "Fausse", "slug": "orga-fausse"}') $$, '42501', 'forbidden', 'Un utilisateur ne crée pas d''organisation');
select throws_ok($$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus') $$, '42501', 'forbidden', 'Ni n''en change l''état');
select throws_ok($$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000b1', 'orga-r@test.invalid') $$, '42501', 'forbidden', 'Ni n''y invite d''administrateur');
select throws_ok($$ select private.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Renommée"}') $$, '42501', 'forbidden', 'Ni ne la renomme');
select throws_ok($$ select private.admin_dissolve_organization('71000000-0000-0000-0000-0000000000c1', 'Abus') $$, '42501', 'forbidden', 'Ni ne la dissout');
select throws_ok($$ select * from private.admin_list_organizations() $$, '42501', 'forbidden', 'Ni ne liste les organisations');

select is(
  public.admin_create_organization('{"name": "Fausse", "slug": "orga-fausse"}'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'Par l''API, le refus est rendu sans lever'
);
select is(current_setting('response.status', true), '403', 'Avec le statut 403');
select is(
  public.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'De même pour un changement d''état'
);
select is(
  public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000b1', 'orga-r@test.invalid'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'Pour l''invitation d''un administrateur'
);
select is(
  public.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Renommée"}'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'Pour un renommage'
);
select is(
  public.admin_dissolve_organization('71000000-0000-0000-0000-0000000000c1', 'Abus'),
  '{"code": "42501", "message": "forbidden"}'::jsonb, 'Pour une dissolution'
);
select is_empty($$ select * from public.admin_list_organizations() $$, 'La liste refusée ne rend aucune ligne');
reset role;

select results_eq(
  $$ select target_id, metadata ->> 'code', metadata ->> 'source' from public.audit_logs
     where action = 'admin.refused' and actor_id = 'd0000000-0000-0000-0000-000000007103'
     order by id $$,
  $$ values ('create_organization', 'forbidden', 'database'),
            ('set_organization_status', 'forbidden', 'database'),
            ('invite_org_admin', 'forbidden', 'database'),
            ('rename_organization', 'forbidden', 'database'),
            ('dissolve_organization', 'forbidden', 'database') $$,
  'Chaque refus est consigné par la base, sous son opération (cinq par heure pour un compte sans rôle)'
);
select is(
  (select name from public.organizations where id = '71000000-0000-0000-0000-0000000000b1'),
  'Organisation B du test', 'Rien n''a été modifié par ces tentatives'
);

select tests.login('c0000000-0000-0000-0000-000000007108', 'aal2', 10);
select throws_ok($$ select private.admin_create_organization('{"name": "Fausse", "slug": "orga-fausse"}') $$, '42501', 'forbidden', 'Une modératrice ne crée pas d''organisation');
select throws_ok($$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus') $$, '42501', 'forbidden', 'Ni n''en suspend');
reset role;

-- Administrateur dont le second facteur n'est pas présenté, ou plus récent.
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal1');
select throws_ok($$ select private.admin_create_organization('{"name": "Sans facteur", "slug": "orga-sans-facteur"}') $$, '42501', 'forbidden', 'En aal1, un administrateur ne crée pas d''organisation');
reset role;
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 700);
select throws_ok($$ select private.admin_create_organization('{"name": "Facteur ancien", "slug": "orga-facteur-ancien"}') $$, '42501', 'recent_second_factor_required', 'Second facteur présenté il y a plus de dix minutes : création refusée');
select throws_ok($$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus') $$, '42501', 'recent_second_factor_required', 'Changement d''état refusé');
select throws_ok($$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000b1', 'orga-r@test.invalid') $$, '42501', 'recent_second_factor_required', 'Invitation d''un administrateur refusée');
select throws_ok($$ select private.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Renommée"}') $$, '42501', 'recent_second_factor_required', 'Renommage refusé');
select throws_ok($$ select private.admin_dissolve_organization('71000000-0000-0000-0000-0000000000c1', 'Abus') $$, '42501', 'recent_second_factor_required', 'Dissolution refusée');
select throws_ok($$ select * from private.admin_list_organizations() $$, '42501', 'recent_second_factor_required', 'Liste refusée');
select is(
  public.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Renommée"}') ->> 'message',
  'recent_second_factor_required', 'Par l''API, le motif du refus est rendu'
);
reset role;

-- Administrateur de plateforme membre de l'organisation : il ne l'administre pas.
select tests.login('b1000000-0000-0000-0000-000000007102', 'aal2', 10);
select throws_ok($$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus') $$, '42501', 'own_organization', 'Un administrateur membre de l''organisation n''en change pas l''état');
select throws_ok($$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000b1', 'orga-r@test.invalid') $$, '42501', 'own_organization', 'Ni n''y invite d''administrateur');
select throws_ok($$ select private.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Renommée"}') $$, '42501', 'own_organization', 'Ni ne la renomme');
select throws_ok($$ select private.admin_dissolve_organization('71000000-0000-0000-0000-0000000000b1', 'Abus') $$, '42501', 'own_organization', 'Ni ne la dissout');
select is(
  public.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus') ->> 'message',
  'own_organization', 'Par l''API, le refus dit pourquoi'
);
reset role;
select is(
  (select status from public.organizations where id = '71000000-0000-0000-0000-0000000000b1'),
  'verified', 'L''organisation n''a pas changé d''état'
);

-- ---------------------------------------------------------------------------
-- Créer
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
insert into tests.ids
select 'a', (public.admin_create_organization('{"name": "  Université du test 71  ", "slug": "orga-test-a", "country_code": "SN"}') ->> 'id')::uuid;
select isnt((select id from tests.ids where label = 'a'), null, 'Un administrateur crée une organisation et en reçoit l''identifiant');
select throws_ok($$ select public.admin_create_organization('{"name": "Autre", "slug": "orga-test-a"}') $$, 'P0001', 'slug_taken', 'Un slug déjà pris est refusé');
select throws_ok($$ select public.admin_create_organization('{"name": "Autre", "slug": "Mauvais Slug"}') $$, '22023', 'invalid_payload', 'Un slug mal formé est refusé');
select throws_ok($$ select public.admin_create_organization('{"name": "A", "slug": "orga-nom-court"}') $$, '22023', 'invalid_payload', 'Un nom trop court est refusé');
select throws_ok($$ select public.admin_create_organization('{"name": "Autre", "slug": "orga-pays", "country_code": "ZZ"}') $$, '22023', 'invalid_payload', 'Un pays inconnu est refusé');
select throws_ok($$ select public.admin_create_organization('"texte"') $$, '22023', 'invalid_payload', 'Une requête qui n''est pas un objet est refusée');
reset role;
select results_eq(
  $$ select o.name, o.slug, o.country_code, o.status, o.created_by from public.organizations o join tests.ids i on i.id = o.id and i.label = 'a' $$,
  $$ values ('Université du test 71', 'orga-test-a', 'SN', 'pending', 'b0000000-0000-0000-0000-000000007101'::uuid) $$,
  'L''organisation naît à l''état pending, au nom de son auteur'
);

-- ---------------------------------------------------------------------------
-- Vérifier, suspendre, rétablir
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select is(public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'verified'), null, 'pending → verified');
select throws_ok($$ select public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'verified') $$, '22023', 'invalid_transition', 'Vérifier deux fois : refusé');
select throws_ok($$ select public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'pending') $$, '22023', 'invalid_payload', 'On ne remet pas une organisation à pending par cette fonction');
select throws_ok($$ select public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'suspended') $$, '22023', 'reason_required', 'Une suspension exige un motif');
select throws_ok($$ select public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'suspended', '   ') $$, '22023', 'reason_required', 'Un motif vide ne compte pas');
select throws_ok($$ select public.admin_set_organization_status('71000000-0000-0000-0000-00000000dead', 'verified') $$, 'P0001', 'not_found', 'Organisation inconnue');
select is(public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'suspended', 'Motif zzsecret de suspension'), null, 'verified → suspended, avec motif');
select throws_ok($$ select public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'suspended', 'Encore') $$, '22023', 'invalid_transition', 'Suspendre deux fois : refusé');
select results_eq(
  $$ select status, suspension_reason from public.admin_list_organizations() where slug = 'orga-test-a' $$,
  $$ values ('suspended', 'Motif zzsecret de suspension') $$,
  'L''administration relit le motif de la suspension'
);
select throws_ok($$ select public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'verified') $$, '22023', 'reason_required', 'Rétablir une organisation suspendue exige un motif');
select is(public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'verified', 'Motif zzsecret de rétablissement'), null, 'suspended → verified, avec motif');
select is(
  (select suspension_reason from public.admin_list_organizations() where slug = 'orga-test-a'), null,
  'Rétablie, l''organisation n''affiche plus de motif'
);
reset role;
select results_eq(
  $$ select d.decision, d.reason, d.decided_by from private.organization_decisions d join tests.ids i on i.id = d.organization_id and i.label = 'a' order by d.id $$,
  $$ values ('suspended', 'Motif zzsecret de suspension', 'b0000000-0000-0000-0000-000000007101'::uuid),
            ('reinstated', 'Motif zzsecret de rétablissement', 'b0000000-0000-0000-0000-000000007101'::uuid) $$,
  'Suspension et rétablissement sont gardés, avec leur motif et leur auteur'
);

-- pending → suspended.
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
insert into tests.ids
select 'd', (public.admin_create_organization('{"name": "Organisation D du test", "slug": "orga-test-d"}') ->> 'id')::uuid;
select is(public.admin_set_organization_status((select id from tests.ids where label = 'd'), 'suspended', 'Motif zzsecret avant vérification'), null, 'pending → suspended');
reset role;

-- ---------------------------------------------------------------------------
-- Inviter le premier administrateur : jamais d'appartenance sans consentement
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok($$ select private.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'orga-p@test.invalid') $$, '42501', 'own_account', 'Un administrateur ne s''invite jamais lui-même');
select is(
  public.admin_invite_org_admin((select id from tests.ids where label = 'a'), ' ORGA-P@test.invalid ') ->> 'message',
  'own_account', 'Par l''API, le refus dit pourquoi'
);
select throws_ok($$ select public.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'pas-une-adresse') $$, '22023', 'invalid_payload', 'Adresse invalide : refusée');
select throws_ok($$ select public.admin_invite_org_admin('71000000-0000-0000-0000-00000000dead', 'orga-u@test.invalid') $$, 'P0001', 'not_found', 'Organisation inconnue');
select throws_ok($$ select private.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'orga-q@test.invalid') $$, '42501', 'forbidden', 'Une invitation de plateforme ne va pas à un administrateur de la plateforme');
select is(
  public.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'Orga-M@test.invalid') ->> 'message',
  'forbidden', 'Ni à une modératrice : aucun détenteur de rôle de plateforme'
);
insert into tests.tokens
select 'v', public.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'orga-v@test.invalid') ->> 'token';
select matches((select token from tests.tokens where label = 'v'), '^[0-9a-f]{64}$', 'L''invitation rend un jeton aléatoire, une seule fois');
reset role;
select is(
  (select count(*) from public.organization_members m join tests.ids i on i.id = m.organization_id and i.label = 'a'),
  0::bigint, 'Inviter ne crée aucune appartenance'
);

-- La personne invitée sans second facteur : refusée à l'acceptation.
select tests.login('e0000000-0000-0000-0000-000000007104');
select is(
  public.org_invitation_preview((select token from tests.tokens where label = 'v')),
  '{"organization_name": "Université du test 71", "role": "org_admin", "requires_second_factor": true}'::jsonb,
  'L''invitée voit l''organisation, le rôle, et qu''il lui faut un second facteur'
);
select throws_ok(
  $$ select public.accept_org_invitation((select token from tests.tokens where label = 'v')) $$,
  '42501', 'second_factor_missing', 'Sans second facteur, elle ne devient pas administratrice'
);
reset role;

-- Une seule invitation de plateforme en attente : la nouvelle révoque la précédente.
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select matches(
  public.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'inconnue-71@test.invalid') ->> 'token',
  '^[0-9a-f]{64}$', 'Une adresse sans compte reçoit la même réponse'
);
insert into tests.tokens
select 'r', public.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'orga-r@test.invalid') ->> 'token';
insert into tests.tokens
select 'u', public.admin_invite_org_admin((select id from tests.ids where label = 'a'), ' ORGA-U@test.invalid ') ->> 'token';
reset role;
select results_eq(
  $$ select v.email, v.role, v.issued_by_platform, v.created_by
     from public.organization_invitations v join tests.ids i on i.id = v.organization_id and i.label = 'a'
     where v.status = 'pending' $$,
  $$ values ('orga-u@test.invalid', 'org_admin', true, 'b0000000-0000-0000-0000-000000007101'::uuid) $$,
  'Une seule invitation de plateforme reste en attente, au rôle org_admin'
);
select is(
  (select count(*) from public.organization_invitations v join tests.ids i on i.id = v.organization_id and i.label = 'a'
   where v.status = 'revoked'),
  3::bigint, 'Les précédentes sont révoquées'
);
select is(
  (select count(*) from public.organization_invitations v, tests.tokens t where v::text like '%' || t.token || '%'),
  0::bigint, 'La base ne garde que l''empreinte du jeton'
);
select tests.login('d1000000-0000-0000-0000-000000007109', 'aal2', 10);
select is(public.accept_org_invitation((select token from tests.tokens where label = 'r')), null, 'Une invitation de plateforme remplacée ne s''accepte plus');
select is(public.accept_org_invitation((select token from tests.tokens where label = 'u')), null, 'Ni celle d''une autre adresse');
reset role;

select tests.login('d0000000-0000-0000-0000-000000007103', 'aal2', 10);
select is(
  public.accept_org_invitation((select token from tests.tokens where label = 'u')),
  (select id from tests.ids where label = 'a'), 'L''invité accepte : il devient le premier administrateur'
);
select ok(
  private.has_org_role((select id from tests.ids where label = 'a'), array['org_admin']),
  'Son rôle est effectif'
);
select is(public.accept_org_invitation((select token from tests.tokens where label = 'u')), null, 'Le jeton ne sert qu''une fois');
reset role;
select results_eq(
  $$ select m.user_id, m.role, m.invited_by from public.organization_members m join tests.ids i on i.id = m.organization_id and i.label = 'a' $$,
  $$ values ('d0000000-0000-0000-0000-000000007103'::uuid, 'org_admin', 'b0000000-0000-0000-0000-000000007101'::uuid) $$,
  'L''appartenance porte le rôle et l''auteur de l''invitation'
);

-- Organisation active et déjà administrée : la plateforme n'y invite plus.
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok(
  $$ select public.admin_invite_org_admin((select id from tests.ids where label = 'a'), 'orga-r@test.invalid') $$,
  'P0001', 'org_admin_exists', 'Une organisation active qui a un administrateur ne reçoit pas d''invitation de la plateforme'
);
reset role;
select results_eq(
  $$ select count(*), count(*) filter (where a.metadata = '{"recovery": false, "existing_admin_count": 0}'::jsonb and a.actor_id = 'b0000000-0000-0000-0000-000000007101')
     from public.audit_logs a join tests.ids i on i.id = a.organization_id and i.label = 'a'
     where a.action = 'organization.admin_invited' $$,
  $$ values (4::bigint, 4::bigint) $$,
  'Chaque invitation de plateforme est journalisée, sans adresse : premier administrateur, aucun en place'
);
select results_eq(
  $$ select a.actor_id, a.subject_user_id, a.metadata
     from public.audit_logs a join tests.ids i on i.id = a.organization_id and i.label = 'a'
     where a.action = 'organization.admin_invitation_accepted' $$,
  $$ values ('d0000000-0000-0000-0000-000000007103'::uuid, 'd0000000-0000-0000-0000-000000007103'::uuid,
             '{"issued_by": "b0000000-0000-0000-0000-000000007101", "recovery": false}'::jsonb) $$,
  'L''acceptation est journalisée : elle relie l''acceptant à l''émetteur'
);

-- À l'acceptation aussi : un compte qui a reçu entre-temps un rôle de plateforme.
insert into public.organizations (id, slug, name, status) values
  ('71000000-0000-0000-0000-0000000000a7', 'orga-reprise-g', 'Organisation G du test', 'pending');
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
insert into tests.tokens
select 'rd', public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a7', 'orga-r@test.invalid') ->> 'token';
select throws_ok(
  $$ select private.admin_invite_org_admin((select id from tests.ids where label = 'd'), 'orga-t1@test.invalid') $$,
  '42501', 'forbidden', 'Organisation suspendue, même sans aucun membre : c''est une reprise, fermée à un administrateur de plateforme'
);
reset role;
insert into public.platform_roles (user_id, role, granted_by)
values ('d1000000-0000-0000-0000-000000007109', 'moderator', 'b0000000-0000-0000-0000-000000007101');
select tests.login('d1000000-0000-0000-0000-000000007109', 'aal2', 10);
select throws_ok(
  $$ select public.accept_org_invitation((select token from tests.tokens where label = 'rd')) $$,
  '42501', 'forbidden', 'Un détenteur de rôle de plateforme n''accepte pas une invitation de plateforme'
);
reset role;
select is(
  (select count(*) from public.organization_members where user_id = 'd1000000-0000-0000-0000-000000007109'),
  0::bigint, 'Il n''est devenu membre de rien'
);

-- ---------------------------------------------------------------------------
-- Lister : des nombres, jamais la liste des membres
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select results_eq(
  $$ select slug, status, member_count, admin_count from public.admin_list_organizations(100, 0) where slug like 'orga-test-%' order by slug $$,
  $$ values ('orga-test-a', 'verified', 1::bigint, 1::bigint), ('orga-test-b', 'verified', 1::bigint, 0::bigint),
            ('orga-test-c', 'suspended', 0::bigint, 0::bigint), ('orga-test-d', 'suspended', 0::bigint, 0::bigint) $$,
  'La liste rend l''état et les effectifs'
);
select is((select count(*) from public.admin_list_organizations(1, 0)), 1::bigint, 'La liste se pagine');
select throws_ok($$ select * from public.admin_list_organizations(101, 0) $$, '22023', 'invalid_payload', 'Cent lignes au plus par appel');
select throws_ok($$ select * from public.admin_list_organizations(10, -1) $$, '22023', 'invalid_payload', 'Décalage négatif refusé');
select is_empty(
  $$ select 1 from public.organization_members m join tests.ids i on i.id = m.organization_id and i.label = 'a' $$,
  'L''administrateur de plateforme ne lit pas la liste des membres'
);
reset role;

-- ---------------------------------------------------------------------------
-- Renommer : nouvelle vérification exigée
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok($$ select public.admin_rename_organization((select id from tests.ids where label = 'a'), '{}') $$, '22023', 'invalid_payload', 'Renommer sans rien donner : refusé');
select throws_ok($$ select public.admin_rename_organization((select id from tests.ids where label = 'a'), '{"name": "Université du test 71"}') $$, '22023', 'invalid_payload', 'Renommer sans rien changer : refusé');
select throws_ok($$ select public.admin_rename_organization((select id from tests.ids where label = 'a'), '{"slug": "orga-test-b"}') $$, 'P0001', 'slug_taken', 'Un slug déjà pris est refusé');
select throws_ok($$ select public.admin_rename_organization((select id from tests.ids where label = 'a'), '{"slug": "Mauvais Slug"}') $$, '22023', 'invalid_payload', 'Un slug mal formé est refusé');
select throws_ok($$ select public.admin_rename_organization('71000000-0000-0000-0000-00000000dead', '{"name": "Inconnue"}') $$, 'P0001', 'not_found', 'Organisation inconnue');
select is(
  (select status from public.organizations o join tests.ids i on i.id = o.id and i.label = 'a'), 'verified',
  'Un renommage refusé ne touche pas à l''état'
);
select is(public.admin_rename_organization((select id from tests.ids where label = 'a'), '{"name": "Université renommée 71"}'), null, 'Le nom change');
select results_eq(
  $$ select o.name, o.slug, o.status from public.organizations o join tests.ids i on i.id = o.id and i.label = 'a' $$,
  $$ values ('Université renommée 71', 'orga-test-a', 'pending') $$,
  'Une organisation vérifiée renommée repasse à pending'
);
select is(public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'verified'), null, 'Elle se vérifie de nouveau');
select is(public.admin_rename_organization((select id from tests.ids where label = 'a'), '{"slug": "orga-test-a2"}'), null, 'Le slug change');
select results_eq(
  $$ select o.name, o.slug, o.status from public.organizations o join tests.ids i on i.id = o.id and i.label = 'a' $$,
  $$ values ('Université renommée 71', 'orga-test-a2', 'pending') $$,
  'Un changement de slug exige aussi une nouvelle vérification'
);
select is(public.admin_rename_organization((select id from tests.ids where label = 'd'), '{"name": "Organisation D renommée"}'), null, 'Une organisation suspendue se renomme');
select is(
  (select status from public.organizations o join tests.ids i on i.id = o.id and i.label = 'd'), 'suspended',
  'Elle reste suspendue : renommer ne rend aucun droit'
);
reset role;
-- Hors de la fonction de renommage, le slug reste figé, même pour le propriétaire.
select throws_ok(
  $$ update public.organizations set slug = 'orga-test-direct' where slug = 'orga-test-a2' $$,
  '42501', 'La colonne slug de public.organizations ne peut pas être modifiée.',
  'Le slug ne change pas par une écriture directe, même après un renommage dans la même transaction'
);

-- ---------------------------------------------------------------------------
-- Dissoudre
-- ---------------------------------------------------------------------------
-- Une invitation en attente et un second membre, pour voir ce qui part.
insert into public.organization_members (organization_id, user_id, role)
select id, 'e0000000-0000-0000-0000-000000007104', 'member' from tests.ids where label = 'a';
insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, created_by)
select id, 'invitee-71@test.invalid', 'member', repeat('71', 32), now() + interval '7 days', 'd0000000-0000-0000-0000-000000007103'
from tests.ids where label = 'a';

select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok($$ select public.admin_dissolve_organization((select id from tests.ids where label = 'a'), 'Motif zzsecret de dissolution') $$, '22023', 'invalid_transition', 'Une organisation non suspendue ne se dissout pas');
select is(public.admin_set_organization_status((select id from tests.ids where label = 'a'), 'suspended', 'Motif zzsecret avant dissolution'), null, 'Elle est d''abord suspendue');
select throws_ok($$ select public.admin_dissolve_organization((select id from tests.ids where label = 'a'), null) $$, '22023', 'reason_required', 'Une dissolution exige un motif');
select throws_ok($$ select public.admin_dissolve_organization('71000000-0000-0000-0000-00000000dead', 'Motif') $$, 'P0001', 'not_found', 'Organisation inconnue');
select throws_ok(
  $$ select public.admin_dissolve_organization('71000000-0000-0000-0000-0000000000c1', 'Motif zzsecret de dissolution') $$,
  'P0001', 'organization_has_resources', 'Une organisation qui porte encore une ressource ne se dissout pas'
);
select is(public.admin_dissolve_organization((select id from tests.ids where label = 'a'), 'Motif zzsecret de dissolution'), null, 'Une organisation suspendue et sans ressource se dissout');
reset role;

select is(
  (select count(*) from public.organizations o join tests.ids i on i.id = o.id and i.label = 'a'), 0::bigint,
  'L''organisation n''existe plus'
);
select is(
  (select count(*) from public.organization_members m join tests.ids i on i.id = m.organization_id and i.label = 'a'), 0::bigint,
  'Ses appartenances sont parties, dernier administrateur compris'
);
select is(
  (select count(*) from public.organization_invitations v join tests.ids i on i.id = v.organization_id and i.label = 'a'), 0::bigint,
  'Ses invitations aussi'
);
select is(
  (select d.reason from private.organization_decisions d join tests.ids i on i.id = d.organization_id and i.label = 'a' where d.decision = 'dissolved'),
  'Motif zzsecret de dissolution', 'Le motif de la dissolution survit à l''organisation'
);
select is(
  (select count(*) from public.resources where id = '71000000-0000-0000-0000-000000000001' and organization_id = '71000000-0000-0000-0000-0000000000c1'),
  1::bigint, 'La ressource de l''organisation non dissoute garde sa provenance'
);
select is(
  (select count(*) from public.organizations where id = '71000000-0000-0000-0000-0000000000c1'), 1::bigint,
  'Et son organisation existe toujours'
);
-- Hors dissolution, la règle du dernier administrateur tient toujours.
insert into public.organization_members (organization_id, user_id, role) values
  ('71000000-0000-0000-0000-0000000000b1', 'd1000000-0000-0000-0000-000000007109', 'org_admin');
select throws_ok(
  $$ delete from public.organization_members where organization_id = '71000000-0000-0000-0000-0000000000b1' and role = 'org_admin' $$,
  '23514', null, 'Après une dissolution, le dernier administrateur d''une autre organisation reste protégé'
);

-- ---------------------------------------------------------------------------
-- Reprise d'une organisation dont l'administratrice n'est plus joignable
-- ---------------------------------------------------------------------------
-- Organisation E : M en est la seule administratrice, U un simple membre. Une
-- invitation ordinaire y attend U.
insert into public.organizations (id, slug, name, status) values
  ('71000000-0000-0000-0000-0000000000e1', 'orga-reprise-e', 'Organisation E du test', 'verified');
insert into public.organization_members (organization_id, user_id, role, invited_by) values
  ('71000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-000000007108', 'org_admin', null),
  ('71000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-000000007103', 'member', 'c0000000-0000-0000-0000-000000007108');
insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, created_by)
values ('71000000-0000-0000-0000-0000000000e1', 'orga-u@test.invalid', 'member',
        encode(sha256(convert_to(repeat('e', 64), 'UTF8')), 'hex'), now() + interval '7 days', 'c0000000-0000-0000-0000-000000007108');

-- Un administrateur de plateforme seul n'enchaîne pas suspension et invitation.
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok(
  $$ select public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000e1', 'orga-u@test.invalid') $$,
  'P0001', 'org_admin_exists', 'Tant que l''organisation est active, la plateforme n''y invite pas d''administrateur'
);
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'suspended', 'Motif zzsecret de reprise'), null, 'Un administrateur de plateforme la suspend, avec un motif');
select throws_ok(
  $$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000e1', 'orga-u@test.invalid') $$,
  '42501', 'forbidden', 'Il n''y invite pas pour autant un administrateur : la reprise est réservée au super-administrateur'
);
select is(
  public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000e1', 'orga-u@test.invalid') ->> 'message',
  'forbidden', 'Par l''API, le refus est rendu en 403'
);
reset role;
select is(
  (select count(*) from public.organization_invitations
   where organization_id = '71000000-0000-0000-0000-0000000000e1' and issued_by_platform),
  0::bigint, 'Aucune invitation de plateforme n''a été créée'
);

-- Le super-administrateur qui a suspendu n'invite pas non plus.
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select throws_ok($$ select public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified') $$, '22023', 'reason_required', 'Rétablir exige un motif');
select throws_ok($$ select public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified', '  ') $$, '22023', 'reason_required', 'Un motif vide ne compte pas');
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified', 'Motif zzsecret de retour'), null, 'S1 la rétablit, avec un motif');
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'suspended', 'Motif zzsecret de seconde suspension'), null, 'Puis la suspend lui-même');
select throws_ok(
  $$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000e1', 'orga-u@test.invalid') $$,
  '42501', 'forbidden', 'Le super-administrateur qui a prononcé la suspension en cours n''invite pas l''administrateur de reprise'
);
reset role;

-- Un autre super-administrateur le peut, même si le compteur des invitations
-- ordinaires vers cette adresse a été saturé par un administrateur d'organisation.
insert into private.rate_limit_buckets (bucket_key, window_start, hits)
values ('org-invite:to:' || left(encode(sha256(convert_to('org-invite:orga-u@test.invalid', 'UTF8')), 'hex'), 40),
        date_trunc('day', now(), 'UTC'), 3)
on conflict (bucket_key, window_start) do update set hits = 3;
select tests.login('a1000000-0000-0000-0000-000000007111', 'aal2', 30);
insert into tests.tokens
select 'e', public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000e1', 'orga-u@test.invalid') ->> 'token';
select matches((select token from tests.tokens where label = 'e'), '^[0-9a-f]{64}$', 'Un autre super-administrateur invite l''administrateur de reprise ; le compteur d''adresse n''est pas partagé');
select throws_ok(
  $$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified', 'Motif zzsecret') $$,
  '42501', 'forbidden', 'Celui qui a émis l''invitation de reprise, encore en attente, ne rétablit pas l''organisation'
);
reset role;
select results_eq(
  $$ select a.actor_id, a.metadata from public.audit_logs a
     where a.action = 'organization.admin_invited' and a.organization_id = '71000000-0000-0000-0000-0000000000e1' $$,
  $$ values ('a1000000-0000-0000-0000-000000007111'::uuid, '{"recovery": true, "existing_admin_count": 1}'::jsonb) $$,
  'Le journal dit que c''est une reprise, et qu''un administrateur était en place'
);
select is(
  (select status from public.organization_invitations where token_hash = encode(sha256(convert_to(repeat('e', 64), 'UTF8')), 'hex')),
  'pending', 'L''invitation ordinaire n''est pas touchée par celle de la plateforme'
);

-- Accepter un rôle d'administrateur exige le second facteur présenté.
select tests.login('d0000000-0000-0000-0000-000000007103', 'aal1');
select throws_ok(
  $$ select public.accept_org_invitation((select token from tests.tokens where label = 'e')) $$,
  '42501', 'forbidden', 'En session aal1, l''invitation au rôle org_admin ne s''accepte pas'
);
reset role;
select tests.login('d0000000-0000-0000-0000-000000007103', 'aal2', 10);
select is(public.org_invitation_preview(repeat('e', 64)), null, 'Organisation suspendue : l''invitation ordinaire ne se voit pas');
select is(public.accept_org_invitation(repeat('e', 64)), null, 'Ni ne s''accepte');
select is(
  public.org_invitation_preview((select token from tests.tokens where label = 'e')) ->> 'role',
  'org_admin', 'L''invitation de plateforme, elle, se voit'
);
select is(
  public.accept_org_invitation((select token from tests.tokens where label = 'e')),
  '71000000-0000-0000-0000-0000000000e1'::uuid, 'Et s''accepte dans l''organisation suspendue : c''est le chemin de reprise'
);
select ok(
  not private.has_org_role('71000000-0000-0000-0000-0000000000e1', array['org_admin']),
  'Tant que l''organisation est suspendue, le nouveau rôle ne donne aucun droit'
);
reset role;
select results_eq(
  $$ select user_id, role, invited_by from public.organization_members
     where organization_id = '71000000-0000-0000-0000-0000000000e1' order by user_id $$,
  $$ values ('c0000000-0000-0000-0000-000000007108'::uuid, 'org_admin', null::uuid),
            ('d0000000-0000-0000-0000-000000007103'::uuid, 'org_admin', 'a1000000-0000-0000-0000-000000007111'::uuid) $$,
  'L''ancienne administratrice le reste ; le membre promu porte désormais l''émetteur de l''invitation'
);

-- L'émetteur de la reprise ne rétablit pas ; un autre, si.
select tests.login('a1000000-0000-0000-0000-000000007111', 'aal2', 30);
select throws_ok(
  $$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified', 'Motif zzsecret') $$,
  '42501', 'forbidden', 'Invitation de reprise acceptée depuis moins de trente jours : son émetteur ne rétablit pas'
);
select is(
  public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified', 'Motif zzsecret') ->> 'message',
  'forbidden', 'Par l''API, le refus est rendu en 403'
);
reset role;
select is(
  (select status from public.organizations where id = '71000000-0000-0000-0000-0000000000e1'),
  'suspended', 'L''organisation est toujours suspendue'
);
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select results_eq(
  $$ select status, recovery_since_suspension from public.admin_list_organizations(100, 0) where slug = 'orga-reprise-e' $$,
  $$ values ('suspended', true) $$,
  'Celui qui va rétablir voit qu''une invitation de reprise a été émise depuis la suspension'
);
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000e1', 'verified', 'Motif zzsecret de fin de reprise'), null, 'Un autre super-administrateur rétablit l''organisation');
reset role;
select tests.login('d0000000-0000-0000-0000-000000007103', 'aal2', 10);
select ok(
  private.has_org_role('71000000-0000-0000-0000-0000000000e1', array['org_admin']),
  'Rétablie, le nouvel administrateur l''administre'
);
reset role;
select tests.login('c0000000-0000-0000-0000-000000007108', 'aal2', 10);
select ok(
  private.has_org_role('71000000-0000-0000-0000-0000000000e1', array['org_admin']),
  'Et l''ancienne aussi'
);
select is(
  public.org_members('71000000-0000-0000-0000-0000000000e1') ->> 'platform_invitation_pending',
  'false', 'Plus aucune invitation de plateforme n''attend'
);
reset role;

-- Le lien entre l'émetteur et l'appartenance survit à la purge de l'invitation.
update public.organization_invitations
set created_at = now() - interval '40 days', expires_at = now() - interval '33 days'
where organization_id = '71000000-0000-0000-0000-0000000000e1' and issued_by_platform;
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select private.purge_stale_org_invitations() $$, 'La purge passe');
select is(
  (select count(*) from public.organization_invitations
   where organization_id = '71000000-0000-0000-0000-0000000000e1' and issued_by_platform),
  0::bigint, 'L''invitation de reprise est effacée'
);
select results_eq(
  $$ select a.actor_id, a.subject_user_id, a.metadata from public.audit_logs a
     where a.action = 'organization.admin_invitation_accepted' and a.organization_id = '71000000-0000-0000-0000-0000000000e1' $$,
  $$ values ('d0000000-0000-0000-0000-000000007103'::uuid, 'd0000000-0000-0000-0000-000000007103'::uuid,
             '{"issued_by": "a1000000-0000-0000-0000-000000007111", "recovery": true}'::jsonb) $$,
  'Le journal relie toujours l''acceptant à l''émetteur, et dit que c''était une reprise'
);
select is(
  (select invited_by from public.organization_members
   where organization_id = '71000000-0000-0000-0000-0000000000e1' and user_id = 'd0000000-0000-0000-0000-000000007103'),
  'a1000000-0000-0000-0000-000000007111'::uuid, 'L''appartenance aussi'
);

select results_eq(
  $$ select a.actor_id, a.metadata from public.audit_logs a
     where a.action = 'organization.reinstated' and a.organization_id = '71000000-0000-0000-0000-0000000000e1' order by a.id $$,
  $$ values ('a0000000-0000-0000-0000-000000007110'::uuid, '{"after_recovery": false}'::jsonb),
            ('a0000000-0000-0000-0000-000000007110'::uuid, '{"after_recovery": true}'::jsonb) $$,
  'Le journal dit si un rétablissement suit une reprise'
);

-- Période d'observation de l'administrateur de reprise.
select ok(
  (select recovery_until between now() + interval '29 days' and now() + interval '31 days'
   from public.organization_members
   where organization_id = '71000000-0000-0000-0000-0000000000e1' and user_id = 'd0000000-0000-0000-0000-000000007103'),
  'L''administrateur de reprise est en observation trente jours'
);
select is(
  (select count(*) from public.organization_members where recovery_until is not null
     and organization_id <> '71000000-0000-0000-0000-0000000000e1' and user_id::text like '%-0000000071__'),
  0::bigint, 'Personne d''autre ne l''est'
);
select ok(
  not has_column_privilege('authenticated', 'public.organization_members', 'recovery_until', 'select')
  and not has_column_privilege('authenticated', 'public.organization_members', 'recovery_until', 'update')
  and not has_column_privilege('anon', 'public.organization_members', 'recovery_until', 'select')
  and not has_column_privilege('service_role', 'public.organization_members', 'recovery_until', 'update'),
  'L''échéance ne se lit pas par les comptes et ne s''écrit par aucun rôle de l''API'
);
select tests.login('d0000000-0000-0000-0000-000000007103', 'aal2', 10);
select throws_ok(
  $$ select public.set_org_member_role('71000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-000000007108', 'member') $$,
  '42501', 'forbidden', 'En observation, il ne rétrograde pas l''administratrice qui l''était avant lui'
);
select throws_ok(
  $$ select public.remove_org_member('71000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-000000007108') $$,
  '42501', 'forbidden', 'Ni ne la retire'
);
select matches(
  public.invite_org_member('71000000-0000-0000-0000-0000000000e1', '{"email": "nouveau-e@test.invalid", "role": "member"}'),
  '^[0-9a-f]{64}$', 'Les autres opérations lui restent ouvertes'
);
select is(
  jsonb_array_length(public.org_members('71000000-0000-0000-0000-0000000000e1') -> 'members'), 2,
  'Dont la lecture des membres'
);
reset role;
update public.organization_members set recovery_until = now() - interval '1 minute'
where organization_id = '71000000-0000-0000-0000-0000000000e1' and user_id = 'd0000000-0000-0000-0000-000000007103';
select tests.login('d0000000-0000-0000-0000-000000007103', 'aal2', 10);
select lives_ok(
  $$ select public.set_org_member_role('71000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-000000007108', 'member') $$,
  'La période passée, il le peut'
);
reset role;

-- ---------------------------------------------------------------------------
-- La reprise se définit par l'état : suspendue, zéro administrateur, un membre
-- ---------------------------------------------------------------------------
-- Organisation H : V administratrice, N membre.
insert into public.organizations (id, slug, name, status) values
  ('71000000-0000-0000-0000-0000000000a8', 'orga-reprise-h', 'Organisation H du test', 'verified');
insert into public.organization_members (organization_id, user_id, role) values
  ('71000000-0000-0000-0000-0000000000a8', 'e0000000-0000-0000-0000-000000007104', 'org_admin'),
  ('71000000-0000-0000-0000-0000000000a8', 'e1000000-0000-0000-0000-000000007105', 'member');
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000a8', 'suspended', 'Motif zzsecret pour H'), null, 'S1 suspend l''organisation H');
reset role;
select tests.login('e0000000-0000-0000-0000-000000007104');
select lives_ok($$ select public.leave_organization('71000000-0000-0000-0000-0000000000a8') $$, 'Sa dernière administratrice la quitte');
reset role;
select results_eq(
  $$ select count(*), count(*) filter (where role = 'org_admin') from public.organization_members
     where organization_id = '71000000-0000-0000-0000-0000000000a8' $$,
  $$ values (1::bigint, 0::bigint) $$,
  'Il reste un membre, et aucun administrateur'
);
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok(
  $$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a8', 'reprise-h@test.invalid') $$,
  '42501', 'forbidden', 'Suspendue et sans administrateur : ce n''est pas un « premier administrateur », un administrateur de plateforme est refusé'
);
reset role;
-- Un renommage pendant la suspension ne change pas l'auteur de celle-ci.
select tests.login('a1000000-0000-0000-0000-000000007111', 'aal2', 30);
select is(public.admin_rename_organization('71000000-0000-0000-0000-0000000000a8', '{"name": "Organisation H renommée"}'), null, 'S2 renomme l''organisation suspendue');
reset role;
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select throws_ok(
  $$ select private.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a8', 'reprise-h@test.invalid') $$,
  '42501', 'forbidden', 'L''auteur de la suspension reste refusé, même après un renommage par un autre'
);
reset role;
select tests.login('a1000000-0000-0000-0000-000000007111', 'aal2', 30);
insert into tests.tokens
select 'h', public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a8', 'reprise-h@test.invalid') ->> 'token';
select matches((select token from tests.tokens where label = 'h'), '^[0-9a-f]{64}$', 'Un autre super-administrateur invite');
select throws_ok(
  $$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000a8', 'verified', 'Motif zzsecret') $$,
  '42501', 'forbidden', 'L''émetteur ne rétablit pas'
);
reset role;
select results_eq(
  $$ select a.metadata from public.audit_logs a
     where a.action = 'organization.admin_invited' and a.organization_id = '71000000-0000-0000-0000-0000000000a8' $$,
  $$ values ('{"recovery": true, "existing_admin_count": 0}'::jsonb) $$,
  'Le journal dit que c''est une reprise, sans administrateur en place'
);
-- Plus de trente jours, invitation purgée : l'interdit tient toujours.
update public.organization_invitations
set created_at = now() - interval '45 days', expires_at = now() - interval '38 days'
where organization_id = '71000000-0000-0000-0000-0000000000a8';
update private.organization_decisions set decided_at = now() - interval '45 days'
where organization_id = '71000000-0000-0000-0000-0000000000a8';
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select private.purge_stale_org_invitations() $$, 'La purge passe');
select is(
  (select count(*) from public.organization_invitations where organization_id = '71000000-0000-0000-0000-0000000000a8'),
  0::bigint, 'L''invitation de reprise est effacée'
);
select tests.login('a1000000-0000-0000-0000-000000007111', 'aal2', 30);
select throws_ok(
  $$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000a8', 'verified', 'Motif zzsecret') $$,
  '42501', 'forbidden', 'Après la purge de l''invitation et plus de trente jours, l''émetteur ne rétablit toujours pas'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select results_eq(
  $$ select status, recovery_since_suspension from public.admin_list_organizations(100, 0) where slug = 'orga-reprise-h' $$,
  $$ values ('suspended', true) $$,
  'Un tiers voit qu''une reprise a été engagée depuis la suspension'
);
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000a8', 'verified', 'Motif zzsecret de retour de H'), null, 'Et rétablit l''organisation');
select is(
  (select recovery_since_suspension from public.admin_list_organizations(100, 0) where slug = 'orga-reprise-h'),
  false, 'Rétablie, elle n''affiche plus ce signal'
);
reset role;
select results_eq(
  $$ select a.actor_id, a.metadata from public.audit_logs a
     where a.action = 'organization.reinstated' and a.organization_id = '71000000-0000-0000-0000-0000000000a8' $$,
  $$ values ('a0000000-0000-0000-0000-000000007110'::uuid, '{"after_recovery": true}'::jsonb) $$,
  'Le journal dit que ce rétablissement suit une reprise'
);
-- Active, un membre, aucun administrateur : il faut d'abord suspendre.
select tests.login('a1000000-0000-0000-0000-000000007111', 'aal2', 30);
select throws_ok(
  $$ select public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a8', 'reprise-h@test.invalid') $$,
  '22023', 'invalid_transition', 'Organisation active avec des membres mais sans administrateur : la reprise exige d''abord une suspension'
);
reset role;
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
select throws_ok(
  $$ select public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a8', 'reprise-h@test.invalid') $$,
  '22023', 'invalid_transition', 'Pour un administrateur de plateforme aussi'
);
reset role;

-- Auteur de la suspension inconnu : la reprise reste possible ; la purge garde
-- ce qui fonde les règles.
insert into public.organizations (id, slug, name, status) values
  ('71000000-0000-0000-0000-0000000000a9', 'orga-reprise-i', 'Organisation I du test', 'suspended');
insert into public.organization_members (organization_id, user_id, role) values
  ('71000000-0000-0000-0000-0000000000a9', 'e1000000-0000-0000-0000-000000007105', 'member');
insert into private.organization_decisions (organization_id, decision, reason, decided_by, decided_at) values
  ('71000000-0000-0000-0000-0000000000a9', 'reinstated', 'Ancienne décision close', null, now() - interval '4 years');
insert into private.organization_decisions (organization_id, decision, reason, decided_by, decided_at) values
  ('71000000-0000-0000-0000-0000000000a9', 'suspended', 'Ancienne suspension en cours', null, now() - interval '4 years');
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select matches(
  public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000a9', 'reprise-i@test.invalid') ->> 'token',
  '^[0-9a-f]{64}$', 'Auteur de la suspension supprimé : un super-administrateur peut reprendre'
);
reset role;
update private.organization_decisions set decided_at = now() - interval '4 years'
where organization_id = '71000000-0000-0000-0000-0000000000a9';
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select private.purge_stale_org_invitations() $$, 'La purge passe');
select results_eq(
  $$ select decision from private.organization_decisions
     where organization_id = '71000000-0000-0000-0000-0000000000a9' order by id $$,
  $$ values ('suspended'), ('recovery_invited') $$,
  'La purge garde la suspension en cours et l''invitation de reprise qui l''a suivie, pas la décision close'
);

-- Premier administrateur d'une organisation neuve, puis elle devient une reprise.
insert into public.organizations (id, slug, name, status) values
  ('71000000-0000-0000-0000-0000000000af', 'orga-reprise-f', 'Organisation F du test', 'pending');
select tests.login('b0000000-0000-0000-0000-000000007101', 'aal2', 30);
insert into tests.tokens
select 'f', public.admin_invite_org_admin('71000000-0000-0000-0000-0000000000af', 'orga-t1@test.invalid') ->> 'token';
select matches((select token from tests.tokens where label = 'f'), '^[0-9a-f]{64}$', 'Organisation neuve et sans membre : un administrateur de plateforme invite toujours son premier administrateur');
reset role;
select is(
  (select count(*) from private.organization_decisions
   where organization_id = '71000000-0000-0000-0000-0000000000af'),
  0::bigint, 'Ce n''est pas une reprise : aucune décision n''est gardée'
);
select tests.login('a0000000-0000-0000-0000-000000007110', 'aal2', 30);
select is(public.admin_set_organization_status('71000000-0000-0000-0000-0000000000af', 'suspended', 'Motif zzsecret pour F'), null, 'L''organisation est suspendue avant l''acceptation');
reset role;
select tests.login('d2000000-0000-0000-0000-000000007112', 'aal2', 10);
select is(
  public.accept_org_invitation((select token from tests.tokens where label = 'f')), null,
  'Invitation « premier administrateur » devenue une reprise : elle ne s''accepte pas, même réponse vide'
);
reset role;
select is(
  (select status from public.organization_invitations where organization_id = '71000000-0000-0000-0000-0000000000af'),
  'revoked', 'Elle est révoquée'
);
select is(
  (select count(*) from public.organization_members where organization_id = '71000000-0000-0000-0000-0000000000af'),
  0::bigint, 'Et personne n''est entré'
);

-- Quitter une organisation, puis l'administrer au nom de la plateforme : refusé trente jours.
select tests.login('b1000000-0000-0000-0000-000000007102', 'aal2', 10);
select lives_ok($$ select public.leave_organization('71000000-0000-0000-0000-0000000000b1') $$, 'L''administrateur de plateforme quitte l''organisation B');
select throws_ok(
  $$ select private.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Organisation B renommée"}') $$,
  '42501', 'own_organization', 'Il ne l''administre pas aussitôt après l''avoir quittée'
);
select throws_ok(
  $$ select private.admin_set_organization_status('71000000-0000-0000-0000-0000000000b1', 'suspended', 'Abus') $$,
  '42501', 'own_organization', 'Ni ne la suspend'
);
reset role;
update private.organization_departures set left_at = now() - interval '31 days'
where organization_id = '71000000-0000-0000-0000-0000000000b1' and user_id = 'b1000000-0000-0000-0000-000000007102';
select tests.login('b1000000-0000-0000-0000-000000007102', 'aal2', 10);
select is(
  public.admin_rename_organization('71000000-0000-0000-0000-0000000000b1', '{"name": "Organisation B renommée"}'),
  null, 'Trente jours après son départ, il le peut'
);
reset role;

-- ---------------------------------------------------------------------------
-- Journal d'audit : ni motif, ni adresse
-- ---------------------------------------------------------------------------
select isnt_empty(
  $$ select 1 from public.audit_logs a join tests.ids i on i.id = a.organization_id and i.label = 'a'
     where a.action = 'organizations.update' and a.actor_id = 'b0000000-0000-0000-0000-000000007101'
       and a.metadata -> 'status' ->> 'new' = 'suspended' $$,
  'La suspension est journalisée avec son auteur'
);
select isnt_empty(
  $$ select 1 from public.audit_logs a join tests.ids i on i.id = a.organization_id and i.label = 'a'
     where a.action = 'organizations.delete' and a.actor_id = 'b0000000-0000-0000-0000-000000007101' $$,
  'La dissolution aussi'
);
select isnt_empty(
  $$ select 1 from public.audit_logs a join tests.ids i on i.id = a.organization_id and i.label = 'a'
     where a.action = 'organization_members.insert' and a.subject_user_id = 'd0000000-0000-0000-0000-000000007103'
       and a.actor_id = 'd0000000-0000-0000-0000-000000007103' and a.metadata ->> 'role' = 'org_admin' $$,
  'L''entrée de l''administrateur invité aussi, à son propre nom'
);
select is(
  (select count(*) from public.audit_logs a
   where (a.organization_id in (select id from tests.ids)
          or a.organization_id in ('71000000-0000-0000-0000-0000000000b1', '71000000-0000-0000-0000-0000000000c1', '71000000-0000-0000-0000-0000000000e1')
          or a.actor_id::text like '%-0000000071__')
     and (a.metadata::text ~* 'zzsecret|@|motif' or coalesce(a.target_id, '') ~ '@')),
  0::bigint, 'Le journal ne porte ni motif ni adresse'
);

-- ---------------------------------------------------------------------------
-- Suppression du compte de l'administrateur : jamais bloquée par ses décisions
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$ delete from auth.users where id = 'b0000000-0000-0000-0000-000000007101' $$,
  'Le compte d''un administrateur de plateforme se supprime'
);
select is(
  (select count(*) from private.organization_decisions d where d.decided_by = 'b0000000-0000-0000-0000-000000007101'),
  0::bigint, 'Ses décisions ne portent plus son identifiant'
);
select is(
  (select count(*) from private.organization_decisions d join tests.ids i on i.id = d.organization_id and d.decided_by is null),
  5::bigint, 'Elles restent'
);

select * from finish();
rollback;
