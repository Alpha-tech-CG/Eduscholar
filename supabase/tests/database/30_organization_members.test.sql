-- D-01, D-04 : membres et invitations d'une organisation.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

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
create table tests.tokens (label text primary key, token text);

-- Les quatre opérations réservées à l'administrateur de l'organisation 1,
-- tentées par l'appelant courant : toutes doivent être refusées de même.
create function tests.org1_refusals(p_who text)
returns setof text language plpgsql as $$
begin
  return next throws_ok(
    $q$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "refus-72@test.invalid", "role": "member"}') $q$,
    '42501', 'forbidden', p_who || ' n''invite pas dans l''organisation 1');
  return next throws_ok(
    $q$ select public.org_members('72000000-0000-0000-0000-0000000000a1') $q$,
    '42501', 'forbidden', p_who || ' ne lit pas la liste de ses membres');
  return next throws_ok(
    $q$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205', 'org_admin') $q$,
    '42501', 'forbidden', p_who || ' n''y change aucun rôle');
  return next throws_ok(
    $q$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205') $q$,
    '42501', 'forbidden', p_who || ' n''en retire personne');
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant all on tests.tokens to authenticated;

-- Organisation 1 : A administratrice, L bibliothécaire, T enseignant, M membre.
-- Organisation 2 : B administrateur, B2 second administrateur.
-- Organisation 3, suspendue : S administratrice, M3 membre.
-- U, X, Y, N, O : invités (X a un second facteur, Y non, N n'a pas confirmé son
-- adresse, O n'a pas complété son profil) ; Z : tiers ; P : administrateur de plateforme, membre de rien.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000007201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-a@test.invalid', now()),
  ('a1000000-0000-0000-0000-000000007202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-b@test.invalid', now()),
  ('a2000000-0000-0000-0000-000000007203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-l@test.invalid', now()),
  ('a3000000-0000-0000-0000-000000007204', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-t@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000007205', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-m@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000007206', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Membres-U@test.invalid', now()),
  ('d1000000-0000-0000-0000-000000007207', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-x@test.invalid', now()),
  ('d2000000-0000-0000-0000-000000007208', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-y@test.invalid', now()),
  ('d3000000-0000-0000-0000-000000007209', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-n@test.invalid', null),
  ('e0000000-0000-0000-0000-000000007210', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-z@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000007211', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-p@test.invalid', now()),
  ('a4000000-0000-0000-0000-000000007212', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-b2@test.invalid', now()),
  ('a5000000-0000-0000-0000-000000007213', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-s@test.invalid', now()),
  ('c1000000-0000-0000-0000-000000007214', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-m3@test.invalid', now()),
  ('d4000000-0000-0000-0000-000000007215', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'membres-o@test.invalid', now());
-- O garde un profil non complété.
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-0000000072__' and user_id <> 'd4000000-0000-0000-0000-000000007215';

-- Second facteur : les administrateurs, X et P.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select ('fa000000-0000-0000-0000-00000000' || right(id::text, 4))::uuid, id, 'test', 'totp', 'verified',
       now() - interval '1 day', now(), 'secret-de-test'
from auth.users
where email in ('membres-a@test.invalid', 'membres-b@test.invalid', 'membres-b2@test.invalid',
                'membres-s@test.invalid', 'membres-x@test.invalid', 'membres-p@test.invalid');
insert into public.platform_roles (user_id, role) values ('b0000000-0000-0000-0000-000000007211', 'platform_admin');

insert into public.organizations (id, slug, name, status) values
  ('72000000-0000-0000-0000-0000000000a1', 'membres-test-1', 'Organisation 1 du test', 'verified'),
  ('72000000-0000-0000-0000-0000000000a2', 'membres-test-2', 'Organisation 2 du test', 'pending'),
  ('72000000-0000-0000-0000-0000000000a3', 'membres-test-3', 'Organisation 3 du test', 'suspended');
insert into public.organization_members (organization_id, user_id, role) values
  ('72000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000007201', 'org_admin'),
  ('72000000-0000-0000-0000-0000000000a1', 'a2000000-0000-0000-0000-000000007203', 'librarian'),
  ('72000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-000000007204', 'teacher'),
  ('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205', 'member'),
  ('72000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-000000007202', 'org_admin'),
  ('72000000-0000-0000-0000-0000000000a2', 'a4000000-0000-0000-0000-000000007212', 'org_admin'),
  ('72000000-0000-0000-0000-0000000000a3', 'a5000000-0000-0000-0000-000000007213', 'org_admin'),
  ('72000000-0000-0000-0000-0000000000a3', 'c1000000-0000-0000-0000-000000007214', 'member');

-- ---------------------------------------------------------------------------
-- Aucun droit direct de table
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege(r, 'public.organization_invitations', p)),
  0::bigint, 'Les invitations ne se lisent ni ne s''écrivent directement'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.organization_invitations'::regclass),
  'La RLS y est activée et forcée'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_invitations' $$,
  'Sans aucune politique : seules les fonctions y accèdent'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'private.organization_departures', 'select,insert,update,delete')),
  0::bigint, 'La trace des départs ne se lit ni ne s''écrit directement'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.organizations', 'public.organization_members']) t,
     unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege(r, t, p)),
  0::bigint, 'Aucun rôle de l''API n''écrit dans organizations ni organization_members'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('invite_org_member', 'revoke_org_invitation', 'set_org_member_role', 'remove_org_member',
                       'org_members', 'org_invitation_preview', 'accept_org_invitation', 'leave_organization',
                       'my_organizations', 'my_organization_memberships', 'require_org_admin',
                       'matching_org_invitation', 'purge_stale_org_invitations')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni un visiteur ni le rôle serveur n''exécutent ces fonctions'
);

select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
select throws_ok($$ select 1 from public.organization_invitations $$, '42501', null, 'Même l''administratrice ne lit pas la table des invitations');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role) values ('72000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000007210', 'member') $$,
  '42501', null, 'Ni n''ajoute un membre sans son consentement'
);
select throws_ok($$ update public.organization_members set role = 'org_admin' $$, '42501', null, 'Ni ne change un rôle par la table');
select throws_ok($$ delete from public.organization_members $$, '42501', null, 'Ni ne retire un membre par la table');
reset role;

-- ---------------------------------------------------------------------------
-- Matrice §5.5 : seul l'org_admin de CETTE organisation
-- ---------------------------------------------------------------------------
select tests.login('e0000000-0000-0000-0000-000000007210');
select tests.org1_refusals('Un utilisateur');
reset role;
select tests.login('c0000000-0000-0000-0000-000000007205');
select tests.org1_refusals('Un membre');
reset role;
select tests.login('a3000000-0000-0000-0000-000000007204');
select tests.org1_refusals('Un enseignant');
reset role;
select tests.login('a2000000-0000-0000-0000-000000007203');
select tests.org1_refusals('Une bibliothécaire');
reset role;
select tests.login('a1000000-0000-0000-0000-000000007202', 'aal2', 10);
select tests.org1_refusals('L''administrateur d''une autre organisation');
reset role;
select tests.login('b0000000-0000-0000-0000-000000007211', 'aal2', 10);
select tests.org1_refusals('Un administrateur de plateforme');
reset role;
-- L'administratrice elle-même, sans second facteur présenté.
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal1');
select tests.org1_refusals('L''administratrice en aal1');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "refus-72@test.invalid", "role": "member"}') $$,
  '42501', null, 'Le rôle serveur n''invite pas'
);
select throws_ok(
  $$ select private.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205') $$,
  '42501', null, 'Ni ne retire un membre par les fonctions'
);
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.accept_org_invitation(repeat('a', 64)) $$, '42501', null, 'Un visiteur n''accepte aucune invitation');
select throws_ok($$ select * from public.my_organizations() $$, '42501', null, 'Ni ne lit d''appartenance');
reset role;

-- Organisation suspendue : plus aucun droit, même pour son administratrice.
select tests.login('a5000000-0000-0000-0000-000000007213', 'aal2', 10);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a3', '{"email": "refus-72@test.invalid", "role": "member"}') $$,
  '42501', 'forbidden', 'Organisation suspendue : son administratrice n''invite plus'
);
select throws_ok($$ select public.org_members('72000000-0000-0000-0000-0000000000a3') $$, '42501', 'forbidden', 'Ni ne lit ses membres');
select throws_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a3', 'c1000000-0000-0000-0000-000000007214', 'teacher') $$,
  '42501', 'forbidden', 'Ni ne change un rôle'
);
select throws_ok(
  $$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a3', 'c1000000-0000-0000-0000-000000007214') $$,
  '42501', 'forbidden', 'Ni ne retire un membre'
);
select results_eq(
  $$ select slug, status, role from public.my_organizations() $$,
  $$ values ('membres-test-3', 'suspended', 'org_admin') $$,
  'Elle voit toujours son appartenance, et l''état de l''organisation'
);
reset role;
select is(
  (select count(*) from public.organization_invitations where organization_id::text like '72000000-%'), 0::bigint,
  'Aucune de ces tentatives n''a créé d''invitation'
);
select is(
  (select count(*) from public.organization_members where organization_id::text like '72000000-%'), 8::bigint,
  'Ni touché aux appartenances'
);

-- ---------------------------------------------------------------------------
-- Inviter
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
insert into tests.tokens
select 'u', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": " MEMBRES-U@test.invalid ", "role": "teacher"}');
select matches((select token from tests.tokens where label = 'u'), '^[0-9a-f]{64}$', 'L''invitation rend un jeton aléatoire');
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-a@test.invalid", "role": "member"}') $$,
  '42501', 'own_account', 'On ne s''invite pas soi-même'
);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "pas-une-adresse", "role": "member"}') $$,
  '22023', 'invalid_payload', 'Adresse invalide : refusée'
);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "x-72@test.invalid", "role": "platform_admin"}') $$,
  '22023', 'invalid_payload', 'Un rôle hors de l''organisation ne s''attribue pas'
);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '[]') $$,
  '22023', 'invalid_payload', 'Une requête qui n''est pas un objet est refusée'
);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-00000000dead', '{"email": "x-72@test.invalid", "role": "member"}') $$,
  '42501', 'forbidden', 'Organisation inconnue : même refus que pour celle d''un autre'
);
-- Une adresse sans compte, une adresse déjà membre : même réponse, un jeton.
select matches(
  public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "personne-72@test.invalid", "role": "member"}'),
  '^[0-9a-f]{64}$', 'Une adresse inconnue reçoit la même réponse'
);
insert into tests.tokens
select 'm', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-m@test.invalid", "role": "librarian"}');
select matches((select token from tests.tokens where label = 'm'), '^[0-9a-f]{64}$', 'Une adresse déjà membre aussi');
insert into tests.tokens
select 'n', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-n@test.invalid", "role": "member"}');
insert into tests.tokens
select 'x', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-x@test.invalid", "role": "org_admin"}');
insert into tests.tokens
select 'y', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-y@test.invalid", "role": "org_admin"}');
insert into tests.tokens
select 'z1', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-z@test.invalid", "role": "member"}');
reset role;

select is(
  (select count(*) from public.organization_invitations
   where token_hash = encode(sha256(convert_to((select token from tests.tokens where label = 'u'), 'UTF8')), 'hex')),
  1::bigint, 'La base garde l''empreinte du jeton'
);
select is(
  (select count(*) from public.organization_invitations i, tests.tokens t where i::text like '%' || t.token || '%'),
  0::bigint, 'Jamais le jeton lui-même'
);
select results_eq(
  $$ select email, role, status, created_by, expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
     from public.organization_invitations
     where organization_id = '72000000-0000-0000-0000-0000000000a1' and role = 'teacher' $$,
  $$ values ('membres-u@test.invalid', 'teacher', 'pending', 'a0000000-0000-0000-0000-000000007201'::uuid, true) $$,
  'L''adresse est rangée en minuscules ; l''invitation vaut sept jours'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'organization.member_invited' and organization_id = '72000000-0000-0000-0000-0000000000a1'
     and actor_id = 'a0000000-0000-0000-0000-000000007201' and category = 'organization'),
  7::bigint, 'Chaque invitation est journalisée'
);

-- ---------------------------------------------------------------------------
-- Isolation entre deux organisations
-- ---------------------------------------------------------------------------
select tests.login('a1000000-0000-0000-0000-000000007202', 'aal2', 10);
insert into tests.tokens
select 'b-z', public.invite_org_member('72000000-0000-0000-0000-0000000000a2', '{"email": "autre-72@test.invalid", "role": "member"}');
select is(
  jsonb_array_length(public.org_members('72000000-0000-0000-0000-0000000000a2') -> 'members'), 2,
  'L''administrateur de l''organisation 2 lit ses deux membres'
);
select is(
  jsonb_array_length(public.org_members('72000000-0000-0000-0000-0000000000a2') -> 'invitations'), 1,
  'Et sa seule invitation'
);
select is(
  public.org_members('72000000-0000-0000-0000-0000000000a2') ->> 'platform_invitation_pending',
  'false', 'Aucune invitation de plateforme n''y attend'
);
select ok(
  public.org_members('72000000-0000-0000-0000-0000000000a2')::text !~ 'membres-(a|l|t|m|u|x|y|n|z)@',
  'Rien de l''organisation 1 n''y figure'
);
reset role;
insert into tests.tokens
select 'id-u', id::text from public.organization_invitations
where organization_id = '72000000-0000-0000-0000-0000000000a1' and email = 'membres-u@test.invalid';
select tests.login('a1000000-0000-0000-0000-000000007202', 'aal2', 10);
select throws_ok(
  $$ select public.revoke_org_invitation((select token::uuid from tests.tokens where label = 'id-u')) $$,
  'P0001', 'not_found', 'Il ne révoque pas l''invitation d''une autre organisation : comme si elle n''existait pas'
);
select throws_ok(
  $$ select public.revoke_org_invitation('72000000-0000-0000-0000-00000000dead') $$,
  'P0001', 'not_found', 'Même réponse pour une invitation inconnue'
);
select results_eq(
  $$ select slug, role from public.my_organizations() $$,
  $$ values ('membres-test-2', 'org_admin') $$,
  'Il ne voit que sa propre appartenance'
);
reset role;
select is(
  (select status from public.organization_invitations where id = (select token::uuid from tests.tokens where label = 'id-u')),
  'pending', 'L''invitation de l''organisation 1 est intacte'
);

-- Une invitation de la plateforme n'appartient pas à l'organisation : son
-- administratrice ne la voit pas et ne la révoque pas.
insert into public.organization_invitations (id, organization_id, email, role, token_hash, expires_at, issued_by_platform)
values ('72000000-0000-0000-0000-0000000000f1', '72000000-0000-0000-0000-0000000000a1', 'plateforme-72@test.invalid',
        'org_admin', repeat('f1', 32), now() + interval '7 days', true);
select throws_ok(
  $$ insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, issued_by_platform)
     values ('72000000-0000-0000-0000-0000000000a2', 'plateforme-bis-72@test.invalid', 'member', repeat('f2', 32), now() + interval '7 days', true) $$,
  '23514', null, 'Une invitation de plateforme ne porte que le rôle org_admin'
);
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
select throws_ok(
  $$ select public.revoke_org_invitation('72000000-0000-0000-0000-0000000000f1') $$,
  'P0001', 'not_found', 'L''administratrice ne révoque pas l''invitation émise par la plateforme'
);
select ok(
  public.org_members('72000000-0000-0000-0000-0000000000a1')::text !~ 'plateforme-72',
  'Ni ne la voit dans la liste de son organisation'
);
select is(
  public.org_members('72000000-0000-0000-0000-0000000000a1') ->> 'platform_invitation_pending',
  'true', 'Mais elle sait qu''une invitation de plateforme est en attente'
);
select ok(
  public.org_members('72000000-0000-0000-0000-0000000000a1')::text !~ 'issued|created_by|72000000-0000-0000-0000-0000000000f1',
  'Sans identité ni identifiant'
);
reset role;

-- L'administratrice de l'organisation 1 lit membres et invitations en attente.
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
select is(
  jsonb_array_length(public.org_members('72000000-0000-0000-0000-0000000000a1') -> 'members'), 4,
  'L''administratrice lit les quatre membres de son organisation'
);
select is(
  jsonb_array_length(public.org_members('72000000-0000-0000-0000-0000000000a1') -> 'invitations'), 7,
  'Et ses sept invitations en attente'
);
select ok(
  public.org_members('72000000-0000-0000-0000-0000000000a1') -> 'members' @>
    '[{"user_id": "a3000000-0000-0000-0000-000000007204", "email": "membres-t@test.invalid", "role": "teacher"}]'::jsonb,
  'Chaque membre y porte son identifiant, son adresse et son rôle'
);
select ok(
  public.org_members('72000000-0000-0000-0000-0000000000a1')::text !~ 'token|membres-b',
  'Sans empreinte de jeton, ni rien de l''organisation 2'
);
reset role;

-- ---------------------------------------------------------------------------
-- Accepter : seulement sous l'adresse invitée, confirmée — sinon la même réponse vide
-- ---------------------------------------------------------------------------
-- Un tiers qui détient le jeton de U.
select tests.login('e0000000-0000-0000-0000-000000007210');
select is(public.org_invitation_preview((select token from tests.tokens where label = 'u')), null, 'Mauvaise adresse : l''aperçu ne rend rien');
select is(public.accept_org_invitation((select token from tests.tokens where label = 'u')), null, 'L''acceptation non plus, sans erreur');
select is(public.accept_org_invitation('pas-un-jeton'), null, 'Jeton mal formé : même réponse');
select is(public.accept_org_invitation(null), null, 'Jeton absent : même réponse');
select is(public.accept_org_invitation(repeat('0', 64)), null, 'Jeton inconnu : même réponse');
select is(public.org_invitation_preview('pas-un-jeton'), null, 'Aperçu d''un jeton mal formé : rien');
select is_empty($$ select * from public.my_organizations() $$, 'Le tiers n''est membre de rien');
reset role;

-- Adresse non confirmée.
select tests.login('d3000000-0000-0000-0000-000000007209');
select is(public.org_invitation_preview((select token from tests.tokens where label = 'n')), null, 'Adresse non confirmée : l''aperçu ne rend rien');
select is(public.accept_org_invitation((select token from tests.tokens where label = 'n')), null, 'L''acceptation non plus');
reset role;

-- La personne invitée.
select tests.login('d0000000-0000-0000-0000-000000007206');
select is(
  public.org_invitation_preview((select token from tests.tokens where label = 'u')),
  '{"organization_name": "Organisation 1 du test", "role": "teacher", "requires_second_factor": false}'::jsonb,
  'L''invitée voit le nom de l''organisation et le rôle proposé'
);
select is_empty($$ select * from public.my_organizations() $$, 'Un jeton seul ne donne rien : pas encore membre');
select is(
  public.accept_org_invitation((select token from tests.tokens where label = 'u')),
  '72000000-0000-0000-0000-0000000000a1'::uuid, 'Elle accepte et reçoit l''identifiant de l''organisation'
);
select is(public.accept_org_invitation((select token from tests.tokens where label = 'u')), null, 'Jeton rejoué : même réponse vide');
select is(public.org_invitation_preview((select token from tests.tokens where label = 'u')), null, 'Et plus d''aperçu');
select results_eq(
  $$ select organization_id, slug, name, status, role from public.my_organizations() $$,
  $$ values ('72000000-0000-0000-0000-0000000000a1'::uuid, 'membres-test-1', 'Organisation 1 du test', 'verified', 'teacher') $$,
  'Elle voit son appartenance'
);
select results_eq(
  $$ select organization_id, organization_name, role from public.my_organization_memberships() $$,
  $$ values ('72000000-0000-0000-0000-0000000000a1'::uuid, 'Organisation 1 du test', 'teacher') $$,
  'Et la retrouve dans la copie de ses données'
);
select tests.org1_refusals('La nouvelle enseignante');
select results_eq(
  $$ select user_id from public.organization_members $$,
  $$ values ('d0000000-0000-0000-0000-000000007206'::uuid) $$,
  'Elle ne lit que sa propre ligne d''appartenance'
);
reset role;
select results_eq(
  $$ select role, invited_by from public.organization_members
     where organization_id = '72000000-0000-0000-0000-0000000000a1' and user_id = 'd0000000-0000-0000-0000-000000007206' $$,
  $$ values ('teacher', 'a0000000-0000-0000-0000-000000007201'::uuid) $$,
  'L''appartenance porte le rôle de l''invitation et celle qui a invité'
);
select results_eq(
  $$ select status, accepted_by from public.organization_invitations where id = (select token::uuid from tests.tokens where label = 'id-u') $$,
  $$ values ('accepted', 'd0000000-0000-0000-0000-000000007206'::uuid) $$,
  'L''invitation est close'
);

-- Déjà membre : l'invitation ne change pas son rôle.
select tests.login('c0000000-0000-0000-0000-000000007205');
select is(
  public.accept_org_invitation((select token from tests.tokens where label = 'm')),
  '72000000-0000-0000-0000-0000000000a1'::uuid, 'Un membre accepte une invitation à sa propre organisation'
);
reset role;
select is(
  (select role from public.organization_members
   where organization_id = '72000000-0000-0000-0000-0000000000a1' and user_id = 'c0000000-0000-0000-0000-000000007205'),
  'member', 'Son rôle ne change pas par une invitation'
);

-- Expirée.
update public.organization_invitations set expires_at = now() - interval '1 minute'
where organization_id = '72000000-0000-0000-0000-0000000000a1' and email = 'membres-z@test.invalid';
select tests.login('e0000000-0000-0000-0000-000000007210');
select is(public.org_invitation_preview((select token from tests.tokens where label = 'z1')), null, 'Invitation expirée : l''aperçu ne rend rien');
select is(public.accept_org_invitation((select token from tests.tokens where label = 'z1')), null, 'L''acceptation non plus');
reset role;

-- Révoquée.
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
insert into tests.tokens
select 'z2', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-z@test.invalid", "role": "member"}');
reset role;
insert into tests.tokens
select 'id-z2', id::text from public.organization_invitations
where token_hash = encode(sha256(convert_to((select token from tests.tokens where label = 'z2'), 'UTF8')), 'hex');
select tests.login('a3000000-0000-0000-0000-000000007204');
select throws_ok(
  $$ select public.revoke_org_invitation((select token::uuid from tests.tokens where label = 'id-z2')) $$,
  'P0001', 'not_found', 'Un enseignant ne révoque pas une invitation'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
select lives_ok(
  $$ select public.revoke_org_invitation((select token::uuid from tests.tokens where label = 'id-z2')) $$,
  'L''administratrice révoque une invitation'
);
select throws_ok(
  $$ select public.revoke_org_invitation((select token::uuid from tests.tokens where label = 'id-z2')) $$,
  'P0001', 'not_found', 'Une invitation déjà révoquée ne se révoque plus'
);
reset role;
select tests.login('e0000000-0000-0000-0000-000000007210');
select is(public.org_invitation_preview((select token from tests.tokens where label = 'z2')), null, 'Invitation révoquée : l''aperçu ne rend rien');
select is(public.accept_org_invitation((select token from tests.tokens where label = 'z2')), null, 'L''acceptation non plus');
reset role;

-- Une nouvelle invitation à la même adresse remplace la précédente ; trois par
-- jour au plus vers une même adresse.
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
insert into tests.tokens
select 'z3', public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-z@test.invalid", "role": "member"}');
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a1', '{"email": "membres-z@test.invalid", "role": "member"}') $$,
  'P0001', 'rate_limited', 'Une même adresse ne reçoit pas plus de trois invitations par jour'
);
reset role;
select is(
  (select count(*) from public.organization_invitations
   where organization_id = '72000000-0000-0000-0000-0000000000a1' and email = 'membres-z@test.invalid' and status = 'pending'),
  1::bigint, 'Une seule invitation en attente par adresse'
);

-- Organisation suspendue entre l'invitation et l'acceptation.
update public.organizations set status = 'suspended' where id = '72000000-0000-0000-0000-0000000000a1';
select tests.login('e0000000-0000-0000-0000-000000007210');
select is(public.accept_org_invitation((select token from tests.tokens where label = 'z3')), null, 'Organisation suspendue : l''invitation ne s''accepte pas');
reset role;
update public.organizations set status = 'verified' where id = '72000000-0000-0000-0000-0000000000a1';

-- Rôle d'administrateur : un second facteur d'abord.
select tests.login('d2000000-0000-0000-0000-000000007208');
select is(
  public.org_invitation_preview((select token from tests.tokens where label = 'y')) ->> 'requires_second_factor',
  'true', 'L''invitée à un rôle d''administrateur apprend qu''il lui faut un second facteur'
);
select throws_ok(
  $$ select public.accept_org_invitation((select token from tests.tokens where label = 'y')) $$,
  '42501', 'second_factor_missing', 'Sans second facteur, elle ne devient pas administratrice'
);
reset role;
select is(
  (select count(*) from public.organization_members where user_id = 'd2000000-0000-0000-0000-000000007208'),
  0::bigint, 'Elle n''est pas membre, et son invitation reste en attente'
);
select tests.login('d1000000-0000-0000-0000-000000007207', 'aal1');
select throws_ok(
  $$ select public.accept_org_invitation((select token from tests.tokens where label = 'x')) $$,
  '42501', 'forbidden', 'Le rôle d''administrateur ne s''accepte pas dans une session sans second facteur présenté'
);
reset role;
select tests.login('d1000000-0000-0000-0000-000000007207', 'aal2', 10);
select is(
  public.accept_org_invitation((select token from tests.tokens where label = 'x')),
  '72000000-0000-0000-0000-0000000000a1'::uuid, 'Avec un second facteur, l''invité devient administrateur'
);
select ok(
  private.has_org_role('72000000-0000-0000-0000-0000000000a1', array['org_admin']),
  'Son rôle est effectif'
);
reset role;

-- Compte au profil non complété : aucune acceptation, aucun aperçu.
insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at)
values ('72000000-0000-0000-0000-0000000000a1', 'membres-o@test.invalid', 'member',
        encode(sha256(convert_to(repeat('d', 64), 'UTF8')), 'hex'), now() + interval '7 days');
select tests.login('d4000000-0000-0000-0000-000000007215');
select throws_ok(
  $$ select public.accept_org_invitation(repeat('d', 64)) $$,
  '42501', 'forbidden', 'Un compte au profil non complété n''accepte pas d''invitation'
);
select is(public.org_invitation_preview(repeat('d', 64)), null, 'Ni n''en voit l''aperçu');
reset role;
select is(
  (select count(*) from public.organization_members where user_id = 'd4000000-0000-0000-0000-000000007215'),
  0::bigint, 'Il n''est pas devenu membre'
);

-- ---------------------------------------------------------------------------
-- Rôles, retrait, départ ; le dernier administrateur
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
select lives_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-000000007204', 'librarian') $$,
  'L''administratrice change le rôle d''un membre'
);
select throws_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205', 'org_admin') $$,
  '42501', 'second_factor_missing', 'Un membre sans second facteur ne devient pas administrateur'
);
select throws_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205', 'super_admin') $$,
  '22023', 'invalid_payload', 'Un rôle inconnu est refusé'
);
select throws_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000007202', 'member') $$,
  'P0001', 'not_found', 'On ne change pas le rôle de qui n''est pas membre'
);
select throws_ok(
  $$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000007202') $$,
  'P0001', 'not_found', 'Ni ne retire qui n''est pas membre'
);
-- X, second administrateur, est retiré : A redevient la dernière.
select lives_ok(
  $$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'd1000000-0000-0000-0000-000000007207') $$,
  'Un administrateur se retire tant qu''il en reste un autre'
);
select throws_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000007201', 'member') $$,
  'P0001', 'last_org_admin', 'Le dernier administrateur ne se rétrograde pas'
);
select throws_ok(
  $$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000007201') $$,
  'P0001', 'last_org_admin', 'Ni ne se retire'
);
select throws_ok(
  $$ select public.leave_organization('72000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'last_org_admin', 'Ni ne part'
);
-- Un marqueur de dissolution posé à la main n'ouvre rien.
select set_config('eduscholar.organization_dissolution', '72000000-0000-0000-0000-0000000000a1', true);
select throws_ok(
  $$ select public.leave_organization('72000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'last_org_admin', 'Même avec le marqueur de dissolution posé à la main'
);
select set_config('eduscholar.organization_dissolution', '', true);
select is(private.account_deletion_check(), 'last_org_admin', 'Et le contrôle préalable à la suppression de son compte le lui dit toujours');
select lives_ok(
  $$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007205') $$,
  'L''administratrice retire un membre'
);
reset role;
select results_eq(
  $$ select user_id, role from public.organization_members
     where organization_id = '72000000-0000-0000-0000-0000000000a1' order by user_id $$,
  $$ values ('a0000000-0000-0000-0000-000000007201'::uuid, 'org_admin'),
            ('a2000000-0000-0000-0000-000000007203'::uuid, 'librarian'),
            ('a3000000-0000-0000-0000-000000007204'::uuid, 'librarian'),
            ('d0000000-0000-0000-0000-000000007206'::uuid, 'teacher') $$,
  'Les appartenances sont celles attendues ; l''administratrice est toujours là'
);
select isnt_empty(
  $$ select 1 from public.audit_logs
     where action = 'organization_members.update' and organization_id = '72000000-0000-0000-0000-0000000000a1'
       and subject_user_id = 'a3000000-0000-0000-0000-000000007204' and actor_id = 'a0000000-0000-0000-0000-000000007201'
       and metadata -> 'role' ->> 'new' = 'librarian' $$,
  'Le changement de rôle est journalisé au nom de celle qui l''a fait'
);
select isnt_empty(
  $$ select 1 from public.audit_logs
     where action = 'organization_members.delete' and organization_id = '72000000-0000-0000-0000-0000000000a1'
       and subject_user_id = 'c0000000-0000-0000-0000-000000007205' and actor_id = 'a0000000-0000-0000-0000-000000007201' $$,
  'Le retrait aussi'
);

select results_eq(
  $$ select user_id from private.organization_departures
     where organization_id = '72000000-0000-0000-0000-0000000000a1' order by user_id $$,
  $$ values ('c0000000-0000-0000-0000-000000007205'::uuid), ('d1000000-0000-0000-0000-000000007207'::uuid) $$,
  'Les départs sont gardés'
);

-- Le membre retiré ne revient pas par une ancienne invitation.
insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at)
values ('72000000-0000-0000-0000-0000000000a1', 'membres-l@test.invalid', 'member', repeat('ab', 32), now() + interval '7 days');
select tests.login('a0000000-0000-0000-0000-000000007201', 'aal2', 10);
select lives_ok(
  $$ select public.remove_org_member('72000000-0000-0000-0000-0000000000a1', 'a2000000-0000-0000-0000-000000007203') $$,
  'Une bibliothécaire est retirée'
);
reset role;
select is(
  (select status from public.organization_invitations where token_hash = repeat('ab', 32)),
  'revoked', 'L''invitation encore en attente à son adresse est annulée avec elle'
);

-- Partir.
select tests.login('a3000000-0000-0000-0000-000000007204');
select lives_ok($$ select public.leave_organization('72000000-0000-0000-0000-0000000000a1') $$, 'Un membre quitte son organisation');
select throws_ok($$ select public.leave_organization('72000000-0000-0000-0000-0000000000a1') $$, 'P0001', 'not_found', 'On ne quitte pas deux fois');
select throws_ok($$ select public.leave_organization('72000000-0000-0000-0000-0000000000a2') $$, 'P0001', 'not_found', 'Ni une organisation dont on n''est pas membre');
select is_empty($$ select * from public.my_organizations() $$, 'Il n''a plus d''appartenance');
reset role;
-- Même suspendue, une organisation se quitte ; pas par sa dernière administratrice.
select tests.login('c1000000-0000-0000-0000-000000007214');
select lives_ok($$ select public.leave_organization('72000000-0000-0000-0000-0000000000a3') $$, 'Un membre quitte une organisation suspendue');
reset role;
select tests.login('a5000000-0000-0000-0000-000000007213', 'aal2', 10);
select is(private.account_deletion_check(), 'ok', 'La dernière administratrice d''une organisation suspendue peut supprimer son compte');
select lives_ok($$ select public.leave_organization('72000000-0000-0000-0000-0000000000a3') $$, 'Et la quitter');
select is_empty($$ select * from public.my_organizations() $$, 'Elle n''a plus d''appartenance');
reset role;
select is(
  (select count(*) from public.organization_members where organization_id = '72000000-0000-0000-0000-0000000000a3'),
  0::bigint, 'L''organisation suspendue est sans administrateur'
);
-- Même cas, par la suppression du compte.
insert into public.organization_members (organization_id, user_id, role) values
  ('72000000-0000-0000-0000-0000000000a3', 'a5000000-0000-0000-0000-000000007213', 'org_admin');
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$ delete from auth.users where id = 'a5000000-0000-0000-0000-000000007213' $$,
  'Le compte de la dernière administratrice d''une organisation suspendue se supprime'
);
select is(
  (select count(*) from public.organization_members where organization_id = '72000000-0000-0000-0000-0000000000a3'),
  0::bigint, 'Son appartenance est partie avec lui'
);
reset role;
-- Deux administrateurs : l'un peut partir, puis l'autre est le dernier.
select tests.login('a4000000-0000-0000-0000-000000007212', 'aal2', 10);
select lives_ok(
  $$ select public.set_org_member_role('72000000-0000-0000-0000-0000000000a2', 'a4000000-0000-0000-0000-000000007212', 'member') $$,
  'Avec deux administrateurs, l''un se rétrograde'
);
select tests.org1_refusals('L''ancien administrateur de l''organisation 2');
select throws_ok(
  $$ select public.org_members('72000000-0000-0000-0000-0000000000a2') $$,
  '42501', 'forbidden', 'Rétrogradé, il ne lit plus la liste des membres de la sienne'
);
reset role;

-- ---------------------------------------------------------------------------
-- Plafonds
-- ---------------------------------------------------------------------------
-- Cinquante invitations en attente par organisation.
insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at)
select '72000000-0000-0000-0000-0000000000a2', 'plafond-' || n || '@test.invalid', 'member',
       encode(sha256(convert_to('plafond-72-' || n, 'UTF8')), 'hex'), now() + interval '7 days'
from generate_series(1, 49) as n;
select tests.login('a1000000-0000-0000-0000-000000007202', 'aal2', 10);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a2', '{"email": "plafond-de-trop@test.invalid", "role": "member"}') $$,
  'P0001', 'limit_reached', 'Cinquante invitations en attente au plus par organisation'
);
select is(
  jsonb_array_length(public.org_members('72000000-0000-0000-0000-0000000000a2') -> 'invitations'), 50,
  'La liste rend les cinquante'
);
reset role;
-- Trente invitations par jour et par compte.
delete from public.organization_invitations
where organization_id = '72000000-0000-0000-0000-0000000000a2' and email like 'plafond-%';
insert into private.rate_limit_buckets (bucket_key, window_start, hits)
values ('org-invite:user:' || left(encode(sha256(convert_to('org-invite:a1000000-0000-0000-0000-000000007202', 'UTF8')), 'hex'), 40),
        to_timestamp(floor(extract(epoch from clock_timestamp()) / 86400) * 86400), 30)
on conflict (bucket_key, window_start) do update set hits = 30;
select tests.login('a1000000-0000-0000-0000-000000007202', 'aal2', 10);
select throws_ok(
  $$ select public.invite_org_member('72000000-0000-0000-0000-0000000000a2', '{"email": "plafond-compte@test.invalid", "role": "member"}') $$,
  'P0001', 'rate_limited', 'Trente invitations par jour et par compte'
);
reset role;
-- Trente essais d'acceptation par quart d'heure.
insert into private.rate_limit_buckets (bucket_key, window_start, hits)
values ('org-invitation-accept:user:' || left(encode(sha256(convert_to('org-invitation-accept:e0000000-0000-0000-0000-000000007210', 'UTF8')), 'hex'), 40),
        to_timestamp(floor(extract(epoch from clock_timestamp()) / 900) * 900), 30)
on conflict (bucket_key, window_start) do update set hits = 30;
select tests.login('e0000000-0000-0000-0000-000000007210');
select throws_ok(
  $$ select public.accept_org_invitation(repeat('0', 64)) $$,
  'P0001', 'rate_limited', 'Trente essais d''acceptation par quart d''heure et par compte'
);
reset role;

-- ---------------------------------------------------------------------------
-- Journal d'audit : ni adresse, ni jeton
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.audit_logs a
   where (a.organization_id::text like '72000000-%' or a.actor_id::text like '%-0000000072__')
     and (a.metadata::text ~ '@' or coalesce(a.target_id, '') ~ '@'
          or exists (select 1 from tests.tokens t where t.label not like 'id-%' and a::text like '%' || t.token || '%'))),
  0::bigint, 'Le journal ne porte ni adresse ni jeton'
);
select is_empty(
  $$ select distinct jsonb_object_keys(a.metadata) from public.audit_logs a
     where a.action in ('organization.member_invited', 'organization.invitation_revoked')
       and a.organization_id::text like '72000000-%'
     except select 'role' $$,
  'Une invitation journalisée ne porte que le rôle'
);

-- ---------------------------------------------------------------------------
-- Conservation
-- ---------------------------------------------------------------------------
insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, status, created_at) values
  ('72000000-0000-0000-0000-0000000000a2', 'purge-1@test.invalid', 'member', repeat('c1', 32), now() - interval '33 days', 'accepted', now() - interval '40 days'),
  ('72000000-0000-0000-0000-0000000000a2', 'purge-2@test.invalid', 'member', repeat('c2', 32), now() - interval '33 days', 'revoked', now() - interval '40 days'),
  ('72000000-0000-0000-0000-0000000000a2', 'purge-3@test.invalid', 'member', repeat('c3', 32), now() - interval '31 days', 'pending', now() - interval '38 days'),
  ('72000000-0000-0000-0000-0000000000a2', 'garde-1@test.invalid', 'member', repeat('c4', 32), now() - interval '3 days', 'pending', now() - interval '10 days'),
  ('72000000-0000-0000-0000-0000000000a2', 'garde-2@test.invalid', 'member', repeat('c5', 32), now() + interval '2 days', 'revoked', now() - interval '5 days');
insert into private.organization_decisions (organization_id, decision, reason, decided_at) values
  ('72000000-0000-0000-0000-0000000000a3', 'suspended', 'Ancien motif', now() - interval '4 years'),
  ('72000000-0000-0000-0000-0000000000a3', 'suspended', 'Motif récent', now() - interval '1 year');
insert into private.organization_departures (organization_id, user_id, left_at)
values ('72000000-0000-0000-0000-0000000000a2', '72000000-0000-0000-0000-00000000dead', now() - interval '100 days');
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select private.purge_stale_org_invitations() $$, 'La purge s''exécute sous le propriétaire de la base');
select results_eq(
  $$ select email from public.organization_invitations where email like 'purge-%' or email like 'garde-%' order by email $$,
  $$ values ('garde-1@test.invalid'), ('garde-2@test.invalid') $$,
  'Les invitations closes ou expirées depuis trente jours sont effacées, les autres gardées'
);
select results_eq(
  $$ select reason from private.organization_decisions where organization_id = '72000000-0000-0000-0000-0000000000a3' $$,
  $$ values ('Motif récent') $$,
  'Les motifs de plus de trois ans aussi'
);
select results_eq(
  $$ select count(*) filter (where left_at < now() - interval '90 days'), count(*) filter (where left_at >= now() - interval '90 days') > 0
     from private.organization_departures where organization_id::text like '72000000-%' $$,
  $$ values (0::bigint, true) $$,
  'Les départs de plus de quatre-vingt-dix jours sont effacés, les autres gardés'
);
select isnt_empty(
  $$ select 1 from cron.job where jobname = 'eduscholar-org-invitations-purge' and username = 'postgres' and active
       and command = 'select private.purge_stale_org_invitations()' $$,
  'La purge est planifiée chaque nuit, sous le propriétaire de la base'
);

-- ---------------------------------------------------------------------------
-- Suppression de compte
-- ---------------------------------------------------------------------------
-- U : membre, a accepté une invitation. B : administrateur de l'organisation 2,
-- qui a émis une invitation, désormais seul administrateur.
select throws_ok(
  $$ delete from auth.users where id = 'a1000000-0000-0000-0000-000000007202' $$,
  '23514', null, 'Règle inchangée : le compte du dernier administrateur d''une organisation ne se supprime pas'
);
-- L'administration transmise, il peut partir.
update public.organization_members set role = 'org_admin'
where organization_id = '72000000-0000-0000-0000-0000000000a2' and user_id = 'a4000000-0000-0000-0000-000000007212';
select lives_ok(
  $$ delete from auth.users where id = 'a1000000-0000-0000-0000-000000007202' $$,
  'Avec un autre administrateur, son compte se supprime'
);
select is(
  (select count(*) from public.organization_members where user_id = 'a1000000-0000-0000-0000-000000007202'),
  0::bigint, 'Son appartenance est partie'
);
select results_eq(
  $$ select email, created_by from public.organization_invitations
     where organization_id = '72000000-0000-0000-0000-0000000000a2' and email = 'autre-72@test.invalid' $$,
  $$ values ('autre-72@test.invalid', null::uuid) $$,
  'L''invitation qu''il a émise reste, sans son identifiant'
);
select lives_ok(
  $$ delete from auth.users where id = 'd0000000-0000-0000-0000-000000007206' $$,
  'Le compte d''un membre se supprime'
);
select is(
  (select count(*) from public.organization_members where user_id = 'd0000000-0000-0000-0000-000000007206'),
  0::bigint, 'Son appartenance est partie'
);
select is(
  (select count(*) from public.organization_invitations where email = 'membres-u@test.invalid'),
  0::bigint, 'L''invitation qu''il avait acceptée, qui porte son adresse, est effacée'
);
select is(
  (select count(*) from private.organization_departures where user_id = 'd0000000-0000-0000-0000-000000007206'),
  0::bigint, 'Aucune trace de départ n''est gardée d''un compte supprimé'
);
-- Y a une invitation en attente à son adresse.
select is(
  (select count(*) from public.organization_invitations where email = 'membres-y@test.invalid' and status = 'pending'),
  1::bigint, 'Une invitation attend encore Y'
);
select lives_ok(
  $$ delete from auth.users where id = 'd2000000-0000-0000-0000-000000007208' $$,
  'Le compte d''une personne invitée se supprime'
);
select is(
  (select count(*) from public.organization_invitations where email = 'membres-y@test.invalid'),
  0::bigint, 'L''invitation en attente à son adresse est effacée avec lui'
);
select is(
  (select count(*) from public.organizations where id::text like '72000000-%'), 3::bigint,
  'Les organisations sont toujours là'
);

select * from finish();
rollback;
