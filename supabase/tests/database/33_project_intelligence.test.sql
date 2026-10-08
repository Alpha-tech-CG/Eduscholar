-- Phase 6 : contrôles de cohérence d'un projet et recommandations personnalisées.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create table tests.reports (label text primary key, report jsonb);
create table tests.reco (label text, place integer, id uuid, score integer, reasons text[]);
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant all on tests.reports, tests.reco to authenticated;

-- A : propriétaire. B : autre étudiant. S : encadreur à accès complet.
-- L : membre à accès limité. F : compte à second facteur. N : profil non complété.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000007901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-a@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000007902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-b@test.invalid', now()),
  ('50000000-0000-0000-0000-000000007903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-s@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000007904', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-l@test.invalid', now()),
  ('f0000000-0000-0000-0000-000000007905', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-f@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000007906', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-n@test.invalid', now()),
  ('c1000000-0000-0000-0000-000000007907', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-mo@test.invalid', now()),
  ('b1000000-0000-0000-0000-000000007908', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-pa@test.invalid', now());

-- Une filière propre au test : le vivier des recommandations ne contient ainsi
-- que les fiches du test, quoi que la base locale contienne d'autre.
insert into public.academic_programs (code, domain_code, labels) values
  ('zz_ia_prog', 'sciences_technology', '{"fr": "Filière du test IA", "en": "AI test program"}');
insert into public.subjects (program_code, code, labels) values
  ('zz_ia_prog', 'zz_s1', '{"fr": "Matière une", "en": "Subject one"}'),
  ('zz_ia_prog', 'zz_s2', '{"fr": "Matière deux", "en": "Subject two"}'),
  ('zz_ia_prog', 'zz_s3', '{"fr": "Matière trois", "en": "Subject three"}');

update public.profiles
  set country_code = 'SN', level_code = 'master_1', program_code = 'zz_ia_prog', age_confirmed_at = now(),
      subject_codes = array['zz_s1', 'zz_s2']
  where user_id::text like '%-00000000790_' and user_id <> 'd0000000-0000-0000-0000-000000007906';
update public.profiles set level_code = 'bachelor_1', subject_codes = array['zz_s3']
  where user_id = 'b0000000-0000-0000-0000-000000007902';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('fa000000-0000-0000-0000-000000007905', 'f0000000-0000-0000-0000-000000007905', 'test', 'totp', 'verified', now(), now(), 'x'),
       ('fa000000-0000-0000-0000-000000007907', 'c1000000-0000-0000-0000-000000007907', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'x'),
       ('fa000000-0000-0000-0000-000000007908', 'b1000000-0000-0000-0000-000000007908', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'x');
-- Mo : modératrice. Pa : administrateur de plateforme. Ni l'un ni l'autre n'est membre d'un projet.
insert into public.platform_roles (user_id, role) values
  ('c1000000-0000-0000-0000-000000007907', 'moderator'),
  ('b1000000-0000-0000-0000-000000007908', 'platform_admin');

insert into public.organizations (id, slug, name, status) values
  ('79000000-0000-0000-0000-0000000000f1', 'ia-test-org-2', 'Organisation du test IA', 'verified');

-- Fiches du catalogue.
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, level_codes, subject_codes,
   official_url, source_kind, source_name, access_status, editorial_status, visibility, organization_id,
   last_verified_at, published_at)
values
  ('79000000-0000-0000-0000-000000000001', 'article', 'Fiche G1 du test', array['Zed Auteur'], array['zztag1'], 'fr', 'zz_ia_prog',
   array['master_1'], array['zz_s1'], 'https://exemple.invalid/g1', 'connector', 'test', 'open_access', 'published', 'public', null, now(), now() - interval '1 day'),
  ('79000000-0000-0000-0000-000000000002', 'article', 'Fiche G2 du test', array['Zed Auteur'], '{}', 'fr', 'zz_ia_prog',
   '{}', array['zz_s1', 'zz_s2'], 'https://exemple.invalid/g2', 'connector', 'test', 'open_access', 'published', 'public', null, now(), now() - interval '2 days'),
  ('79000000-0000-0000-0000-000000000003', 'article', 'Fiche G3 du test', array['Cité Auteur'], array['zztag9'], 'fr', 'zz_ia_prog',
   '{}', '{}', 'https://exemple.invalid/g3', 'connector', 'test', 'open_access', 'published', 'public', null, now(), now() - interval '3 days'),
  ('79000000-0000-0000-0000-000000000004', 'article', 'Fiche G4 en attente', array['Zed Auteur'], '{}', 'fr', 'zz_ia_prog',
   array['master_1'], array['zz_s1', 'zz_s2'], 'https://exemple.invalid/g4', 'connector', 'test', 'open_access', 'pending', 'public', null, null, null),
  ('79000000-0000-0000-0000-000000000005', 'article', 'Fiche G5 réservée', array['Zed Auteur'], '{}', 'fr', 'zz_ia_prog',
   array['master_1'], array['zz_s1', 'zz_s2'], 'https://exemple.invalid/g5', 'organization', 'test', 'open_access', 'published', 'organization',
   '79000000-0000-0000-0000-0000000000f1', now(), now()),
  ('79000000-0000-0000-0000-000000000006', 'article', 'Fiche G6 retirée', array['Zed Auteur'], '{}', 'fr', 'zz_ia_prog',
   array['master_1'], array['zz_s1', 'zz_s2'], 'https://exemple.invalid/g6', 'connector', 'test', 'open_access', 'removed', 'public', null, null, null),
  ('79000000-0000-0000-0000-000000000007', 'article', 'Fiche G7 favorite', array['Zed Auteur'], '{}', 'fr', 'zz_ia_prog',
   array['master_1'], array['zz_s1', 'zz_s2'], 'https://exemple.invalid/g7', 'connector', 'test', 'open_access', 'published', 'public', null, now(), now() - interval '5 days'),
  ('79000000-0000-0000-0000-000000000008', 'article', 'Fiche G8 en collection', array['Zed Auteur'], '{}', 'fr', 'zz_ia_prog',
   array['master_1'], array['zz_s1', 'zz_s2'], 'https://exemple.invalid/g8', 'connector', 'test', 'open_access', 'published', 'public', null, now(), now() - interval '6 days'),
  ('79000000-0000-0000-0000-000000000009', 'article', 'Fiche G9 déjà source', array['Autre Plume'], array['zztag9'], 'fr', 'zz_ia_prog',
   '{}', array['zz_s3'], 'https://exemple.invalid/g9', 'connector', 'test', 'open_access', 'published', 'public', null, now(), now() - interval '4 days');

insert into public.resource_favorites (user_id, resource_id) values
  ('a0000000-0000-0000-0000-000000007901', '79000000-0000-0000-0000-000000000007');
insert into public.collections (id, owner_id, name) values
  ('79000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000007901', 'Collection de A');
insert into public.collection_items (collection_id, resource_id) values
  ('79000000-0000-0000-0000-0000000000c1', '79000000-0000-0000-0000-000000000008');

-- Projets de A : P1 construit pour déclencher chaque constat ; P2 propre ;
-- P3 à l'échéance proche ; P4 supprimé. Projet de B : PB.
insert into public.research_projects
  (id, owner_id, title, status, due_date, problem_statement, main_question, general_objective, methodology, deleted_at)
values
  ('79000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000007901', 'Projet à constats', 'in_progress',
   current_date - 3, null, null, 'Objectif zzsecretfiche', 'Méthode zzsecretfiche', null),
  ('79000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000007901', 'Projet propre', 'in_progress',
   current_date + 200, 'Problématique', 'Question', 'Objectif', 'Méthode', null),
  ('79000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000007901', 'Projet à échéance proche', 'draft',
   current_date + 10, 'Problématique', 'Question', 'Objectif', 'Méthode', null),
  ('79000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000007901', 'Projet supprimé', 'draft',
   null, null, null, null, null, now()),
  ('79000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000007902', 'Projet de B', 'draft',
   null, null, null, null, null, null);
insert into public.research_project_members (project_id, user_id, role, full_access) values
  ('79000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-000000007903', 'supervisor', true),
  ('79000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000007904', 'supervisor', false);

-- P1 : sections.
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('79000000-0000-0000-0000-0000000000d1', '79000000-0000-0000-0000-0000000000a1', 1, 'Section vide', null),
  ('79000000-0000-0000-0000-0000000000d2', '79000000-0000-0000-0000-0000000000a1', 2, 'Section sans citation', repeat('zzsecretbody ', 40)),
  ('79000000-0000-0000-0000-0000000000d3', '79000000-0000-0000-0000-0000000000a1', 3, 'Section à une source', repeat('zzsecretbody ', 40)),
  ('79000000-0000-0000-0000-0000000000d4', '79000000-0000-0000-0000-0000000000a1', 4, 'Section longue', repeat('zzsecretbody ', 160)),
  ('79000000-0000-0000-0000-0000000000d5', '79000000-0000-0000-0000-0000000000a1', 5, 'Section très courte', 'zzsecretbody court');
-- P1 : sources. X1 complète, avec pages ; X2 complète ; X3 sans auteur ;
-- X4 même titre que X1, sans année ; X5 même DOI que X1 ; X6 fiche G9 reprise.
insert into public.project_sources (id, project_id, resource_id, title, authors, publication_year, pages, doi) values
  ('79000000-0000-0000-0000-0000000000e1', '79000000-0000-0000-0000-0000000000a1', null, 'Zzsourcetitre des réseaux', array['Awa Diop'], 2001, '10-20', '10.1234/zz.source.1'),
  ('79000000-0000-0000-0000-0000000000e2', '79000000-0000-0000-0000-0000000000a1', null, 'Zzsourcetitre second', array['CITÉ Auteur'], 2000, null, null),
  ('79000000-0000-0000-0000-0000000000e3', '79000000-0000-0000-0000-0000000000a1', null, 'Zzsourcetitre troisième', '{}', 1999, null, null),
  ('79000000-0000-0000-0000-0000000000e4', '79000000-0000-0000-0000-0000000000a1', null, 'ZZSOURCETITRE des Reseaux', array['Awa Diop'], null, null, null),
  ('79000000-0000-0000-0000-0000000000e5', '79000000-0000-0000-0000-0000000000a1', null, 'Zzsourcetitre cinquième', array['Awa Diop'], 1998, null, '10.1234/ZZ.Source.1'),
  ('79000000-0000-0000-0000-0000000000e6', '79000000-0000-0000-0000-0000000000a1', '79000000-0000-0000-0000-000000000009', 'Fiche G9 déjà source', array['Autre Plume'], 1997, null, null);
insert into public.section_citations (section_id, source_id, pages) values
  ('79000000-0000-0000-0000-0000000000d3', '79000000-0000-0000-0000-0000000000e1', null),
  ('79000000-0000-0000-0000-0000000000d4', '79000000-0000-0000-0000-0000000000e2', 'p. 4'),
  ('79000000-0000-0000-0000-0000000000d4', '79000000-0000-0000-0000-0000000000e3', null),
  ('79000000-0000-0000-0000-0000000000d4', '79000000-0000-0000-0000-0000000000e6', null);
insert into public.literature_notes (source_id, problem) values
  ('79000000-0000-0000-0000-0000000000e2', 'Note zzsecretnote'),
  ('79000000-0000-0000-0000-0000000000e3', null),
  ('79000000-0000-0000-0000-0000000000e6', 'Note zzsecretnote');
insert into public.project_tasks (id, project_id, title, due_date, created_by, done_at) values
  ('79000000-0000-0000-0000-000000000071', '79000000-0000-0000-0000-0000000000a1', 'Tâche en retard', current_date - 1, 'a0000000-0000-0000-0000-000000007901', null),
  ('79000000-0000-0000-0000-000000000072', '79000000-0000-0000-0000-0000000000a1', 'Tâche faite', current_date - 1, 'a0000000-0000-0000-0000-000000007901', now()),
  ('79000000-0000-0000-0000-000000000073', '79000000-0000-0000-0000-0000000000a1', 'Tâche à venir', current_date + 1, 'a0000000-0000-0000-0000-000000007901', null);

-- P2 : propre.
insert into public.thesis_sections (id, project_id, position, title, body) values
  ('79000000-0000-0000-0000-0000000000d6', '79000000-0000-0000-0000-0000000000a2', 1, 'Introduction', repeat('Texte propre. ', 30)),
  ('79000000-0000-0000-0000-0000000000d7', '79000000-0000-0000-0000-0000000000a2', 2, 'Développement', repeat('Texte propre. ', 30));
insert into public.project_sources (id, project_id, title, authors, publication_year, pages) values
  ('79000000-0000-0000-0000-0000000000e7', '79000000-0000-0000-0000-0000000000a2', 'Source récente une', array['Awa Diop'], extract(year from current_date)::smallint - 1, '1-9'),
  ('79000000-0000-0000-0000-0000000000e8', '79000000-0000-0000-0000-0000000000a2', 'Source récente deux', array['Kofi Mensah'], extract(year from current_date)::smallint - 2, null);
insert into public.section_citations (section_id, source_id, pages) values
  ('79000000-0000-0000-0000-0000000000d6', '79000000-0000-0000-0000-0000000000e7', 'p. 2'),
  ('79000000-0000-0000-0000-0000000000d6', '79000000-0000-0000-0000-0000000000e8', null),
  ('79000000-0000-0000-0000-0000000000d7', '79000000-0000-0000-0000-0000000000e7', 'p. 3'),
  ('79000000-0000-0000-0000-0000000000d7', '79000000-0000-0000-0000-0000000000e8', null);
insert into public.literature_notes (source_id, results) values
  ('79000000-0000-0000-0000-0000000000e7', 'Résultats notés'),
  ('79000000-0000-0000-0000-0000000000e8', 'Résultats notés');

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('project_coherence_report', 'recommended_resources')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni un visiteur ni le rôle serveur n''exécutent ces fonctions'
);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, '42501', null, 'Le rôle serveur ne lit pas le rapport d''un projet');
select throws_ok($$ select * from public.recommended_resources() $$, '42501', null, 'Ni ne demande de recommandations');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, '42501', null, 'Un visiteur non plus');
reset role;

-- ---------------------------------------------------------------------------
-- Rapport de cohérence : qui le lit
-- ---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000007902');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, 'P0001', 'not_found', 'Un tiers ne lit pas le rapport du projet d''un autre');
reset role;
select tests.login('c0000000-0000-0000-0000-000000007904');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, 'P0001', 'not_found', 'Un membre à accès limité non plus : même réponse');
reset role;
select tests.login('c1000000-0000-0000-0000-000000007907', 'aal2');
select ok(private.has_platform_role(array['moderator']), 'La modératrice du test a bien son rôle');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, 'P0001', 'not_found', 'Une modératrice ne lit pas le rapport d''un projet : même réponse qu''à un tiers');
reset role;
select tests.login('b1000000-0000-0000-0000-000000007908', 'aal2');
select ok(private.has_platform_role(array['platform_admin']), 'L''administrateur du test a bien son rôle');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, 'P0001', 'not_found', 'Un administrateur de plateforme non plus');
reset role;
select tests.login('f0000000-0000-0000-0000-000000007905', 'aal1');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a1') $$, '42501', 'forbidden', 'Compte à second facteur, session au seul mot de passe : refusé');
select throws_ok($$ select * from public.recommended_resources() $$, '42501', 'forbidden', 'De même pour les recommandations');
reset role;
select tests.login('50000000-0000-0000-0000-000000007903');
insert into tests.reports select 's', public.project_coherence_report('79000000-0000-0000-0000-0000000000a1');
reset role;
select tests.login('a0000000-0000-0000-0000-000000007901');
insert into tests.reports select 'p1', public.project_coherence_report('79000000-0000-0000-0000-0000000000a1');
insert into tests.reports select 'p2', public.project_coherence_report('79000000-0000-0000-0000-0000000000a2');
insert into tests.reports select 'p3', public.project_coherence_report('79000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a4') $$, 'P0001', 'not_found', 'Projet supprimé');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-00000000dead') $$, 'P0001', 'not_found', 'Projet inconnu');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000b1') $$, 'P0001', 'not_found', 'Projet d''un autre');
reset role;

select is((select report ->> 'role' from tests.reports where label = 'p1'), 'owner', 'Le propriétaire lit le rapport de son projet');
select is((select report ->> 'role' from tests.reports where label = 's'), 'supervisor', 'Un membre à accès complet aussi');
-- Contenu exact du rapport d'un membre à accès complet : tout ce qu'il lit déjà
-- par le document partagé et les tâches ; rien des fiches de lecture.
select results_eq(
  $$ select f.value ->> 'code' from tests.reports r, jsonb_array_elements(r.report -> 'findings') f
     where r.label = 's' order by 1 $$,
  $$ values ('citation_without_pages'), ('literature_mostly_old'), ('literature_none_recent'),
            ('project_incomplete'), ('project_overdue'), ('section_empty'), ('section_short'),
            ('section_single_source'), ('section_without_citation'), ('source_duplicate'),
            ('source_incomplete'), ('source_never_cited'), ('task_overdue') $$,
  'Un membre à accès complet reçoit treize constats : pas celui qui vient des fiches de lecture'
);
select is(
  (select report -> 'findings' from tests.reports where label = 's'),
  (select jsonb_agg(f.value order by f.ordinality)
   from tests.reports r, jsonb_array_elements(r.report -> 'findings') with ordinality f
   where r.label = 'p1' and f.value ->> 'code' <> 'cited_source_without_note'),
  'Ces constats sont, à l''identique, ceux du propriétaire'
);
select is(
  (select report - 'findings' - 'role' from tests.reports where label = 's'),
  (select report - 'findings' - 'role' from tests.reports where label = 'p1'),
  'Le reste du rapport est le même'
);
select ok(
  (select report::text !~ 'cited_source_without_note|note' from tests.reports where label = 's'),
  'Rien n''y parle des fiches de lecture'
);

-- ---------------------------------------------------------------------------
-- Rapport de cohérence : chaque constat
-- ---------------------------------------------------------------------------
create view tests.p1 as
select f.value as finding from tests.reports r, jsonb_array_elements(r.report -> 'findings') f where r.label = 'p1';

select results_eq(
  $$ select finding ->> 'code', finding ->> 'severity', (finding ->> 'count')::integer from tests.p1 order by 1 $$,
  $$ values ('citation_without_pages', 'info', 1),
            ('cited_source_without_note', 'info', 2),
            ('literature_mostly_old', 'info', 5),
            ('literature_none_recent', 'warning', 5),
            ('project_incomplete', 'warning', 2),
            ('project_overdue', 'warning', 1),
            ('section_empty', 'info', 1),
            ('section_short', 'info', 1),
            ('section_single_source', 'info', 1),
            ('section_without_citation', 'warning', 1),
            ('source_duplicate', 'warning', 2),
            ('source_incomplete', 'warning', 2),
            ('source_never_cited', 'info', 2),
            ('task_overdue', 'warning', 1) $$,
  'Le projet construit pour cela déclenche chaque constat, avec sa gravité et son nombre'
);
select is((select finding -> 'fields' from tests.p1 where finding ->> 'code' = 'project_incomplete'),
  '["problem_statement", "main_question"]'::jsonb, 'Fiche de projet : les champs vides sont nommés');
select is((select (finding ->> 'days_late')::integer from tests.p1 where finding ->> 'code' = 'project_overdue'), 3, 'Échéance dépassée : le retard en jours');
select is((select finding -> 'task_ids' from tests.p1 where finding ->> 'code' = 'task_overdue'),
  '["79000000-0000-0000-0000-000000000071"]'::jsonb, 'Tâche en retard : ni la tâche faite, ni la tâche à venir');
select is((select finding -> 'sections' from tests.p1 where finding ->> 'code' = 'section_empty'),
  '[{"id": "79000000-0000-0000-0000-0000000000d1", "title": "Section vide"}]'::jsonb, 'Section sans texte : identifiant et titre');
select is((select finding -> 'sections' -> 0 ->> 'id' from tests.p1 where finding ->> 'code' = 'section_without_citation'),
  '79000000-0000-0000-0000-0000000000d2', 'Section rédigée sans citation');
select is((select finding -> 'sections' -> 0 ->> 'id' from tests.p1 where finding ->> 'code' = 'section_single_source'),
  '79000000-0000-0000-0000-0000000000d3', 'Section qui ne s''appuie que sur une source');
select is((select finding -> 'sections' -> 0 ->> 'id' from tests.p1 where finding ->> 'code' = 'section_short'),
  '79000000-0000-0000-0000-0000000000d5', 'Section très courte par rapport aux autres');
select is((select finding -> 'source_ids' from tests.p1 where finding ->> 'code' = 'source_never_cited'),
  '["79000000-0000-0000-0000-0000000000e4", "79000000-0000-0000-0000-0000000000e5"]'::jsonb, 'Sources jamais citées');
select is((select finding -> 'citations' from tests.p1 where finding ->> 'code' = 'citation_without_pages'),
  '[{"section_id": "79000000-0000-0000-0000-0000000000d3", "source_id": "79000000-0000-0000-0000-0000000000e1"}]'::jsonb,
  'Citation sans page d''une source qui a des pages ; pas celles dont la source n''en a pas');
select is((select finding -> 'sources' from tests.p1 where finding ->> 'code' = 'source_incomplete'),
  '[{"id": "79000000-0000-0000-0000-0000000000e3", "missing": ["authors"]}, {"id": "79000000-0000-0000-0000-0000000000e4", "missing": ["publication_year"]}]'::jsonb,
  'Sources incomplètes : ce qui manque est nommé');
select is((select finding -> 'groups' from tests.p1 where finding ->> 'code' = 'source_duplicate'),
  '[["79000000-0000-0000-0000-0000000000e1", "79000000-0000-0000-0000-0000000000e4"], ["79000000-0000-0000-0000-0000000000e1", "79000000-0000-0000-0000-0000000000e5"]]'::jsonb,
  'Sources en double : même titre normalisé, même DOI sans égard à la casse');
select is((select (finding ->> 'newest_year')::integer from tests.p1 where finding ->> 'code' = 'literature_none_recent'), 2001, 'Aucune source récente : l''année de la plus récente');
select is((select (finding ->> 'sources_with_year')::integer from tests.p1 where finding ->> 'code' = 'literature_mostly_old'), 5, 'Sources anciennes : sur combien');
select is((select finding -> 'source_ids' from tests.p1 where finding ->> 'code' = 'cited_source_without_note'),
  '["79000000-0000-0000-0000-0000000000e1", "79000000-0000-0000-0000-0000000000e3"]'::jsonb,
  'Sources citées sans fiche de lecture, ou à la fiche vide');
select is((select report -> 'totals' from tests.reports where label = 'p1'),
  '{"sections": 5, "sources": 6, "citations": 4, "tasks": 3}'::jsonb, 'Le rapport rend aussi les nombres du projet');

-- Aucun texte ne sort.
select ok(
  (select bool_and(report::text !~* 'zzsecretbody|zzsecretnote|zzsecretfiche|zzsourcetitre|Tâche en retard') from tests.reports),
  'Aucun texte de section, de fiche de lecture, de fiche de projet, ni titre de source ou de tâche ne sort du rapport'
);
select ok(
  (select bool_and(f.value ->> 'severity' in ('info', 'warning') and f.value ->> 'code' in (
     'project_incomplete', 'project_overdue', 'project_due_soon', 'task_overdue', 'section_empty',
     'section_without_citation', 'section_single_source', 'section_short', 'source_never_cited',
     'citation_without_pages', 'source_incomplete', 'source_duplicate', 'literature_none_recent',
     'literature_mostly_old', 'cited_source_without_note'))
   from tests.reports r, jsonb_array_elements(r.report -> 'findings') f),
  'Codes et gravités sont pris dans leurs listes fermées'
);

-- Un projet propre ne déclenche rien ; une échéance proche est signalée.
select is((select report -> 'findings' from tests.reports where label = 'p2'), '[]'::jsonb, 'Un projet propre ne déclenche aucun constat');
select results_eq(
  $$ select f.value ->> 'code', f.value ->> 'severity', (f.value ->> 'days_left')::integer
     from tests.reports r, jsonb_array_elements(r.report -> 'findings') f where r.label = 'p3' $$,
  $$ values ('project_due_soon', 'info', 10) $$,
  'Échéance dans moins de trente jours : signalée, et rien d''autre sur un projet sans section ni source'
);
select is(
  (select count(*) from public.thesis_sections where project_id = '79000000-0000-0000-0000-0000000000a1' and body is null), 1::bigint,
  'Le rapport n''a rien modifié'
);

-- ---------------------------------------------------------------------------
-- Recommandations
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000007901');
insert into tests.reco select 'a', row_number() over (), * from public.recommended_resources();
insert into tests.reco select 'a-p1', row_number() over (), * from public.recommended_resources('{"project_id": "79000000-0000-0000-0000-0000000000a1"}');
insert into tests.reco select 'a-p2', row_number() over (), * from public.recommended_resources('{"project_id": "79000000-0000-0000-0000-0000000000a2"}');
select throws_ok($$ select * from public.recommended_resources('{"project_id": "79000000-0000-0000-0000-0000000000b1"}') $$, 'P0001', 'not_found', 'Le projet d''un autre ne se désigne pas');
select throws_ok($$ select * from public.recommended_resources('{"project_id": "79000000-0000-0000-0000-0000000000a4"}') $$, 'P0001', 'not_found', 'Ni un projet supprimé');
select throws_ok($$ select * from public.recommended_resources('{"project_id": "pas-un-identifiant"}') $$, '22023', 'invalid_payload', 'Identifiant mal formé : refusé');
select throws_ok($$ select * from public.recommended_resources('{"user_id": "b0000000-0000-0000-0000-000000007902"}') $$, '22023', 'invalid_payload', 'Aucun autre paramètre n''est admis : on ne demande pas les recommandations d''un autre');
select throws_ok($$ select * from public.recommended_resources('[]') $$, '22023', 'invalid_payload', 'Requête qui n''est pas un objet : refusée');
reset role;
select tests.login('b0000000-0000-0000-0000-000000007902');
insert into tests.reco select 'b', row_number() over (), * from public.recommended_resources();
reset role;
select tests.login('50000000-0000-0000-0000-000000007903');
select throws_ok(
  $$ select * from public.recommended_resources('{"project_id": "79000000-0000-0000-0000-0000000000a1"}') $$,
  'P0001', 'not_found', 'Un membre, même à accès complet, ne désigne pas le projet d''un autre'
);
reset role;
select tests.login('d0000000-0000-0000-0000-000000007906');
select throws_ok($$ select * from public.recommended_resources() $$, '42501', 'forbidden', 'Un compte au profil non complété ne reçoit pas de recommandations');
reset role;

select results_eq(
  $$ select id, score, reasons from tests.reco where label = 'a' order by place $$,
  $$ values ('79000000-0000-0000-0000-000000000002'::uuid, 7, array['same_program', 'same_subject']),
            ('79000000-0000-0000-0000-000000000001'::uuid, 6, array['same_program', 'same_subject', 'same_level']),
            ('79000000-0000-0000-0000-000000000003'::uuid, 1, array['same_program']),
            ('79000000-0000-0000-0000-000000000009'::uuid, 1, array['same_program']) $$,
  'D''après le profil : matières, niveau, filière — score et raisons exacts, les plus pertinentes d''abord'
);
select results_eq(
  $$ select id, score, reasons from tests.reco where label = 'a-p1' order by place $$,
  $$ values ('79000000-0000-0000-0000-000000000002'::uuid, 7, array['same_program', 'same_subject']),
            ('79000000-0000-0000-0000-000000000003'::uuid, 7, array['same_program', 'cited_authors', 'project_keywords']),
            ('79000000-0000-0000-0000-000000000001'::uuid, 6, array['same_program', 'same_subject', 'same_level']) $$,
  'Avec un projet : auteurs de ses sources et mots-clés de ses fiches reprises ; la fiche déjà source est écartée'
);
select results_eq(
  $$ select id, score from tests.reco where label = 'a-p2' order by place $$,
  $$ select id, score from tests.reco where label = 'a' order by place $$,
  'Un projet sans fiche reprise ni auteur commun n''ajoute rien'
);
select is_empty(
  $$ select 1 from tests.reco where id in (
       '79000000-0000-0000-0000-000000000004', '79000000-0000-0000-0000-000000000005', '79000000-0000-0000-0000-000000000006') $$,
  'Jamais une fiche en attente, réservée à une organisation ou retirée, pour personne'
);
select is_empty(
  $$ select 1 from tests.reco where label like 'a%' and id in (
       '79000000-0000-0000-0000-000000000007', '79000000-0000-0000-0000-000000000008') $$,
  'Ni ses favoris, ni les fiches de ses collections'
);
select is(
  (select count(*) from tests.reco c
   where not exists (
     select 1 from public.resources r
     where r.id = c.id and r.editorial_status = 'published' and r.visibility = 'public')),
  0::bigint, 'Toutes les fiches recommandées sont publiées et publiques'
);
select ok(
  (select bool_and(reasons <@ array['same_program', 'same_subject', 'same_level', 'cited_authors', 'project_keywords']
                   and cardinality(reasons) > 0 and score > 0) from tests.reco),
  'Chaque recommandation porte au moins une raison, prise dans la liste fermée'
);

-- Isolation : celles de B viennent de son profil, et celles de A ne dépendent pas de B.
select results_eq(
  $$ select id, score, reasons from tests.reco where label = 'b' order by place $$,
  $$ values ('79000000-0000-0000-0000-000000000009'::uuid, 4, array['same_program', 'same_subject']),
            ('79000000-0000-0000-0000-000000000001'::uuid, 1, array['same_program']),
            ('79000000-0000-0000-0000-000000000002'::uuid, 1, array['same_program']),
            ('79000000-0000-0000-0000-000000000003'::uuid, 1, array['same_program']),
            ('79000000-0000-0000-0000-000000000007'::uuid, 1, array['same_program']),
            ('79000000-0000-0000-0000-000000000008'::uuid, 1, array['same_program']) $$,
  'B reçoit les siennes : les favoris et la collection de A ne lui retirent rien'
);
insert into public.resource_favorites (user_id, resource_id) values
  ('b0000000-0000-0000-0000-000000007902', '79000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000007902', '79000000-0000-0000-0000-000000000003');
insert into public.collections (id, owner_id, name) values
  ('79000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-000000007902', 'Collection de B');
insert into public.collection_items (collection_id, resource_id) values
  ('79000000-0000-0000-0000-0000000000c2', '79000000-0000-0000-0000-000000000001');
insert into public.project_sources (project_id, resource_id, title, authors) values
  ('79000000-0000-0000-0000-0000000000b1', '79000000-0000-0000-0000-000000000001', 'Fiche G1 du test', array['Zed Auteur']);
update public.profiles set subject_codes = array['zz_s1', 'zz_s2', 'zz_s3'] where user_id = 'b0000000-0000-0000-0000-000000007902';
select tests.login('a0000000-0000-0000-0000-000000007901');
insert into tests.reco select 'a-bis', row_number() over (), * from public.recommended_resources();
insert into tests.reco select 'a-p1-bis', row_number() over (), * from public.recommended_resources('{"project_id": "79000000-0000-0000-0000-0000000000a1"}');
reset role;
select results_eq(
  $$ select id, score, reasons from tests.reco where label = 'a-bis' order by place $$,
  $$ select id, score, reasons from tests.reco where label = 'a' order by place $$,
  'Les favoris, collections, sources et matières de B ne changent rien aux recommandations de A'
);
select results_eq(
  $$ select id, score, reasons from tests.reco where label = 'a-p1-bis' order by place $$,
  $$ select id, score, reasons from tests.reco where label = 'a-p1' order by place $$,
  'Ni à celles de son projet'
);

-- Une fiche qui n'est plus publiée n'est plus recommandée.
update public.resources set editorial_status = 'suspended' where id = '79000000-0000-0000-0000-000000000002';
select tests.login('a0000000-0000-0000-0000-000000007901');
insert into tests.reco select 'a-apres', row_number() over (), * from public.recommended_resources();
reset role;
select results_eq(
  $$ select id from tests.reco where label = 'a-apres' order by place $$,
  $$ values ('79000000-0000-0000-0000-000000000001'::uuid), ('79000000-0000-0000-0000-000000000003'::uuid),
            ('79000000-0000-0000-0000-000000000009'::uuid) $$,
  'Une fiche repassée en non publiée disparaît des recommandations'
);
-- Un profil complété a toujours une filière : le cas « sans filière » ne peut
-- pas se présenter à la fonction, qui refuse déjà un profil non complété.
select throws_ok(
  $$ update public.profiles set program_code = null, subject_codes = '{}' where user_id = 'a0000000-0000-0000-0000-000000007901' $$,
  '23514', null, 'Un profil complété ne perd pas sa filière'
);

-- ---------------------------------------------------------------------------
-- Quotas
-- ---------------------------------------------------------------------------
insert into private.rate_limit_buckets (bucket_key, window_start, hits)
select a || ':user:' || left(encode(sha256(convert_to(a || ':a0000000-0000-0000-0000-000000007901', 'UTF8')), 'hex'), 40),
       to_timestamp(floor(extract(epoch from clock_timestamp()) / 300) * 300), 60
from unnest(array['project-coherence', 'recommendations']) as a
on conflict (bucket_key, window_start) do update set hits = 60;
select tests.login('a0000000-0000-0000-0000-000000007901');
select throws_ok($$ select public.project_coherence_report('79000000-0000-0000-0000-0000000000a2') $$, 'P0001', 'rate_limited', 'Soixante rapports par cinq minutes et par compte');
select throws_ok($$ select * from public.recommended_resources() $$, 'P0001', 'rate_limited', 'Soixante demandes de recommandations par cinq minutes et par compte');
reset role;

select * from finish();
rollback;
