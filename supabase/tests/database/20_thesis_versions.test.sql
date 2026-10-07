-- E-03 : versions soumises et décisions de l'encadreur.

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
create table tests.ids (label text primary key, id uuid);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.ids to authenticated;

-- A : propriétaire. S : encadreur. V : lecteur. B : tiers.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vers-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000005002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vers-s@test.invalid', now()),
  ('60000000-0000-0000-0000-000000005003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vers-v@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000005004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vers-b@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000500_';
insert into public.research_projects (id, owner_id, title) values
  ('50000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000005001', 'Mémoire de A'),
  ('50000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000005001', 'Projet vide de A');
insert into public.project_sources (id, project_id, title) values
  ('50000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000a1', 'Source de A');
insert into public.literature_notes (source_id, problem) values
  ('50000000-0000-0000-0000-0000000000c1', 'Note de travail privée');
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('50000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000a1', 1, 'Introduction', 'Premier jet de A.');
insert into public.section_citations (section_id, source_id, pages) values
  ('50000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000c1', 'p. 3');
insert into public.research_project_members (project_id, user_id, role) values
  ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005002', 'supervisor'),
  ('50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000005003', 'viewer');

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.thesis_versions', 'public.version_decisions']) t,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, t, p)),
  0::bigint, 'Versions et décisions ne se lisent ni ne s''écrivent directement'
);

-- ---------------------------------------------------------------------------
-- Soumettre
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000005001');
insert into tests.ids
select 'v1', public.submit_thesis_version('50000000-0000-0000-0000-0000000000a1', '{"label": " Premier jet ", "note": "Merci de relire l''introduction."}');
select isnt((select id from tests.ids where label = 'v1'), null, 'Le propriétaire soumet une version');
select throws_ok(
  $$ select public.submit_thesis_version('50000000-0000-0000-0000-0000000000a2', '{}') $$,
  '22023', 'nothing_to_submit', 'Un projet sans section n''a rien à soumettre'
);
select throws_ok(
  $$ select public.submit_thesis_version('50000000-0000-0000-0000-0000000000a1', jsonb_build_object('label', repeat('a', 121))) $$,
  '22023', 'invalid_payload', 'Un intitulé trop long est refusé'
);
reset role;
select is(
  (select number || '/' || label || '/' || word_count || '/' || (snapshot #>> '{sections,0,body}') || '/' || (snapshot #>> '{citations,0,pages}')
   from public.thesis_versions where id = (select id from tests.ids where label = 'v1')),
  '1/Premier jet/4/Premier jet de A./p. 3', 'L''instantané porte le texte, les citations et le nombre de mots'
);
select is(
  (select snapshot::text like '%Note de travail privée%' from public.thesis_versions where id = (select id from tests.ids where label = 'v1')),
  false, 'Pas les fiches de lecture'
);

-- Le texte change ensuite : la version soumise, elle, ne bouge pas.
update public.thesis_sections set body = 'Second jet de A, plus long.' where id = '50000000-0000-0000-0000-0000000000d1';
select is(
  (select snapshot #>> '{sections,0,body}' from public.thesis_versions where id = (select id from tests.ids where label = 'v1')),
  'Premier jet de A.', 'Une version soumise est figée'
);

-- Ni l'encadreur, ni le lecteur, ni un tiers ne soumettent.
select tests.login('50000000-0000-0000-0000-000000005002');
select throws_ok(
  $$ select public.submit_thesis_version('50000000-0000-0000-0000-0000000000a1', '{}') $$,
  null, 'not_found', 'L''encadreur ne soumet pas à la place de l''étudiant'
);
reset role;

-- ---------------------------------------------------------------------------
-- Lire
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000005002');
select is(
  public.project_versions('50000000-0000-0000-0000-0000000000a1') #>> '{versions,0,note}',
  'Merci de relire l''introduction.', 'L''encadreur lit la liste des versions et le mot de l''étudiant'
);
select is(
  public.project_version((select id from tests.ids where label = 'v1')) #>> '{snapshot,sections,0,body}',
  'Premier jet de A.', 'Et le document soumis'
);
reset role;
select tests.login('60000000-0000-0000-0000-000000005003');
select is(
  jsonb_array_length(public.project_versions('50000000-0000-0000-0000-0000000000a1') -> 'versions'), 1,
  'Le lecteur à accès complet lit aussi les versions'
);
reset role;
select tests.login('b0000000-0000-0000-0000-000000005004');
select throws_ok(
  $$ select public.project_versions('50000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Un tiers ne lit pas les versions'
);
select throws_ok(
  $$ select public.project_version((select id from tests.ids where label = 'v1')) $$,
  null, 'not_found', 'Ni un document dont il connaîtrait l''identifiant'
);
select throws_ok(
  $$ select public.project_version('99999999-0000-0000-0000-000000000000') $$,
  null, 'not_found', 'Une version inconnue reçoit la même réponse'
);
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "accepted"}') $$,
  null, 'not_found', 'Ni ne rend de décision'
);
reset role;

-- ---------------------------------------------------------------------------
-- Décider
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000005001');
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "accepted"}') $$,
  '42501', 'forbidden', 'Le propriétaire ne décide pas de sa propre version'
);
reset role;
select tests.login('60000000-0000-0000-0000-000000005003');
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "accepted"}') $$,
  '42501', 'forbidden', 'Un lecteur simple non plus'
);
reset role;

select tests.login('50000000-0000-0000-0000-000000005002');
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "changes_requested"}') $$,
  '22023', 'reason_required', 'Demander une correction se motive'
);
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "rejected", "comment": "   "}') $$,
  '22023', 'reason_required', 'Refuser aussi'
);
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "validated"}') $$,
  '22023', 'invalid_payload', 'Une décision inconnue est refusée'
);
select lives_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "changes_requested", "comment": "Précisez la problématique."}') $$,
  'L''encadreur demande une correction'
);
select lives_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v1'), '{"decision": "accepted"}') $$,
  'Puis accepte : la nouvelle décision s''ajoute'
);
reset role;
select is(
  (select string_agg(decision, ',' order by decided_at, id) from public.version_decisions
   where version_id = (select id from tests.ids where label = 'v1')),
  'changes_requested,accepted', 'L''historique garde les deux décisions'
);

-- Le propriétaire lit les décisions, et qui les a rendues ; le lecteur lit la décision, pas l'adresse.
select tests.login('a0000000-0000-0000-0000-000000005001');
select is(
  public.project_versions('50000000-0000-0000-0000-0000000000a1') #>> '{versions,0,decisions,0,decided_by_email}',
  'vers-s@test.invalid', 'Le propriétaire voit qui a décidé'
);
select is(
  public.project_versions('50000000-0000-0000-0000-0000000000a1') #>> '{versions,0,decisions,0,comment}',
  'Précisez la problématique.', 'Et le motif'
);
reset role;
select tests.login('60000000-0000-0000-0000-000000005003');
select is(
  public.project_versions('50000000-0000-0000-0000-0000000000a1') #>> '{versions,0,decisions,1,decision}', 'accepted',
  'Le lecteur lit les décisions'
);
select is(
  public.project_versions('50000000-0000-0000-0000-0000000000a1') #>> '{versions,0,decisions,1,decided_by_email}', null,
  'Sans l''adresse de l''encadreur'
);
reset role;

-- ---------------------------------------------------------------------------
-- Deuxième version : ce qui a changé
-- ---------------------------------------------------------------------------
delete from private.rate_limit_buckets where bucket_key like 'version-%';
select tests.login('a0000000-0000-0000-0000-000000005001');
insert into tests.ids
select 'v2', public.submit_thesis_version('50000000-0000-0000-0000-0000000000a1', '{}');
select is(
  public.project_version((select id from tests.ids where label = 'v2')) #>> '{previous_digests,0,digest}',
  md5('Premier jet de A.'), 'Une version rend l''empreinte des sections de la précédente, pour comparer'
);
select isnt(
  public.project_version((select id from tests.ids where label = 'v2')) #>> '{digests,0,digest}',
  md5('Premier jet de A.'), 'Et celle des siennes, qui diffère : le texte a changé'
);
select is(
  public.project_version((select id from tests.ids where label = 'v2'))::text like '%Premier jet de A.%', false,
  'Sans transporter le texte de la version précédente'
);
select is(
  jsonb_typeof(public.project_version((select id from tests.ids where label = 'v1')) -> 'previous_digests'), 'null',
  'La première n''a pas de précédente'
);
select is(
  (select string_agg((v ->> 'number'), ',') from jsonb_array_elements(public.project_versions('50000000-0000-0000-0000-0000000000a1') -> 'versions') v),
  '2,1', 'Les versions sont numérotées, la plus récente d''abord'
);
reset role;

-- ---------------------------------------------------------------------------
-- Immuabilité, effacement voulu
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.thesis_versions set note = 'Réécrit' where id = (select id from tests.ids where label = 'v1') $$,
  '42501', null, 'Même le propriétaire de la base ne modifie pas une version'
);
select throws_ok(
  $$ update public.version_decisions set decision = 'rejected', comment = 'Réécrit' $$,
  '42501', null, 'Ni une décision'
);

select tests.login('50000000-0000-0000-0000-000000005002');
select throws_ok(
  $$ select public.erase_thesis_version((select id from tests.ids where label = 'v1')) $$,
  null, 'not_found', 'L''encadreur n''efface pas la version de l''étudiant'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000005001');
select lives_ok(
  $$ select public.erase_thesis_version((select id from tests.ids where label = 'v1')) $$,
  'Le propriétaire efface le contenu d''une version soumise par erreur'
);
select throws_ok(
  $$ select public.erase_thesis_version((select id from tests.ids where label = 'v1')) $$,
  null, 'not_found', 'Une version déjà effacée ne s''efface pas deux fois'
);
select is(
  (select (v ->> 'erased') || '/' || (v ->> 'section_count') || '/' || jsonb_array_length(v -> 'decisions')
   from jsonb_array_elements(public.project_versions('50000000-0000-0000-0000-0000000000a1') -> 'versions') v
   where v ->> 'number' = '1'),
  'true/0/2', 'La trace de la soumission et ses décisions restent ; le document est parti'
);
select is(
  (select count(*) from public.my_account_events() where action = 'project.version_erased'), 1::bigint,
  'L''effacement figure parmi les événements du compte'
);
select is(
  (select count(*) from public.my_thesis_versions()), 2::bigint, 'Le propriétaire retrouve ses versions dans la copie de ses données'
);
reset role;
select is(
  (select snapshot::text like '%Premier jet%' or note is not null from public.thesis_versions where id = (select id from tests.ids where label = 'v1')),
  false, 'Ni le texte ni le mot d''accompagnement ne restent en base'
);
select tests.login('50000000-0000-0000-0000-000000005002');
select is(
  (select count(*) from public.my_version_decisions()), 2::bigint, 'L''encadreur retrouve ses décisions dans la copie de ses données'
);
reset role;

-- L'encadreur retiré : sa décision reste, sans son adresse.
delete from public.research_project_members where user_id = '50000000-0000-0000-0000-000000005002';
select tests.login('a0000000-0000-0000-0000-000000005001');
select is(
  (select v #>> '{decisions,0,decided_by_email}'
   from jsonb_array_elements(public.project_versions('50000000-0000-0000-0000-0000000000a1') -> 'versions') v
   where v ->> 'number' = '1'),
  null, 'L''adresse d''un encadreur retiré n''est plus rendue'
);
reset role;
select tests.login('50000000-0000-0000-0000-000000005002');
select throws_ok(
  $$ select public.project_version((select id from tests.ids where label = 'v2')) $$,
  null, 'not_found', 'Retiré, l''encadreur ne lit plus les versions'
);
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v2'), '{"decision": "accepted"}') $$,
  null, 'not_found', 'Ni ne décide'
);
reset role;
insert into public.research_project_members (project_id, user_id, role) values
  ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000005002', 'supervisor');

-- ---------------------------------------------------------------------------
-- Plafonds
-- ---------------------------------------------------------------------------
insert into public.thesis_versions (project_id, number, snapshot)
select '50000000-0000-0000-0000-0000000000a1', g, '{"sections": []}'::jsonb from generate_series(3, 30) g;
-- Taille : une version au-delà de trois mégaoctets ne se range pas.
select throws_ok(
  $$ insert into public.thesis_versions (project_id, number, snapshot, size_bytes)
     values ('50000000-0000-0000-0000-0000000000a2', 1, '{"sections": []}'::jsonb, 3145729) $$,
  '23514', null, 'Une version de plus de trois mégaoctets est refusée'
);
delete from private.rate_limit_buckets where bucket_key like 'version-%';
select tests.login('a0000000-0000-0000-0000-000000005001');
select throws_ok(
  $$ select public.submit_thesis_version('50000000-0000-0000-0000-0000000000a1', '{}') $$,
  'P0001', 'limit_reached', 'Trente versions au plus par projet'
);
reset role;
delete from public.thesis_versions where number > 2 and project_id = '50000000-0000-0000-0000-0000000000a1';

-- Soixante mégaoctets au plus pour l'ensemble des versions d'un compte.
insert into public.thesis_versions (project_id, number, snapshot, size_bytes)
select '50000000-0000-0000-0000-0000000000a2', g, '{"sections": []}'::jsonb, 3145728 from generate_series(1, 20) g;
delete from private.rate_limit_buckets where bucket_key like 'version-%';
select tests.login('a0000000-0000-0000-0000-000000005001');
select throws_ok(
  $$ select public.submit_thesis_version('50000000-0000-0000-0000-0000000000a1', '{}') $$,
  'P0001', 'limit_reached', 'Soixante mégaoctets de versions au plus par compte'
);
reset role;
delete from public.thesis_versions where project_id = '50000000-0000-0000-0000-0000000000a2';

-- ---------------------------------------------------------------------------
-- Retrait, second facteur, suppression de compte
-- ---------------------------------------------------------------------------
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000005002', '50000000-0000-0000-0000-000000005002', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('50000000-0000-0000-0000-000000005002', 'aal1');
select throws_ok(
  $$ select public.decide_thesis_version((select id from tests.ids where label = 'v2'), '{"decision": "accepted"}') $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne décide pas'
);
select throws_ok(
  $$ select public.project_version((select id from tests.ids where label = 'v2')) $$,
  '42501', 'forbidden', 'Ni ne lit une version'
);
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000005002';

-- Membre limité (portée par section, à venir) : une version exige l'accès complet.
update public.research_project_members set full_access = false where user_id = '60000000-0000-0000-0000-000000005003';
select tests.login('60000000-0000-0000-0000-000000005003');
select throws_ok(
  $$ select public.project_versions('50000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Sans accès complet, pas de version'
);
reset role;

-- L'encadreur supprime son compte : ses décisions restent, sans son identifiant.
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$ delete from auth.users where id = '50000000-0000-0000-0000-000000005002' $$,
  'L''encadreur supprime son compte'
);
select is(
  (select count(*) || '/' || count(decided_by) from public.version_decisions
   where version_id = (select id from tests.ids where label = 'v1')),
  '2/0', 'Ses décisions restent dans l''historique, sans son identifiant'
);

-- Le propriétaire supprime son compte : versions et décisions partent avec le projet.
select lives_ok(
  $$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000005001' $$,
  'Le propriétaire d''un projet à versions supprime son compte'
);
select is(
  (select count(*) from public.thesis_versions v full join public.version_decisions d on false
   where coalesce(v.project_id, d.project_id) = '50000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Versions et décisions partent avec le projet'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('submit_thesis_version', 'decide_thesis_version', 'project_versions', 'project_version')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent les fonctions de version'
);

select * from finish();
rollback;
