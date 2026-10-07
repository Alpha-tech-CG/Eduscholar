-- Plan du mémoire : sections et sources citées (C-04).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

create table tests.ids (label text primary key, id uuid);
grant all on tests.ids to authenticated;

-- Acteurs : A et B au profil complété ; M modératrice.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000025e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000025e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-b@test.invalid'),
  ('d0000000-0000-0000-0000-0000000025e4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-m@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-0000000025e_';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000025e4', 'd0000000-0000-0000-0000-0000000025e4', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-0000000025e4', 'moderator');

-- Deux projets pour A (X et Y), un pour B ; une source dans chacun.
insert into public.research_projects (id, owner_id, title) values
  ('25e00000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000025e1', 'Projet X de A'),
  ('25e00000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000025e1', 'Projet Y de A'),
  ('25e00000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000025e2', 'Projet de B');
insert into public.project_sources (id, project_id, title) values
  ('25e00000-0000-0000-0000-00000000c0a1', '25e00000-0000-0000-0000-0000000000a1', 'Source de X'),
  ('25e00000-0000-0000-0000-00000000c0a2', '25e00000-0000-0000-0000-0000000000a2', 'Source de Y'),
  ('25e00000-0000-0000-0000-00000000c0b1', '25e00000-0000-0000-0000-0000000000b1', 'Source de B');

-- ---------------------------------------------------------------------------
-- Plan : ajout, ordre, modification
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000025e1');
insert into tests.ids select 'intro', public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1',
  '{"title": "  Introduction  ", "level": "1", "position": 99, "project_id": "25e00000-0000-0000-0000-0000000000b1", "body": "ignoré"}');
insert into tests.ids select 'etat', public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "État de l''art"}');
insert into tests.ids select 'methodes', public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Méthodes classiques", "level": "2"}');

select results_eq(
  $$ select title, position, level, project_id, body is null from public.thesis_sections order by position $$,
  $$ values ('Introduction', 1, 1::smallint, '25e00000-0000-0000-0000-0000000000a1'::uuid, true),
            ('État de l''art', 2, 1::smallint, '25e00000-0000-0000-0000-0000000000a1'::uuid, true),
            ('Méthodes classiques', 3, 2::smallint, '25e00000-0000-0000-0000-0000000000a1'::uuid, true) $$,
  'Les sections s''ajoutent à la suite ; rang, projet et texte ne viennent pas de la requête'
);

select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "   "}') $$,
  '23514', null, 'Un titre vide est refusé'
);
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Niveau", "level": "4"}') $$,
  '22023', 'invalid_payload', 'Un niveau hors de un à trois est refusé'
);
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Niveau", "level": "1; drop table x"}') $$,
  '22023', 'invalid_payload', 'Un niveau non numérique est refusé'
);
select throws_ok(
  $$ insert into public.thesis_sections (project_id, position, title) values ('25e00000-0000-0000-0000-0000000000a1', 9, 'Directe') $$,
  '42501', null, 'Aucune écriture directe dans le plan'
);
select throws_ok($$ update public.thesis_sections set body = 'Directe' $$, '42501', null, 'Aucune modification directe');
select throws_ok($$ delete from public.thesis_sections $$, '42501', null, 'Aucune suppression directe');
select throws_ok(
  $$ insert into public.section_citations (section_id, source_id)
     values ((select id from tests.ids where label = 'intro'), '25e00000-0000-0000-0000-00000000c0b1') $$,
  '42501', null, 'Aucune écriture directe dans les citations'
);

-- Texte.
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'),
       jsonb_build_object('body', E'\n  Premier paragraphe.\n\nSecond paragraphe.\n\n')) $$,
  'A rédige une section'
);
select results_eq(
  $$ select title, level, body from public.thesis_sections where id = (select id from tests.ids where label = 'intro') $$,
  $$ values ('Introduction', 1::smallint, E'Premier paragraphe.\n\nSecond paragraphe.') $$,
  'Le texte garde ses paragraphes ; titre et niveau, absents de la requête, sont conservés'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'), jsonb_build_object('body', repeat('a', 30001))) $$,
  '23514', null, 'Un texte de plus de trente mille caractères est refusé'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'), jsonb_build_object('body', E'Texte ‮déguisé')) $$,
  '23514', null, 'Un caractère de format invisible est refusé'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'),
       jsonb_build_object('body', 'Écrasement', 'expected_updated_at', '2020-01-01T00:00:00Z')) $$,
  '40001', 'conflict', 'Un texte modifié depuis sa lecture n''est pas écrasé'
);
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'),
       jsonb_build_object('title', 'Introduction générale',
         'expected_updated_at', (select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                 from public.thesis_sections where id = (select id from tests.ids where label = 'intro')))) $$,
  'Avec la bonne date de lecture, l''enregistrement passe'
);
select is(
  (select body from public.thesis_sections where id = (select id from tests.ids where label = 'intro')),
  E'Premier paragraphe.\n\nSecond paragraphe.', 'Le texte n''a pas été écrasé par le refus'
);

-- Fins de ligne et volume.
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'etat'), jsonb_build_object('body', E'Ligne un.\r\n\r\nLigne deux.\rLigne trois.\r\n')) $$,
  'Un texte aux fins de ligne Windows est accepté'
);
select is(
  (select body from public.thesis_sections where id = (select id from tests.ids where label = 'etat')),
  E'Ligne un.\n\nLigne deux.\nLigne trois.', 'Il est stocké avec des sauts de ligne simples'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'etat'), jsonb_build_object('body', repeat('😀', 30000))) $$,
  '23514', null, 'Un texte de trente mille caractères mais de plus de quatre-vingt-dix mille octets est refusé'
);
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'etat'), '{"body": ""}') $$,
  'Un texte vide efface le texte'
);

-- Ordre.
select lives_ok($$ select public.move_thesis_section((select id from tests.ids where label = 'methodes'), 'up') $$, 'A remonte une section');
select results_eq(
  $$ select title from public.thesis_sections order by position $$,
  $$ values ('Introduction générale'), ('Méthodes classiques'), ('État de l''art') $$,
  'Les deux sections ont échangé leur rang'
);
select lives_ok($$ select public.move_thesis_section((select id from tests.ids where label = 'intro'), 'up') $$, 'Remonter la première section est sans effet');
select lives_ok($$ select public.move_thesis_section((select id from tests.ids where label = 'etat'), 'down') $$, 'Descendre la dernière aussi');
select results_eq(
  $$ select title, position from public.thesis_sections order by position $$,
  $$ values ('Introduction générale', 1), ('Méthodes classiques', 2), ('État de l''art', 3) $$,
  'L''ordre est inchangé, les rangs restent distincts'
);
-- Déplacer une section ne compte pas comme une modification de son contenu.
select set_config('tests.lu',
  (select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
   from public.thesis_sections where id = (select id from tests.ids where label = 'methodes')), true);
select lives_ok($$ select public.move_thesis_section((select id from tests.ids where label = 'methodes'), 'down') $$, 'A déplace une section');
select lives_ok($$ select public.move_thesis_section((select id from tests.ids where label = 'methodes'), 'up') $$, 'Puis la remet à sa place');
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'methodes'),
       jsonb_build_object('body', 'Texte écrit après le déplacement.', 'expected_updated_at', current_setting('tests.lu'))) $$,
  'L''enregistrement d''un texte lu avant le déplacement passe : pas de faux conflit'
);
select throws_ok(
  $$ select public.move_thesis_section((select id from tests.ids where label = 'intro'), 'sideways') $$,
  '22023', 'invalid_payload', 'Une direction inconnue est refusée'
);

-- ---------------------------------------------------------------------------
-- Sources citées
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '25e00000-0000-0000-0000-00000000c0a1', true, ' p. 12-14 ') $$,
  'A cite une source de son projet dans une section'
);
select lives_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '25e00000-0000-0000-0000-00000000c0a1', true, 'p. 20') $$,
  'Citer la même source à nouveau met ses pages à jour'
);
select results_eq(
  $$ select source_id, pages from public.section_citations $$,
  $$ values ('25e00000-0000-0000-0000-00000000c0a1'::uuid, 'p. 20') $$,
  'Une seule citation par source et par section'
);
select throws_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '25e00000-0000-0000-0000-00000000c0a2', true) $$,
  null, 'not_found', 'Une source d''un autre de ses projets ne se cite pas'
);
select throws_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '25e00000-0000-0000-0000-00000000c0b1', true) $$,
  null, 'not_found', 'Ni la source d''autrui'
);
select throws_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '99999999-0000-0000-0000-000000000000', true) $$,
  null, 'not_found', 'Même réponse pour une source inexistante'
);
select lives_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '25e00000-0000-0000-0000-00000000c0b1', false) $$,
  'Retirer une citation absente est sans effet, quelle que soit la source'
);
reset role;

-- ---------------------------------------------------------------------------
-- Cloisonnement
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-0000000025e2');
select is_empty($$ select 1 from public.thesis_sections $$, 'B ne lit pas le plan de A');
select is_empty($$ select 1 from public.section_citations $$, 'Ni ses citations');
select is_empty($$ select private.my_section_ids() $$, 'La fonction d''appui ne lui rend rien');
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Intruse"}') $$,
  null, 'not_found', 'B n''ajoute pas de section au projet de A'
);
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '"texte"') $$,
  null, 'not_found', 'Une requête mal formée visant le projet de A répond aussi « introuvable »'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'), '{"body": "Piraté"}') $$,
  null, 'not_found', 'B ne modifie pas une section de A'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'), '{"level": "9", "expected_updated_at": "x"}') $$,
  null, 'not_found', 'Requête invalide comprise'
);
select throws_ok(
  $$ select public.update_thesis_section('99999999-0000-0000-0000-000000000000', '{"body": "Piraté"}') $$,
  null, 'not_found', 'Même réponse pour une section inexistante'
);
select throws_ok(
  $$ select public.move_thesis_section((select id from tests.ids where label = 'intro'), 'down') $$,
  null, 'not_found', 'B ne déplace pas une section de A'
);
select throws_ok(
  $$ select public.delete_thesis_section((select id from tests.ids where label = 'intro')) $$,
  null, 'not_found', 'Ni ne la supprime'
);
select throws_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'etat'), '25e00000-0000-0000-0000-00000000c0b1', true) $$,
  null, 'not_found', 'B ne rattache pas sa propre source à une section de A'
);
-- B, dans son propre projet, ne peut pas citer la source de A.
insert into tests.ids select 'b1', public.add_thesis_section('25e00000-0000-0000-0000-0000000000b1', '{"title": "Section de B"}');
select throws_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'b1'), '25e00000-0000-0000-0000-00000000c0a1', true) $$,
  null, 'not_found', 'B ne cite pas la source de A dans sa propre section'
);
reset role;

select tests.login('d0000000-0000-0000-0000-0000000025e4', 'aal2');
select is_empty($$ select 1 from public.thesis_sections $$, 'La modération ne lit aucun plan');
select is_empty($$ select 1 from public.section_citations $$, 'Ni aucune citation');
select throws_ok(
  $$ select public.delete_thesis_section((select id from tests.ids where label = 'intro')) $$,
  null, 'not_found', 'Ni ne supprime de section'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select 1 from public.thesis_sections $$, '42501', null, 'Le rôle serveur ne lit pas les sections');
select throws_ok($$ select 1 from public.section_citations $$, '42501', null, 'Ni les citations');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select 1 from public.thesis_sections $$, '42501', null, 'Un visiteur ne lit pas les sections');
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Visiteur"}') $$,
  '42501', null, 'Ni n''en ajoute'
);
reset role;

select results_eq(
  $$ select title from public.thesis_sections where project_id = '25e00000-0000-0000-0000-0000000000a1' order by position $$,
  $$ values ('Introduction générale'), ('Méthodes classiques'), ('État de l''art') $$,
  'Le plan de A est intact'
);

-- ---------------------------------------------------------------------------
-- Suppressions, plafonds
-- ---------------------------------------------------------------------------
-- Budget de texte par compte, projets supprimés compris.
insert into public.research_projects (id, owner_id, title, deleted_at) values
  ('25e00000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-0000000025e2', 'Projet supprimé de B', now());
insert into public.thesis_sections (project_id, position, title, body, created_at)
select '25e00000-0000-0000-0000-0000000000b3', g, 'Volumineuse ' || g, repeat('a', 30000), now() - interval '3 days'
from generate_series(1, 100) g;
select tests.login('b0000000-0000-0000-0000-0000000025e2');
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), jsonb_build_object('body', repeat('b', 10))) $$,
  null, 'limit_reached', 'Trois millions de caractères au plus par compte, projets supprimés compris'
);
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"title": "Titre seul"}') $$,
  'Au plafond, le titre se modifie encore'
);
reset role;

-- Supprimer une source retire ses citations, pas les sections.
select tests.login('a0000000-0000-0000-0000-0000000025e1');
select lives_ok($$ select public.delete_project_source('25e00000-0000-0000-0000-00000000c0a1') $$, 'A supprime une source citée');
select is_empty($$ select 1 from public.section_citations $$, 'Ses citations disparaissent');
select is((select count(*) from public.thesis_sections), 3::bigint, 'Les sections restent');

-- Supprimer une section : les rangs des autres restent distincts, l'ajout suivant va à la fin.
select lives_ok($$ select public.delete_thesis_section((select id from tests.ids where label = 'methodes')) $$, 'A supprime une section');
insert into tests.ids select 'conclusion', public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Conclusion"}');
select results_eq(
  $$ select title from public.thesis_sections order by position $$,
  $$ values ('Introduction générale'), ('État de l''art'), ('Conclusion') $$,
  'La nouvelle section vient en dernier'
);
reset role;

-- Cent sources citées au plus par section.
insert into public.project_sources (project_id, title)
select '25e00000-0000-0000-0000-0000000000a1', 'Source en nombre ' || g from generate_series(1, 101) g;
insert into public.section_citations (section_id, source_id)
select (select id from tests.ids where label = 'conclusion'), s.id
from public.project_sources s
where s.project_id = '25e00000-0000-0000-0000-0000000000a1' and s.title <> 'Source en nombre 101';
select tests.login('a0000000-0000-0000-0000-0000000025e1');
select throws_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'conclusion'),
       (select id from public.project_sources where title = 'Source en nombre 101'), true) $$,
  null, 'limit_reached', 'Cent sources citées au plus par section'
);
select lives_ok(
  $$ select public.set_section_citation((select id from tests.ids where label = 'conclusion'),
       (select id from public.project_sources where title = 'Source en nombre 1'), true, 'p. 9') $$,
  'Au plafond, les pages d''une source déjà citée se mettent encore à jour'
);
reset role;

-- Soixante sections par projet.
insert into public.thesis_sections (project_id, position, title, created_at)
select '25e00000-0000-0000-0000-0000000000a1', 100 + g, 'Section ' || g, now() - interval '2 days'
from generate_series(1, 57) g;
select tests.login('a0000000-0000-0000-0000-0000000025e1');
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Une de trop"}') $$,
  null, 'limit_reached', 'Soixante sections au plus par projet'
);
reset role;

-- Deux cents créations par jour, projets supprimés compris.
insert into public.research_projects (id, owner_id, title, deleted_at) values
  ('25e00000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000025e1', 'Projet supprimé de A', now());
insert into public.thesis_sections (project_id, position, title)
select '25e00000-0000-0000-0000-0000000000a3', g, 'Éphémère ' || g from generate_series(1, 197) g;
select tests.login('a0000000-0000-0000-0000-0000000025e1');
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a2', '{"title": "Une de plus aujourd''hui"}') $$,
  null, 'rate_limited', 'Deux cents sections créées par jour au plus, projets supprimés compris'
);

-- Projet supprimé : plan et citations cessent d'être lisibles et modifiables.
select lives_ok($$ select public.delete_project('25e00000-0000-0000-0000-0000000000a1') $$, 'A supprime son projet');
select is_empty($$ select 1 from public.thesis_sections $$, 'Son plan n''est plus lisible');
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'intro'), '{"body": "Revenant"}') $$,
  null, 'not_found', 'Ni modifiable'
);
select throws_ok(
  $$ select public.add_thesis_section('25e00000-0000-0000-0000-0000000000a1', '{"title": "Revenante"}') $$,
  null, 'not_found', 'Ni extensible'
);
reset role;

-- Enregistrement automatique : la fonction rend la nouvelle date de modification.
create function tests.save_key(p_user uuid) returns text language sql as $$
  select 'section-save:user:' || left(encode(sha256(convert_to('section-save:' || p_user::text, 'UTF8')), 'hex'), 40)
$$;
-- Porte le compteur du compte à la valeur donnée, dans la fenêtre courante et la suivante.
create function tests.set_saves(p_user uuid, p_hits integer) returns void language sql as $$
  insert into private.rate_limit_buckets (bucket_key, window_start, hits)
  select tests.save_key(p_user), to_timestamp((floor(extract(epoch from clock_timestamp()) / 600) + g) * 600), p_hits
  from generate_series(0, 1) g
  on conflict (bucket_key, window_start) do update set hits = excluded.hits
$$;
create function tests.saves(p_user uuid) returns integer language sql as $$
  select coalesce(max(hits), 0) from private.rate_limit_buckets where bucket_key = tests.save_key(p_user)
$$;

select tests.set_saves('b0000000-0000-0000-0000-0000000025e2', 10);
select tests.login('b0000000-0000-0000-0000-0000000025e2');
create temporary table returned_version as
select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"title": "Titre daté"}') as updated_at;
reset role;
select is(
  (select updated_at from returned_version),
  (select s.updated_at from public.thesis_sections s where s.id = (select id from tests.ids where label = 'b1')),
  'La modification rend la date de version de la section'
);
select is(tests.saves('b0000000-0000-0000-0000-0000000025e2'), 11, 'Un enregistrement abouti est compté');
select is(
  (select count(*) from private.rate_limit_buckets where bucket_key like '%0000-0000%'),
  0::bigint, 'Aucune clé de compteur ne porte un identifiant de compte'
);

-- Débit : deux cents enregistrements par dix minutes et par compte.
select tests.set_saves('b0000000-0000-0000-0000-0000000025e2', 199);
select tests.login('b0000000-0000-0000-0000-0000000025e2');
select lives_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"title": "Deux centième"}') $$,
  'Le deux centième enregistrement passe'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"title": "De trop"}') $$,
  'P0001', 'rate_limited', 'Le suivant est refusé'
);
-- La forme de la requête est jugée avant le décompte.
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"level": "9"}') $$,
  '22023', 'invalid_payload', 'À la limite, une requête invalide reste dite invalide'
);
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"expected_updated_at": "x"}') $$,
  '22023', 'invalid_payload', 'Une date de version mal formée aussi'
);
reset role;
select is(
  (select title from public.thesis_sections where id = (select id from tests.ids where label = 'b1')),
  'Deux centième', 'Un refus n''écrit rien'
);

-- La section d'un autre : la propriété est jugée avant le décompte, même pour
-- un compte qui a épuisé le sien.
select tests.set_saves('a0000000-0000-0000-0000-0000000025e1', 200);
select tests.login('a0000000-0000-0000-0000-0000000025e1');
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"title": "Piraté"}') $$,
  'P0001', 'not_found', 'Un compte à sa limite reçoit la même réponse pour la section d''autrui'
);
reset role;

-- Le compteur n'est exécutable par aucun rôle de l'API.
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, 'private.consume_user_quota(text, integer, integer)', 'execute')),
  0::bigint, 'Aucun rôle de l''API n''appelle le compteur directement'
);
select tests.set_saves('b0000000-0000-0000-0000-0000000025e2', 1);

-- Compte suspendu : ni lecture, ni écriture.
insert into private.account_status (user_id, status, changed_by)
values ('b0000000-0000-0000-0000-0000000025e2', 'suspended', 'd0000000-0000-0000-0000-0000000025e4');
select tests.login('b0000000-0000-0000-0000-0000000025e2');
select is_empty($$ select 1 from public.thesis_sections $$, 'Un compte suspendu ne lit plus son plan');
select throws_ok(
  $$ select public.update_thesis_section((select id from tests.ids where label = 'b1'), '{"body": "Suspendu"}') $$,
  '42501', 'forbidden', 'Ni ne l''écrit'
);
reset role;

-- Suppression du compte : tout part en cascade.
delete from auth.users where id = 'a0000000-0000-0000-0000-0000000025e1';
select is(
  (select count(*) from public.thesis_sections where project_id::text like '25e00000-0000-0000-0000-0000000000a_'),
  0::bigint, 'La suppression du compte efface ses sections'
);

select * from finish();
rollback;
