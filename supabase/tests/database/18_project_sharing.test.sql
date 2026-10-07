-- E-01 : partage d'un projet avec un encadreur.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create table tests.tokens (label text primary key, token text);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.tokens to authenticated;

-- A : propriétaire. S : encadreur invité. B : tiers. N : adresse non confirmée. X : suspendu.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000004501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'partage-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000004502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Partage-S@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000004503', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'partage-b@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000004504', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'partage-n@test.invalid', null),
  ('d0000000-0000-0000-0000-000000004505', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'partage-x@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000450_';
insert into public.research_projects (id, owner_id, title, problem_statement) values
  ('45000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000004501', 'Mémoire de A', 'Problématique de A'),
  ('45000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000004501', 'Autre projet de A', null),
  ('45000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000004503', 'Projet de B', null);
insert into public.project_sources (id, project_id, title) values
  ('45000000-0000-0000-0000-0000000000c1', '45000000-0000-0000-0000-0000000000a1', 'Source de A');
insert into public.literature_notes (source_id, problem) values
  ('45000000-0000-0000-0000-0000000000c1', 'Note de travail privée');
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('45000000-0000-0000-0000-0000000000d1', '45000000-0000-0000-0000-0000000000a1', 1, 'Introduction', 'Texte de A.');
insert into public.section_citations (section_id, source_id, pages) values
  ('45000000-0000-0000-0000-0000000000d1', '45000000-0000-0000-0000-0000000000c1', 'p. 3');

-- ---------------------------------------------------------------------------
-- Aucune lecture ni écriture directe
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.research_project_members', 'public.project_invitations']) t,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, t, p)),
  0::bigint, 'Membres et invitations ne se lisent ni ne s''écrivent directement'
);

-- ---------------------------------------------------------------------------
-- Inviter
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 's1', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": " PARTAGE-S@test.invalid ", "role": "supervisor"}');
select matches((select token from tests.tokens where label = 's1'), '^[0-9a-f]{64}$', 'L''invitation rend un jeton aléatoire');
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-a@test.invalid", "role": "supervisor"}') $$,
  '42501', 'own_account', 'On ne s''invite pas soi-même'
);
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "pas-une-adresse", "role": "supervisor"}') $$,
  '22023', 'invalid_payload', 'Adresse invalide : refusée'
);
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "x@test.invalid", "role": "owner"}') $$,
  '22023', 'invalid_payload', 'Le rôle de propriétaire ne s''attribue pas'
);
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000b1', '{"email": "x@test.invalid", "role": "viewer"}') $$,
  null, 'not_found', 'On n''invite pas sur le projet d''un autre'
);
-- Une adresse sans compte reçoit la même réponse : un jeton.
select matches(
  public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "personne@test.invalid", "role": "viewer"}'),
  '^[0-9a-f]{64}$', 'Une adresse inconnue reçoit la même réponse'
);
reset role;
select is(
  (select count(*) from public.project_invitations
   where token_hash = encode(sha256(convert_to((select token from tests.tokens where label = 's1'), 'UTF8')), 'hex')),
  1::bigint, 'La base garde l''empreinte du jeton'
);
select is(
  (select count(*) from public.project_invitations i, tests.tokens t where i::text like '%' || t.token || '%'),
  0::bigint, 'Jamais le jeton lui-même'
);
select is(
  (select email from public.project_invitations where project_id = '45000000-0000-0000-0000-0000000000a1' and role = 'supervisor'),
  'partage-s@test.invalid', 'L''adresse est rangée en minuscules'
);

-- Le propriétaire voit ses invitations en attente ; personne d'autre.
select tests.login('a0000000-0000-0000-0000-000000004501');
select is(
  jsonb_array_length(public.project_sharing('45000000-0000-0000-0000-0000000000a1') -> 'invitations'), 2,
  'Le propriétaire voit ses invitations en attente'
);
reset role;
select tests.login('50000000-0000-0000-0000-000000004502');
select throws_ok(
  $$ select public.project_sharing('45000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'La personne invitée ne voit pas le partage du projet'
);

-- ---------------------------------------------------------------------------
-- Un jeton seul ne donne rien
-- ---------------------------------------------------------------------------
select is((select count(*) from public.shared_projects()), 0::bigint, 'Avant acceptation, rien n''est partagé');
select throws_ok(
  $$ select public.shared_project_document('45000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Ni lisible'
);
reset role;

-- Le jeton présenté par un autre compte : rien, sans erreur distincte.
select tests.login('b0000000-0000-0000-0000-000000004503');
select is(public.invitation_preview((select token from tests.tokens where label = 's1')), null::jsonb, 'Un tiers ne voit pas l''invitation');
select is(public.accept_project_invitation((select token from tests.tokens where label = 's1')), null::uuid, 'Et ne l''accepte pas');
select is(public.accept_project_invitation('jeton-invalide'), null::uuid, 'Un jeton mal formé reçoit la même réponse');
select is(public.accept_project_invitation(repeat('0', 64)), null::uuid, 'Un jeton inconnu aussi');
reset role;
-- Le propriétaire n'accepte pas une invitation à son propre projet, même adressée
-- à son adresse (cas posé directement en base : la fonction d'invitation le refuse).
insert into public.project_invitations (project_id, email, role, token_hash, expires_at)
values ('45000000-0000-0000-0000-0000000000a1', 'partage-a@test.invalid', 'viewer',
        encode(sha256(convert_to(repeat('a', 64), 'UTF8')), 'hex'), now() + interval '1 day');
select tests.login('a0000000-0000-0000-0000-000000004501');
select is(public.accept_project_invitation(repeat('a', 64)), null::uuid, 'Le propriétaire ne devient pas membre de son propre projet');
reset role;
delete from public.project_invitations where email = 'partage-a@test.invalid';

-- Un tiers qui connaîtrait l'identifiant d'une invitation, ou d'un membre, n'en fait rien.
create temporary table known_invitation as
select id from public.project_invitations where email = 'partage-s@test.invalid';
grant select on known_invitation to authenticated;
select tests.login('b0000000-0000-0000-0000-000000004503');
select throws_ok(
  $$ select public.revoke_project_invitation((select id from known_invitation)) $$,
  null, 'not_found', 'Un tiers n''annule pas l''invitation d''un autre, même avec son identifiant'
);
select throws_ok(
  $$ select public.remove_project_member('45000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000004502') $$,
  null, 'not_found', 'Ni ne retire un membre du projet d''un autre'
);
reset role;
select is(
  (select status from public.project_invitations where id = (select id from known_invitation)),
  'pending', 'L''invitation visée est intacte'
);

-- ---------------------------------------------------------------------------
-- Accepter
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000004502');
select is(
  public.invitation_preview((select token from tests.tokens where label = 's1')),
  '{"project_title": "Mémoire de A", "role": "supervisor", "owner_email": "partage-a@test.invalid"}'::jsonb,
  'La personne invitée voit ce qu''elle accepte'
);
select is(
  public.accept_project_invitation((select token from tests.tokens where label = 's1')),
  '45000000-0000-0000-0000-0000000000a1'::uuid, 'Elle accepte, sous son adresse confirmée'
);
select is(public.accept_project_invitation((select token from tests.tokens where label = 's1')), null::uuid, 'Le jeton ne sert qu''une fois');
select results_eq(
  $$ select title, role, owner_email from public.shared_projects() $$,
  $$ values ('Mémoire de A', 'supervisor', 'partage-a@test.invalid') $$,
  'Le projet figure parmi ceux partagés avec elle'
);

-- Elle lit le projet, mais pas les fiches de lecture, ni l'autre projet de A.
select is(
  public.shared_project_document('45000000-0000-0000-0000-0000000000a1') #>> '{sections,0,body}', 'Texte de A.',
  'Elle lit le texte'
);
select is(
  public.shared_project_document('45000000-0000-0000-0000-0000000000a1') #>> '{citations,0,pages}', 'p. 3',
  'Et les citations'
);
select is(
  public.shared_project_document('45000000-0000-0000-0000-0000000000a1')::text like '%Note de travail privée%', false,
  'Pas les fiches de lecture'
);
select throws_ok(
  $$ select public.shared_project_document('45000000-0000-0000-0000-0000000000a2') $$,
  null, 'not_found', 'Ni l''autre projet de A'
);

-- Sa session au seul mot de passe, si elle a un second facteur, ne lit rien.
reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000004502', '50000000-0000-0000-0000-000000004502', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('50000000-0000-0000-0000-000000004502', 'aal1');
select throws_ok(
  $$ select public.shared_project_document('45000000-0000-0000-0000-0000000000a1') $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne lit pas le projet partagé'
);
select is((select count(*) from public.shared_projects()), 0::bigint, 'Ni la liste des projets partagés');
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000004502';
select tests.login('50000000-0000-0000-0000-000000004502');

-- Les tables du projet lui restent fermées : elle ne lit que par les fonctions.
select is((select count(*) from public.research_projects), 0::bigint, 'La table des projets lui reste fermée');
select is((select count(*) from public.thesis_sections), 0::bigint, 'Celle des sections aussi');

-- Elle ne modifie rien.
select throws_ok(
  $$ select public.update_thesis_section('45000000-0000-0000-0000-0000000000d1', '{"body": "Réécrit"}') $$,
  null, 'not_found', 'Elle ne modifie pas le texte'
);
select throws_ok(
  $$ select public.delete_project('45000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Ni ne supprime le projet'
);
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "x@test.invalid", "role": "viewer"}') $$,
  null, 'not_found', 'Ni n''invite à son tour'
);
select throws_ok(
  $$ select public.remove_project_member('45000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000004502') $$,
  null, 'not_found', 'Ni ne retire un membre'
);
reset role;

-- L'ouverture du partage est inscrite au compte du propriétaire.
select is(
  (select count(*) from public.audit_logs
   where action = 'project.shared' and subject_user_id = 'a0000000-0000-0000-0000-000000004501'
     and actor_id = '50000000-0000-0000-0000-000000004502'),
  1::bigint, 'L''ouverture du partage est journalisée'
);
select tests.login('a0000000-0000-0000-0000-000000004501');
select is(
  (select count(*) from public.my_account_events() where action = 'project.shared'), 1::bigint,
  'Le propriétaire la retrouve dans les événements de son compte'
);
select is(
  public.project_sharing('45000000-0000-0000-0000-0000000000a1') #>> '{members,0,email}', 'Partage-S@test.invalid',
  'Et voit sa nouvelle encadreure parmi les membres'
);
reset role;

-- ---------------------------------------------------------------------------
-- Adresse non confirmée, compte suspendu, invitation expirée ou révoquée
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 'n1', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-n@test.invalid", "role": "viewer"}');
insert into tests.tokens
select 'x1', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-x@test.invalid", "role": "viewer"}');
insert into tests.tokens
select 'b1', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-b@test.invalid", "role": "viewer"}');
reset role;

select tests.login('c0000000-0000-0000-0000-000000004504');
select is(public.accept_project_invitation((select token from tests.tokens where label = 'n1')), null::uuid, 'Une adresse non confirmée n''accepte pas');
reset role;

insert into private.account_status (user_id, status, reason, changed_by)
values ('d0000000-0000-0000-0000-000000004505', 'suspended', 'Test', 'a0000000-0000-0000-0000-000000004501');
select tests.login('d0000000-0000-0000-0000-000000004505');
select throws_ok(
  $$ select public.accept_project_invitation((select token from tests.tokens where label = 'x1')) $$,
  '42501', 'forbidden', 'Un compte suspendu n''accepte pas'
);
reset role;

-- Invitation expirée.
update public.project_invitations set expires_at = now() - interval '1 minute' where email = 'partage-b@test.invalid';
select tests.login('b0000000-0000-0000-0000-000000004503');
select is(public.accept_project_invitation((select token from tests.tokens where label = 'b1')), null::uuid, 'Une invitation expirée ne s''accepte pas');
reset role;

-- Nouvelle invitation à la même adresse : la précédente est remplacée ; puis révocation.
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 'b2', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-b@test.invalid", "role": "viewer"}');
select lives_ok(
  $$ select public.revoke_project_invitation((
       select (i ->> 'id')::uuid from jsonb_array_elements(public.project_sharing('45000000-0000-0000-0000-0000000000a1') -> 'invitations') i
       where i ->> 'email' = 'partage-b@test.invalid')) $$,
  'Le propriétaire révoque une invitation'
);
reset role;
select is(
  (select count(*) from public.project_invitations where email = 'partage-b@test.invalid' and status = 'pending'),
  0::bigint, 'Aucune invitation ne reste en attente pour cette adresse'
);
select tests.login('b0000000-0000-0000-0000-000000004503');
select is(public.accept_project_invitation((select token from tests.tokens where label = 'b2')), null::uuid, 'Une invitation révoquée ne s''accepte pas');
select throws_ok(
  $$ select public.revoke_project_invitation((select id from public.project_invitations limit 1)) $$,
  '42501', null, 'Un tiers ne lit pas la table des invitations'
);
reset role;

-- ---------------------------------------------------------------------------
-- Retirer, quitter
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000004503');
select throws_ok(
  $$ select public.leave_project('45000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'On ne quitte pas un projet dont on n''est pas membre'
);
reset role;

-- Réinvitée alors qu'elle est déjà membre (changement de rôle), puis retirée :
-- le second lien ne la fait pas revenir.
delete from private.rate_limit_buckets where bucket_key like 'project-invite:%';
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 's-bis', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-s@test.invalid", "role": "viewer"}');
select lives_ok(
  $$ select public.remove_project_member('45000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000004502') $$,
  'Le propriétaire retire son encadreure'
);
reset role;
select is(
  (select count(*) from public.audit_logs
   where action = 'project.unshared' and subject_user_id = 'a0000000-0000-0000-0000-000000004501'
     and metadata ->> 'reason' = 'removed'
     and metadata ->> 'member_id' = '50000000-0000-0000-0000-000000004502'),
  1::bigint, 'Le retrait est journalisé, avec sa nature'
);
select tests.login('50000000-0000-0000-0000-000000004502');
select is(
  public.accept_project_invitation((select token from tests.tokens where label = 's-bis')), null::uuid,
  'Retirée, elle ne revient pas par une invitation restée en attente'
);
reset role;
select tests.login('50000000-0000-0000-0000-000000004502');
select throws_ok(
  $$ select public.shared_project_document('45000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Retirée, elle ne lit plus rien, dès la requête suivante'
);
select is((select count(*) from public.shared_projects()), 0::bigint, 'Et le projet n''est plus dans sa liste');
reset role;

-- Réinvitée, elle accepte, puis quitte d'elle-même.
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 's2', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-s@test.invalid", "role": "viewer"}');
reset role;
select tests.login('50000000-0000-0000-0000-000000004502');
select isnt(public.accept_project_invitation((select token from tests.tokens where label = 's2')), null::uuid, 'Réinvitée, elle accepte de nouveau');
select lives_ok($$ select public.leave_project('45000000-0000-0000-0000-0000000000a1') $$, 'Elle quitte le projet');
select is((select count(*) from public.shared_projects()), 0::bigint, 'Le projet n''est plus partagé avec elle');
reset role;

select is(
  (select count(*) from public.audit_logs
   where action = 'project.unshared' and metadata ->> 'reason' = 'left'
     and actor_id = '50000000-0000-0000-0000-000000004502'),
  1::bigint, 'Le départ est journalisé comme tel'
);

-- ---------------------------------------------------------------------------
-- Plafonds et remplacement
-- ---------------------------------------------------------------------------
delete from private.rate_limit_buckets where bucket_key like 'project-invite:%';
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 'r1', public.invite_project_member('45000000-0000-0000-0000-0000000000a2', '{"email": "partage-b@test.invalid", "role": "viewer"}');
insert into tests.tokens
select 'r2', public.invite_project_member('45000000-0000-0000-0000-0000000000a2', '{"email": "partage-b@test.invalid", "role": "viewer"}');
select lives_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a2', '{"email": "partage-b@test.invalid", "role": "viewer"}') $$,
  'Troisième invitation du jour à la même adresse : acceptée'
);
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a2', '{"email": "partage-b@test.invalid", "role": "viewer"}') $$,
  'P0001', 'rate_limited', 'La quatrième est refusée : trois par jour vers une même adresse'
);
reset role;
select is(
  (select count(*) from private.rate_limit_buckets where bucket_key like '%partage-b%'),
  0::bigint, 'Le compteur ne retient pas l''adresse'
);
select tests.login('b0000000-0000-0000-0000-000000004503');
select is(public.accept_project_invitation((select token from tests.tokens where label = 'r1')), null::uuid, 'Un jeton remplacé, encore non expiré, ne vaut plus');
reset role;

-- Dix invitations en attente au plus par projet.
delete from private.rate_limit_buckets where bucket_key like 'project-invite:%';
insert into public.project_invitations (project_id, email, role, token_hash, expires_at)
select '45000000-0000-0000-0000-0000000000a2', 'plein-' || g || '@test.invalid', 'viewer',
       encode(sha256(convert_to('plein-' || g, 'UTF8')), 'hex'), now() + interval '1 day'
from generate_series(1, 9) g;
select tests.login('a0000000-0000-0000-0000-000000004501');
select throws_ok(
  $$ select public.invite_project_member('45000000-0000-0000-0000-0000000000a2', '{"email": "de-trop@test.invalid", "role": "viewer"}') $$,
  'P0001', 'limit_reached', 'Dix invitations en attente au plus par projet'
);
reset role;

-- Purge des invitations closes : par le propriétaire de la base seulement.
update public.project_invitations set status = 'revoked', created_at = now() - interval '40 days', expires_at = now() - interval '33 days'
where email = 'plein-1@test.invalid';
select tests.login('a0000000-0000-0000-0000-000000004501');
select throws_ok($$ select private.purge_stale_invitations() $$, '42501', null, 'Un utilisateur ne lance pas la purge des invitations');
reset role;
select cmp_ok(private.purge_stale_invitations(), '>=', 1, 'La purge efface les invitations closes depuis plus de trente jours');
select is(
  (select count(*) from public.project_invitations where email like 'plein-%@test.invalid'),
  8::bigint, 'Et laisse les autres'
);

-- Aucune des fonctions n'est exécutable par le visiteur ni par le rôle serveur.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('invite_project_member', 'revoke_project_invitation', 'remove_project_member',
                       'project_sharing', 'invitation_preview', 'accept_project_invitation',
                       'leave_project', 'shared_projects', 'shared_project_document')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent les fonctions de partage'
);

-- ---------------------------------------------------------------------------
-- Projet supprimé, compte supprimé
-- ---------------------------------------------------------------------------
delete from private.rate_limit_buckets where bucket_key like 'project-invite:%';
select tests.login('a0000000-0000-0000-0000-000000004501');
insert into tests.tokens
select 's3', public.invite_project_member('45000000-0000-0000-0000-0000000000a1', '{"email": "partage-s@test.invalid", "role": "supervisor"}');
reset role;
select tests.login('50000000-0000-0000-0000-000000004502');
select isnt(public.accept_project_invitation((select token from tests.tokens where label = 's3')), null::uuid, 'Elle est de nouveau membre');
reset role;
update public.research_projects set deleted_at = now() where id = '45000000-0000-0000-0000-0000000000a1';
select tests.login('50000000-0000-0000-0000-000000004502');
select throws_ok(
  $$ select public.shared_project_document('45000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Un projet supprimé n''est plus lisible par ses membres'
);
select is((select count(*) from public.shared_projects()), 0::bigint, 'Ni listé');
reset role;

delete from auth.users where id = '50000000-0000-0000-0000-000000004502';
select is(
  (select count(*) from public.research_project_members where user_id = '50000000-0000-0000-0000-000000004502'),
  0::bigint, 'La suppression d''un compte efface ses appartenances'
);

-- Le propriétaire supprime son compte alors que son projet a des invitations et
-- un membre qu'il a lui-même invités. (Régression : la suppression butait sur
-- les colonnes « qui a invité ».)
select set_config('request.jwt.claims', '', true);
insert into public.research_project_members (project_id, user_id, role, invited_by) values
  ('45000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-000000004503', 'viewer', 'a0000000-0000-0000-0000-000000004501');
select cmp_ok(
  (select count(*) from public.project_invitations where created_by = 'a0000000-0000-0000-0000-000000004501'),
  '>=', 1::bigint, 'Le propriétaire a des invitations à son nom'
);
select lives_ok(
  $$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000004501' $$,
  'Le propriétaire d''un projet partagé supprime son compte'
);
select is(
  (select count(*) from public.research_project_members m join public.project_invitations i on true
   where m.project_id::text like '45000000-0000-0000-0000-0000000000a_' or i.project_id::text like '45000000-0000-0000-0000-0000000000a_'),
  0::bigint, 'Membres et invitations partent avec ses projets'
);

select * from finish();
rollback;
