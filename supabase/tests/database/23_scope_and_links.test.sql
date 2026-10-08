-- E-06 : portée limitée à certaines sections ; invitation par lien.

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
create table tests.vals (label text primary key, val text);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.vals to authenticated;

-- A : propriétaire. S : encadreur limité. V : lecteur limité. B : tiers, futur demandeur. C : autre tiers.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000005601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portee-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000005602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portee-s@test.invalid', now()),
  ('60000000-0000-0000-0000-000000005603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portee-v@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000005604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portee-b@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000005605', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portee-c@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000560_';
update public.profile_public set display_name = 'Bintou B.' where user_id = 'b0000000-0000-0000-0000-000000005604';
insert into public.research_projects (id, owner_id, title, problem_statement) values
  ('56000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000005601', 'Mémoire de A', 'Problématique de A'),
  ('56000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000005601', 'Autre projet de A', null);
insert into public.project_sources (id, project_id, title) values
  ('56000000-0000-0000-0000-0000000000c1', '56000000-0000-0000-0000-0000000000a1', 'Source de A');
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('56000000-0000-0000-0000-0000000000d1', '56000000-0000-0000-0000-0000000000a1', 1, 'Introduction', 'Texte ouvert.'),
  ('56000000-0000-0000-0000-0000000000d2', '56000000-0000-0000-0000-0000000000a1', 2, 'Chapitre secret', 'Texte fermé.'),
  ('56000000-0000-0000-0000-0000000000d9', '56000000-0000-0000-0000-0000000000a2', 1, 'Section d''un autre projet', 'Ailleurs.');
insert into public.section_citations (section_id, source_id, pages) values
  ('56000000-0000-0000-0000-0000000000d1', '56000000-0000-0000-0000-0000000000c1', 'p. 3');

-- ---------------------------------------------------------------------------
-- Invitation à portée limitée
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000005601');
select throws_ok(
  $$ select public.invite_project_member('56000000-0000-0000-0000-0000000000a1',
       '{"email": "portee-s@test.invalid", "role": "supervisor", "section_ids": ["56000000-0000-0000-0000-0000000000d9"]}') $$,
  '22023', 'invalid_payload', 'Une portée ne nomme pas la section d''un autre projet'
);
select throws_ok(
  $$ select public.invite_project_member('56000000-0000-0000-0000-0000000000a1',
       '{"email": "portee-s@test.invalid", "role": "supervisor", "section_ids": []}') $$,
  '22023', 'invalid_payload', 'Ni une liste vide'
);
select throws_ok(
  $$ select public.invite_project_member('56000000-0000-0000-0000-0000000000a1',
       '{"email": "portee-s@test.invalid", "role": "supervisor", "section_ids": ["pas-un-identifiant"]}') $$,
  '22023', 'invalid_payload', 'Ni un identifiant mal formé'
);
insert into tests.vals
select 's', public.invite_project_member('56000000-0000-0000-0000-0000000000a1',
  '{"email": "portee-s@test.invalid", "role": "supervisor", "section_ids": ["56000000-0000-0000-0000-0000000000d1"]}');
reset role;

select tests.login('50000000-0000-0000-0000-000000005602');
select is(
  public.invitation_preview((select val from tests.vals where label = 's')) ->> 'full_access', 'false',
  'L''invitation dit que l''accès est limité'
);
select isnt(public.accept_project_invitation((select val from tests.vals where label = 's')), null, 'L''encadreur accepte');

-- ---------------------------------------------------------------------------
-- Ce que lit un membre limité
-- ---------------------------------------------------------------------------
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1') #>> '{project,title}',
  'Mémoire de A', 'Il lit la fiche du projet : son titre'
);
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1') #>> '{project,problem_statement}',
  null, 'Pas sa problématique, réservée à l''accès complet'
);
select is(
  (select string_agg(s ->> 'title', ',') from jsonb_array_elements(
     public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'sections') s),
  'Introduction', 'Et la seule section qui lui est ouverte'
);
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1')::text like '%secret%'
    or public.shared_project_document('56000000-0000-0000-0000-0000000000a1')::text like '%Texte fermé%', false,
  'Ni le texte ni le titre des autres sections'
);
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1') ->> 'full_access', 'false',
  'Le document dit que l''accès est limité'
);
select is(
  jsonb_array_length(public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'sources')
    + jsonb_array_length(public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'citations'),
  0, 'Ni sources ni citations'
);
select throws_ok(
  $$ select public.project_versions('56000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Ni versions soumises'
);
select throws_ok(
  $$ select public.project_tasks('56000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Ni tâches'
);

-- Commentaires : sur la section ouverte seulement.
select lives_ok(
  $$ select public.add_project_comment('56000000-0000-0000-0000-0000000000d1', '{"body": "Sur la section ouverte."}') $$,
  'Il commente la section qui lui est ouverte'
);
select throws_ok(
  $$ select public.add_project_comment('56000000-0000-0000-0000-0000000000d2', '{"body": "Sur la section fermée."}') $$,
  null, 'not_found', 'Pas une autre : la réponse est celle d''une section inconnue'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000005601');
insert into tests.vals
select 'c-ferme', public.add_project_comment('56000000-0000-0000-0000-0000000000d2', '{"body": "Note du propriétaire, section fermée."}')::text;
select public.add_project_comment('56000000-0000-0000-0000-0000000000d1', '{"body": "Note du propriétaire, section ouverte."}');
reset role;
select tests.login('50000000-0000-0000-0000-000000005602');
select is(
  (select count(*) from jsonb_array_elements(public.project_comments('56000000-0000-0000-0000-0000000000a1') -> 'comments') c
   where c ->> 'section_id' <> '56000000-0000-0000-0000-0000000000d1'),
  0::bigint, 'Il ne lit que les commentaires de la section ouverte'
);
select is(
  jsonb_array_length(public.project_comments('56000000-0000-0000-0000-0000000000a1') -> 'comments'), 2,
  'Les siens et ceux du propriétaire sur cette section'
);
select throws_ok(
  $$ select public.resolve_project_thread((select val::uuid from tests.vals where label = 'c-ferme'), true) $$,
  null, 'not_found', 'Il ne clôt pas un fil d''une section fermée, même avec son identifiant'
);
-- Notifications : celle de la section ouverte seulement.
select results_eq(
  $$ select kind, section_id from public.my_notifications() $$,
  $$ values ('comment', '56000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'Il n''est averti que de ce qui touche la section ouverte'
);
reset role;

-- ---------------------------------------------------------------------------
-- Le propriétaire change la portée
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000005602');
select throws_ok(
  $$ select public.set_member_scope('56000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005602', '{"full_access": true}') $$,
  null, 'not_found', 'Un membre n''élargit pas sa propre portée'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000005601');
select is(
  public.project_sharing('56000000-0000-0000-0000-0000000000a1') #>> '{members,0,full_access}', 'false',
  'Le propriétaire voit que l''accès de son encadreur est limité'
);
select is(
  public.project_sharing('56000000-0000-0000-0000-0000000000a1') #>> '{members,0,section_ids,0}',
  '56000000-0000-0000-0000-0000000000d1', 'Et à quelles sections'
);
select throws_ok(
  $$ select public.set_member_scope('56000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005602', '{"full_access": false}') $$,
  '22023', 'invalid_payload', 'Un accès limité nomme au moins une section'
);
select throws_ok(
  $$ select public.set_member_scope('56000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000005605', '{"full_access": true}') $$,
  null, 'not_found', 'On ne fixe pas la portée de qui n''est pas membre'
);
select lives_ok(
  $$ select public.set_member_scope('56000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005602',
       '{"full_access": false, "section_ids": ["56000000-0000-0000-0000-0000000000d2"]}') $$,
  'Le propriétaire ouvre une autre section, et ferme la première'
);
reset role;
select tests.login('50000000-0000-0000-0000-000000005602');
select is(
  (select string_agg(s ->> 'title', ',') from jsonb_array_elements(
     public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'sections') s),
  'Chapitre secret', 'La nouvelle portée prend effet à la requête suivante'
);
select is((select count(*) from public.my_project_comments()), 1::bigint, 'Il a un commentaire, sur la section désormais fermée');
select throws_ok(
  $$ select public.update_project_comment(
       (select id from public.my_project_comments() limit 1), '{"body": "Après la fermeture."}') $$,
  null, 'not_found', 'Il ne le modifie plus'
);
select throws_ok(
  $$ select public.delete_project_comment((select id from public.my_project_comments() limit 1)) $$,
  null, 'not_found', 'Ni ne le supprime'
);
select is(public.my_unread_notification_count(), 0, 'Le compteur de notifications suit la portée');
select is((select count(*) from public.my_notifications()), 0::bigint, 'Ni ne voit les notifications de cette section');
reset role;
-- Une invitation plus ancienne, en accès complet, ne lui rend pas ce que le
-- propriétaire vient de lui retirer : limiter la portée l'a annulée.
delete from private.rate_limit_buckets where bucket_key like 'project-invite:%';
select tests.login('a0000000-0000-0000-0000-000000005601');
insert into tests.vals
select 's-ancien', public.invite_project_member('56000000-0000-0000-0000-0000000000a1',
  '{"email": "portee-s@test.invalid", "role": "supervisor"}');
select lives_ok(
  $$ select public.set_member_scope('56000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005602',
       '{"full_access": false, "section_ids": ["56000000-0000-0000-0000-0000000000d2"]}') $$,
  'Le propriétaire confirme la portée limitée, une invitation en accès complet étant en attente'
);
reset role;
select tests.login('50000000-0000-0000-0000-000000005602');
select is(
  public.accept_project_invitation((select val from tests.vals where label = 's-ancien')), null::uuid,
  'L''ancienne invitation ne s''accepte plus'
);
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1') ->> 'full_access', 'false',
  'Et la portée reste celle que le propriétaire a fixée'
);
reset role;

select tests.login('a0000000-0000-0000-0000-000000005601');
select lives_ok(
  $$ select public.set_member_scope('56000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005602', '{"full_access": true}') $$,
  'Le propriétaire rend l''accès complet'
);
select is(
  (select count(*) from public.my_account_events() where action = 'project.scope_changed'), 3::bigint,
  'Les changements de portée figurent parmi les événements de son compte'
);
reset role;
select tests.login('50000000-0000-0000-0000-000000005602');
select is(
  jsonb_array_length(public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'sections'), 2,
  'En accès complet, il lit tout le document'
);
select is(
  jsonb_array_length(public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'citations'), 1,
  'Citations comprises'
);
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1') #>> '{project,problem_statement}',
  'Problématique de A', 'Et la problématique'
);
reset role;
select is(
  (select count(*) from public.research_project_member_sections where user_id = '50000000-0000-0000-0000-000000005602'),
  0::bigint, 'La liste des sections est vidée avec l''accès complet'
);

-- Une section supprimée sort de la portée d'elle-même.
insert into public.research_project_members (project_id, user_id, role, full_access) values
  ('56000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000005603', 'viewer', false);
insert into public.research_project_member_sections (project_id, user_id, section_id) values
  ('56000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000005603', '56000000-0000-0000-0000-0000000000d2');
delete from public.thesis_sections where id = '56000000-0000-0000-0000-0000000000d2';
select tests.login('60000000-0000-0000-0000-000000005603');
select is(
  jsonb_array_length(public.shared_project_document('56000000-0000-0000-0000-0000000000a1') -> 'sections'), 0,
  'Sa section supprimée, le lecteur limité ne lit plus que la fiche'
);
select throws_ok(
  $$ select public.add_project_comment('56000000-0000-0000-0000-0000000000d1', '{"body": "Lecteur"}') $$,
  null, 'not_found', 'Et ne voit pas davantage les autres sections'
);
reset role;

-- ---------------------------------------------------------------------------
-- Lien de partage : aucun droit, aucune information, accord du propriétaire
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.project_share_links', 'public.project_access_requests', 'public.research_project_member_sections']) t,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, t, p)),
  0::bigint, 'Liens, demandes et portées ne se lisent ni ne s''écrivent directement'
);

select tests.login('b0000000-0000-0000-0000-000000005604');
select throws_ok(
  $$ select public.create_project_link('56000000-0000-0000-0000-0000000000a1', '{"role": "viewer"}') $$,
  null, 'not_found', 'Un tiers ne crée pas de lien sur le projet d''un autre'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000005601');
select throws_ok(
  $$ select public.create_project_link('56000000-0000-0000-0000-0000000000a1', '{"role": "owner"}') $$,
  '22023', 'invalid_payload', 'Un lien ne propose pas le rôle de propriétaire'
);
insert into tests.vals
select 'l1', public.create_project_link('56000000-0000-0000-0000-0000000000a1', '{"role": "viewer"}');
insert into tests.vals
select 'l2', public.create_project_link('56000000-0000-0000-0000-0000000000a1', '{"role": "supervisor"}');
select is(
  public.project_sharing('56000000-0000-0000-0000-0000000000a1') #>> '{link,role}', 'supervisor',
  'Le propriétaire voit son lien actif — sans son jeton'
);
select is(
  public.project_sharing('56000000-0000-0000-0000-0000000000a1')::text like '%' || (select val from tests.vals where label = 'l2') || '%',
  false, 'Le jeton n''est rendu qu''à la création'
);
-- Lui-même ne se demande rien.
select lives_ok($$ select public.request_project_access((select val from tests.vals where label = 'l2')) $$, 'Le propriétaire qui ouvre son lien ne déclenche rien');
reset role;
select is((select count(*) from public.project_access_requests where project_id = '56000000-0000-0000-0000-0000000000a1'), 0::bigint, 'Aucune demande n''est créée pour lui');
select is(
  (select count(*) from public.project_share_links where token_hash in (select val from tests.vals)),
  0::bigint, 'La base ne garde que l''empreinte des jetons'
);

-- Le premier lien, remplacé, ne vaut plus : même réponse, aucune demande.
select tests.login('b0000000-0000-0000-0000-000000005604');
select lives_ok($$ select public.request_project_access((select val from tests.vals where label = 'l1')) $$, 'Un lien remplacé reçoit la même réponse');
select lives_ok($$ select public.request_project_access('jeton-invalide') $$, 'Un jeton mal formé aussi');
select lives_ok($$ select public.request_project_access(repeat('0', 64)) $$, 'Un jeton inconnu aussi');
reset role;
select is((select count(*) from public.project_access_requests where project_id = '56000000-0000-0000-0000-0000000000a1'), 0::bigint, 'Aucune demande n''est créée');

-- Le lien valable : une demande, et toujours aucun droit.
select tests.login('b0000000-0000-0000-0000-000000005604');
select lives_ok($$ select public.request_project_access((select val from tests.vals where label = 'l2')) $$, 'Avec le lien valable, la demande part');
select lives_ok($$ select public.request_project_access((select val from tests.vals where label = 'l2')) $$, 'La répéter ne crée rien de plus');
select is(public.my_pending_access_requests(), 1, 'Le demandeur sait qu''une demande attend');
select throws_ok(
  $$ select public.shared_project_document('56000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'La demande ne donne aucun droit'
);
select is((select count(*) from public.shared_projects()), 0::bigint, 'Ni aucune information sur le projet');
reset role;
select is((select count(*) from public.project_access_requests where status = 'pending'), 1::bigint, 'Une seule demande en attente');

-- Le propriétaire est averti, voit qui demande, et décide.
select tests.login('a0000000-0000-0000-0000-000000005601');
select is(
  (select count(*) from public.my_notifications() where kind = 'access_requested'), 1::bigint,
  'Le propriétaire est averti de la demande'
);
select is(
  public.project_sharing('56000000-0000-0000-0000-0000000000a1') #>> '{requests,0,email}', 'portee-b@test.invalid',
  'Il voit l''adresse du demandeur'
);
select is(
  public.project_sharing('56000000-0000-0000-0000-0000000000a1') #>> '{requests,0,display_name}', 'Bintou B.',
  'Et son nom d''affichage'
);
insert into tests.vals
select 'q1', public.project_sharing('56000000-0000-0000-0000-0000000000a1') #>> '{requests,0,id}';
reset role;

-- Un tiers, ou le demandeur lui-même, ne décide pas.
select tests.login('b0000000-0000-0000-0000-000000005604');
select throws_ok(
  $$ select public.decide_access_request((select val::uuid from tests.vals where label = 'q1'), true) $$,
  null, 'not_found', 'Le demandeur n''accepte pas sa propre demande'
);
reset role;

select tests.login('a0000000-0000-0000-0000-000000005601');
select lives_ok(
  $$ select public.decide_access_request((select val::uuid from tests.vals where label = 'q1'), true) $$,
  'Le propriétaire accepte'
);
select throws_ok(
  $$ select public.decide_access_request((select val::uuid from tests.vals where label = 'q1'), false) $$,
  null, 'not_found', 'Une demande déjà décidée ne se rejoue pas'
);
reset role;
select tests.login('b0000000-0000-0000-0000-000000005604');
select is(
  public.shared_project_document('56000000-0000-0000-0000-0000000000a1') ->> 'role', 'supervisor',
  'Accepté, le demandeur lit le projet, au rôle que proposait le lien'
);
select lives_ok($$ select public.request_project_access((select val from tests.vals where label = 'l2')) $$, 'Déjà membre, le lien ne crée plus de demande');
select is(public.my_pending_access_requests(), 0, 'Plus aucune demande en attente');
reset role;

-- Refus : aucun droit.
select tests.login('c0000000-0000-0000-0000-000000005605');
select public.request_project_access((select val from tests.vals where label = 'l2'));
reset role;
select tests.login('a0000000-0000-0000-0000-000000005601');
select lives_ok(
  $$ select public.decide_access_request(
       (select (q ->> 'id')::uuid from jsonb_array_elements(public.project_sharing('56000000-0000-0000-0000-0000000000a1') -> 'requests') q
        where q ->> 'email' = 'portee-c@test.invalid'), false) $$,
  'Le propriétaire refuse une autre demande'
);
-- Révoquer le lien : plus aucune demande n'en part.
select lives_ok($$ select public.revoke_project_link('56000000-0000-0000-0000-0000000000a1') $$, 'Il révoque le lien');
select is(public.project_sharing('56000000-0000-0000-0000-0000000000a1') -> 'link', 'null'::jsonb, 'Plus de lien actif');
reset role;
select tests.login('c0000000-0000-0000-0000-000000005605');
select throws_ok(
  $$ select public.shared_project_document('56000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Refusé, le demandeur ne lit rien'
);
select public.request_project_access((select val from tests.vals where label = 'l2'));
select is(public.my_pending_access_requests(), 0, 'Le lien révoqué ne crée plus de demande');
reset role;

-- Un nouveau lien : le demandeur refusé ne redemande pas avant trente jours ;
-- désactiver le lien refuse les demandes en attente.
delete from private.rate_limit_buckets where bucket_key like 'project-%';
select tests.login('a0000000-0000-0000-0000-000000005601');
insert into tests.vals
select 'l3', public.create_project_link('56000000-0000-0000-0000-0000000000a1', '{"role": "viewer"}');
reset role;
select tests.login('c0000000-0000-0000-0000-000000005605');
select public.request_project_access((select val from tests.vals where label = 'l3'));
select is(public.my_pending_access_requests(), 0, 'Refusé récemment, il ne redemande pas');
reset role;
update public.project_access_requests set decided_at = now() - interval '31 days'
where user_id = 'c0000000-0000-0000-0000-000000005605';
select tests.login('c0000000-0000-0000-0000-000000005605');
select public.request_project_access((select val from tests.vals where label = 'l3'));
select is(public.my_pending_access_requests(), 1, 'Trente jours plus tard, il peut redemander');
reset role;
select tests.login('a0000000-0000-0000-0000-000000005601');
select lives_ok($$ select public.revoke_project_link('56000000-0000-0000-0000-0000000000a1') $$, 'Le propriétaire désactive le lien');
select is(
  jsonb_array_length(public.project_sharing('56000000-0000-0000-0000-0000000000a1') -> 'requests'), 0,
  'Les demandes qui en étaient parties sont refusées avec lui'
);
reset role;

-- Session au seul mot de passe d'un compte à second facteur : pas de demande.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000005605', 'c0000000-0000-0000-0000-000000005605', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('c0000000-0000-0000-0000-000000005605', 'aal1');
select throws_ok(
  $$ select public.request_project_access(repeat('0', 64)) $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne demande rien'
);
reset role;

-- Purge.
update public.project_share_links set revoked_at = now() - interval '31 days';
update public.project_access_requests set decided_at = now() - interval '31 days' where status <> 'pending';
select cmp_ok(private.purge_stale_invitations(), '>=', 4, 'La purge efface liens révoqués et demandes closes depuis trente jours');
select is(
  (select count(*) from public.project_share_links) + (select count(*) from public.project_access_requests),
  0::bigint, 'Il n''en reste rien'
);

-- Suppression du compte du propriétaire : tout part avec ses projets.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000005601' $$, 'Le propriétaire supprime son compte');
select is(
  (select count(*) from public.research_project_member_sections where project_id = '56000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Les portées partent avec le projet'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_member_scope', 'create_project_link', 'revoke_project_link', 'request_project_access',
                       'decide_access_request', 'my_pending_access_requests')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent ces fonctions'
);

select * from finish();
rollback;
