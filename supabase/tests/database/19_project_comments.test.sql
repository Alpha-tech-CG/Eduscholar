-- E-02 : commentaires sur les sections d'un projet partagé.

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
  ('a0000000-0000-0000-0000-000000004701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comm-a@test.invalid', now()),
  ('50000000-0000-0000-0000-000000004702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comm-s@test.invalid', now()),
  ('60000000-0000-0000-0000-000000004703', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comm-v@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000004704', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comm-b@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000470_';
insert into public.research_projects (id, owner_id, title) values
  ('47000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000004701', 'Mémoire de A'),
  ('47000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000004704', 'Projet de B');
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('47000000-0000-0000-0000-0000000000d1', '47000000-0000-0000-0000-0000000000a1', 1, 'Introduction', 'Texte de A.'),
  ('47000000-0000-0000-0000-0000000000d2', '47000000-0000-0000-0000-0000000000a1', 2, 'Méthode', 'Autre texte.'),
  ('47000000-0000-0000-0000-0000000000d9', '47000000-0000-0000-0000-0000000000b1', 1, 'Section de B', 'Texte de B.');
insert into public.research_project_members (project_id, user_id, role) values
  ('47000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000004702', 'supervisor'),
  ('47000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000004703', 'viewer');

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'public.project_comments', p)),
  0::bigint, 'Les commentaires ne se lisent ni ne s''écrivent directement'
);

-- ---------------------------------------------------------------------------
-- Commenter
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000004702');
insert into tests.ids
select 'c1', public.add_project_comment('47000000-0000-0000-0000-0000000000d1',
  jsonb_build_object('body', E'  Précisez la question.\r\nMerci.  ', 'quote', 'Texte de A.'));
select isnt((select id from tests.ids where label = 'c1'), null, 'L''encadreur commente une section');
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "   "}') $$,
  '22023', 'invalid_payload', 'Un commentaire vide est refusé'
);
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', jsonb_build_object('body', repeat('a', 2001))) $$,
  '22023', 'invalid_payload', 'Un commentaire trop long aussi'
);
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', jsonb_build_object('body', E'Texte ‮déguisé')) $$,
  '22023', 'invalid_payload', 'Et un texte portant un caractère de mise en forme caché'
);
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d9', '{"body": "Chez B"}') $$,
  null, 'not_found', 'On ne commente pas la section d''un projet où l''on n''est pas'
);
select throws_ok(
  $$ select public.add_project_comment('99999999-0000-0000-0000-000000000000', '{"body": "Nulle part"}') $$,
  null, 'not_found', 'Une section inconnue reçoit la même réponse'
);
reset role;
select is(
  (select body from public.project_comments where id = (select id from tests.ids where label = 'c1')),
  E'Précisez la question.\nMerci.', 'Le texte est rangé nettoyé, sauts de ligne simples'
);

-- Le propriétaire répond.
select tests.login('a0000000-0000-0000-0000-000000004701');
insert into tests.ids
select 'r1', public.add_project_comment('47000000-0000-0000-0000-0000000000d1',
  jsonb_build_object('body', 'C''est fait.', 'parent_id', (select id from tests.ids where label = 'c1'), 'quote', 'ignoré'));
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d2',
       jsonb_build_object('body', 'Mauvaise section', 'parent_id', (select id from tests.ids where label = 'c1'))) $$,
  null, 'not_found', 'Une réponse suit un commentaire de la même section'
);
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1',
       jsonb_build_object('body', 'Réponse à une réponse', 'parent_id', (select id from tests.ids where label = 'r1'))) $$,
  null, 'not_found', 'On ne répond pas à une réponse'
);
reset role;
select is(
  (select quote from public.project_comments where id = (select id from tests.ids where label = 'r1')),
  null, 'Une réponse ne porte pas de passage cité'
);

-- Le lecteur simple lit, mais n'écrit pas.
select tests.login('60000000-0000-0000-0000-000000004703');
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "Lecteur"}') $$,
  '42501', 'forbidden', 'Un lecteur simple ne commente pas'
);
select is(
  jsonb_array_length(public.project_comments('47000000-0000-0000-0000-0000000000a1') -> 'comments'), 2,
  'Mais il lit les commentaires'
);
select is(
  public.project_comments('47000000-0000-0000-0000-0000000000a1') ->> 'role', 'viewer', 'Sa place lui est rendue'
);
-- Il voit la place de chacun, l'adresse du propriétaire qu'il connaît déjà, pas celle de l'encadreur.
select is(
  (select string_agg((c ->> 'author_role') || ':' || coalesce(c ->> 'author_email', '-'), ',' order by c ->> 'author_role')
   from jsonb_array_elements(public.project_comments('47000000-0000-0000-0000-0000000000a1') -> 'comments') c),
  'owner:comm-a@test.invalid,supervisor:-', 'L''adresse d''un membre n''est pas rendue aux autres membres'
);
select throws_ok(
  $$ select public.resolve_project_thread((select id from tests.ids where label = 'c1'), true) $$,
  '42501', 'forbidden', 'Il ne clôt pas un fil'
);
reset role;

-- Le tiers ne lit rien.
select tests.login('b0000000-0000-0000-0000-000000004704');
select throws_ok(
  $$ select public.project_comments('47000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Un tiers ne lit pas les commentaires'
);
select throws_ok(
  $$ select public.resolve_project_thread((select id from tests.ids where label = 'c1'), true) $$,
  null, 'not_found', 'Ni ne clôt un fil dont il connaîtrait l''identifiant'
);
select throws_ok(
  $$ select public.delete_project_comment((select id from tests.ids where label = 'c1')) $$,
  null, 'not_found', 'Ni ne supprime un commentaire'
);
reset role;

-- ---------------------------------------------------------------------------
-- Lire : qui a écrit quoi
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000004701');
-- (L'adresse de l'encadreur est rendue au propriétaire, qui l'a invité.)
select is(
  (select c ->> 'author_role' || '/' || (c ->> 'mine') || '/' || (c ->> 'author_email') || '/' || (c ->> 'quote')
   from jsonb_array_elements(public.project_comments('47000000-0000-0000-0000-0000000000a1') -> 'comments') c
   where c ->> 'id' = (select id::text from tests.ids where label = 'c1')),
  'supervisor/false/comm-s@test.invalid/Texte de A.', 'Le propriétaire voit qui a commenté, et le passage visé'
);
select is(
  (select c ->> 'mine' from jsonb_array_elements(public.project_comments('47000000-0000-0000-0000-0000000000a1') -> 'comments') c
   where c ->> 'id' = (select id::text from tests.ids where label = 'r1')),
  'true', 'Et reconnaît les siens'
);

-- ---------------------------------------------------------------------------
-- Modifier, supprimer : les siens seulement
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.update_project_comment((select id from tests.ids where label = 'c1'), '{"body": "Réécrit par A"}') $$,
  null, 'not_found', 'Le propriétaire ne modifie pas le commentaire de son encadreur'
);
select throws_ok(
  $$ select public.delete_project_comment((select id from tests.ids where label = 'c1')) $$,
  null, 'not_found', 'Ni ne le supprime'
);
select lives_ok(
  $$ select public.update_project_comment((select id from tests.ids where label = 'r1'), '{"body": "C''est fait, page 2."}') $$,
  'Chacun modifie le sien'
);
reset role;
select is(
  (select body || '/' || (edited_at is not null) from public.project_comments where id = (select id from tests.ids where label = 'r1')),
  'C''est fait, page 2./true', 'La modification est marquée'
);

-- Clore, rouvrir.
select tests.login('a0000000-0000-0000-0000-000000004701');
select lives_ok($$ select public.resolve_project_thread((select id from tests.ids where label = 'c1'), true) $$, 'Le propriétaire clôt le fil');
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1',
       jsonb_build_object('body', 'Après clôture', 'parent_id', (select id from tests.ids where label = 'c1'))) $$,
  null, 'not_found', 'Un fil clos ne reçoit plus de réponse, même par appel direct'
);
select throws_ok(
  $$ select public.resolve_project_thread((select id from tests.ids where label = 'r1'), true) $$,
  null, 'not_found', 'Une réponse ne se clôt pas : seul le fil'
);
reset role;
select is(
  (select resolved_by from public.project_comments where id = (select id from tests.ids where label = 'c1')),
  'a0000000-0000-0000-0000-000000004701'::uuid, 'Le fil est clos, par qui'
);
select tests.login('50000000-0000-0000-0000-000000004702');
select lives_ok($$ select public.resolve_project_thread((select id from tests.ids where label = 'c1'), false) $$, 'L''encadreur le rouvre');
reset role;
select is(
  (select resolved_at from public.project_comments where id = (select id from tests.ids where label = 'c1')),
  null, 'Le fil est rouvert'
);

-- Supprimer un commentaire auquel on a répondu : il laisse sa place, sans son texte.
select tests.login('50000000-0000-0000-0000-000000004702');
select lives_ok($$ select public.delete_project_comment((select id from tests.ids where label = 'c1')) $$, 'L''encadreur retire son commentaire');
reset role;
select is(
  (select (body is null) || '/' || (quote is null) || '/' || (deleted_at is not null)
   from public.project_comments where id = (select id from tests.ids where label = 'c1')),
  'true/true/true', 'Son texte et le passage cité sont effacés ; le fil reste'
);
select is(
  (select count(*) from public.project_comments where id = (select id from tests.ids where label = 'r1')),
  1::bigint, 'La réponse du propriétaire n''est pas partie avec lui'
);
select tests.login('50000000-0000-0000-0000-000000004702');
select throws_ok(
  $$ select public.update_project_comment((select id from tests.ids where label = 'c1'), '{"body": "Revenant"}') $$,
  null, 'not_found', 'Un commentaire retiré ne se modifie plus'
);
reset role;
-- Une réponse sans suite est effacée pour de bon.
select tests.login('a0000000-0000-0000-0000-000000004701');
select lives_ok($$ select public.delete_project_comment((select id from tests.ids where label = 'r1')) $$, 'Le propriétaire supprime sa réponse');
reset role;
select is(
  (select count(*) from public.project_comments where id = (select id from tests.ids where label = 'r1')),
  0::bigint, 'Elle est effacée'
);

-- Un passage cité sur plusieurs lignes est ramené à une seule.
select tests.login('a0000000-0000-0000-0000-000000004701');
insert into tests.ids
select 'q1', public.add_project_comment('47000000-0000-0000-0000-0000000000d2',
  jsonb_build_object('body', 'Passage sur deux lignes.', 'quote', E'Première ligne\r\nseconde ligne'));
reset role;
select is(
  (select quote from public.project_comments where id = (select id from tests.ids where label = 'q1')),
  'Première ligne seconde ligne', 'Le passage cité tient sur une ligne'
);
delete from public.project_comments where id = (select id from tests.ids where label = 'q1');

-- Redevenu simple lecteur, un ancien encadreur ne touche plus à ses commentaires.
select tests.login('50000000-0000-0000-0000-000000004702');
insert into tests.ids
select 'd1', public.add_project_comment('47000000-0000-0000-0000-0000000000d2', '{"body": "Écrit comme encadreur."}');
reset role;
update public.research_project_members set role = 'viewer' where user_id = '50000000-0000-0000-0000-000000004702';
select tests.login('50000000-0000-0000-0000-000000004702');
select throws_ok(
  $$ select public.update_project_comment((select id from tests.ids where label = 'd1'), '{"body": "Réécrit comme lecteur"}') $$,
  '42501', 'forbidden', 'Un lecteur ne modifie pas ses anciens commentaires'
);
select throws_ok(
  $$ select public.delete_project_comment((select id from tests.ids where label = 'd1')) $$,
  '42501', 'forbidden', 'Ni ne les supprime'
);
reset role;
update public.research_project_members set role = 'supervisor' where user_id = '50000000-0000-0000-0000-000000004702';
delete from public.project_comments where id = (select id from tests.ids where label = 'd1');

-- Session au seul mot de passe d'un compte à second facteur : aucune écriture.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000004702', '50000000-0000-0000-0000-000000004702', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('50000000-0000-0000-0000-000000004702', 'aal1');
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "En aal1"}') $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne commente pas'
);
select throws_ok(
  $$ select public.resolve_project_thread((select id from public.project_comments limit 1), true) $$,
  '42501', null, 'Ni ne lit la table pour clore un fil'
);
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000004702';

-- ---------------------------------------------------------------------------
-- Retrait d'un membre, copie des données, plafonds
-- ---------------------------------------------------------------------------
select tests.login('50000000-0000-0000-0000-000000004702');
insert into tests.ids
select 'c2', public.add_project_comment('47000000-0000-0000-0000-0000000000d2', '{"body": "Second commentaire."}');
select is(
  (select count(*) from public.my_project_comments()), 1::bigint,
  'L''encadreur retrouve ses commentaires dans la copie de ses données, sans ceux qu''il a retirés'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000004701');
select is((select count(*) from public.my_project_comments()), 0::bigint, 'Pas ceux des autres');
reset role;

delete from public.research_project_members where user_id = '50000000-0000-0000-0000-000000004702';
select tests.login('50000000-0000-0000-0000-000000004702');
select throws_ok(
  $$ select public.project_comments('47000000-0000-0000-0000-0000000000a1') $$,
  null, 'not_found', 'Retiré, l''encadreur ne lit plus les commentaires'
);
select throws_ok(
  $$ select public.update_project_comment((select id from tests.ids where label = 'c2'), '{"body": "Après retrait"}') $$,
  null, 'not_found', 'Ni ne modifie les siens'
);
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "Après retrait"}') $$,
  null, 'not_found', 'Ni n''en ajoute'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000004701');
select is(
  (select (c ->> 'author_role') is null and (c ->> 'author_email') is null
   from jsonb_array_elements(public.project_comments('47000000-0000-0000-0000-0000000000a1') -> 'comments') c
   where c ->> 'id' = (select id::text from tests.ids where label = 'c2')),
  true, 'Le commentaire d''un ancien membre reste, sans son adresse'
);
reset role;

-- Plafonds par projet : cent cinquante par membre, trois cents pour l'ensemble des
-- membres ; le propriétaire garde la parole même quand ses membres ont atteint le leur.
insert into public.research_project_members (project_id, user_id, role) values
  ('47000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000004702', 'supervisor');
insert into public.project_comments (project_id, section_id, author_id, body)
select '47000000-0000-0000-0000-0000000000a1', '47000000-0000-0000-0000-0000000000d1',
       '50000000-0000-0000-0000-000000004702', 'Remplissage ' || g
from generate_series(1, 149 - (select count(*)::integer from public.project_comments
                               where project_id = '47000000-0000-0000-0000-0000000000a1'
                                 and author_id = '50000000-0000-0000-0000-000000004702')) g;
select tests.login('50000000-0000-0000-0000-000000004702');
select lives_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "Cent cinquantième"}') $$,
  'Le cent cinquantième commentaire d''un membre passe'
);
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "De trop"}') $$,
  'P0001', 'limit_reached', 'Le suivant est refusé : cent cinquante par membre'
);
reset role;
-- D'anciens membres ont laissé cent cinquante autres commentaires : le quota commun est atteint.
insert into public.project_comments (project_id, section_id, author_id, body)
select '47000000-0000-0000-0000-0000000000a1', '47000000-0000-0000-0000-0000000000d1',
       'b0000000-0000-0000-0000-000000004704', 'Ancien ' || g
from generate_series(1, 150) g;
select tests.login('a0000000-0000-0000-0000-000000004701');
select lives_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "Le propriétaire garde la parole."}') $$,
  'Le propriétaire commente encore quand ses membres ont atteint leur plafond'
);
reset role;
insert into public.project_comments (project_id, section_id, author_id, body)
select '47000000-0000-0000-0000-0000000000a1', '47000000-0000-0000-0000-0000000000d1',
       'a0000000-0000-0000-0000-000000004701', 'Du propriétaire ' || g
from generate_series(1, 299) g;
select tests.login('a0000000-0000-0000-0000-000000004701');
select throws_ok(
  $$ select public.add_project_comment('47000000-0000-0000-0000-0000000000d1', '{"body": "De trop"}') $$,
  'P0001', 'limit_reached', 'Trois cents commentaires au plus pour le propriétaire'
);
reset role;

-- Suppression du compte d'un membre : ses commentaires restent, sans son identifiant.
select set_config('request.jwt.claims', '', true);
update public.project_comments set resolved_at = now(), resolved_by = '50000000-0000-0000-0000-000000004702'
where id = (select id from public.project_comments
            where project_id = '47000000-0000-0000-0000-0000000000a1' and parent_id is null
              and author_id = 'a0000000-0000-0000-0000-000000004701' limit 1);
select lives_ok(
  $$ delete from auth.users where id = '50000000-0000-0000-0000-000000004702' $$,
  'Un membre supprime son compte'
);
select is(
  (select count(*) from public.project_comments
   where author_id = '50000000-0000-0000-0000-000000004702' or resolved_by = '50000000-0000-0000-0000-000000004702'),
  0::bigint, 'Son identifiant ne reste sur aucun commentaire'
);
select cmp_ok(
  (select count(*) from public.project_comments
   where project_id = '47000000-0000-0000-0000-0000000000a1' and author_id is null and body like 'Remplissage %'),
  '>=', 140::bigint, 'Ses commentaires restent dans le projet de l''étudiant'
);

-- Session au seul mot de passe d'un compte à second facteur, compte suspendu : rien.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000004701', 'a0000000-0000-0000-0000-000000004701', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('a0000000-0000-0000-0000-000000004701', 'aal1');
select throws_ok(
  $$ select public.project_comments('47000000-0000-0000-0000-0000000000a1') $$,
  '42501', 'forbidden', 'En session au seul mot de passe, un compte à second facteur ne lit pas les commentaires'
);
reset role;
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000004701';
insert into private.account_status (user_id, status, reason, changed_by)
values ('60000000-0000-0000-0000-000000004703', 'suspended', 'Test', 'a0000000-0000-0000-0000-000000004701');
select tests.login('60000000-0000-0000-0000-000000004703');
select throws_ok(
  $$ select public.project_comments('47000000-0000-0000-0000-0000000000a1') $$,
  '42501', 'forbidden', 'Un compte suspendu non plus'
);
reset role;

-- Section supprimée, projet supprimé, compte supprimé.
delete from public.thesis_sections where id = '47000000-0000-0000-0000-0000000000d2';
select is(
  (select count(*) from public.project_comments where section_id = '47000000-0000-0000-0000-0000000000d2'),
  0::bigint, 'Les commentaires partent avec leur section'
);
-- Le propriétaire supprime son compte : le projet part, avec les commentaires
-- qu'il a écrits ou clos, et ceux des autres. (Régression : la suppression
-- butait sur les colonnes « qui a écrit », « qui a clos ».)
select set_config('request.jwt.claims', '', true);
update public.project_comments set resolved_at = now(), resolved_by = 'a0000000-0000-0000-0000-000000004701'
where id = (select id from public.project_comments where project_id = '47000000-0000-0000-0000-0000000000a1' and parent_id is null limit 1);
select lives_ok(
  $$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000004701' $$,
  'Le propriétaire d''un projet commenté supprime son compte'
);
select is(
  (select count(*) from public.project_comments where project_id = '47000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'Les commentaires partent avec le projet de leur propriétaire'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('add_project_comment', 'update_project_comment', 'delete_project_comment',
                       'resolve_project_thread', 'project_comments', 'my_project_comments')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent les fonctions de commentaire'
);

select * from finish();
rollback;
