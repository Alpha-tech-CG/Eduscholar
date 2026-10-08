-- Phase 6 : doublons du catalogue et classification assistée (modération).

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
create table tests.found (label text, id uuid, title text, editorial_status text, reason text, score numeric, confidence text);
create table tests.suggested (kind text, code text, labels jsonb, matched_words text[], confidence text);
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant all on tests.found, tests.suggested to authenticated;

-- Mo : modératrice. U : utilisateur ordinaire, second facteur présenté.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('c0000000-0000-0000-0000-000000007801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-mo@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000007802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia-u@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000780_';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select ('fa000000-0000-0000-0000-00000000' || right(id::text, 4))::uuid, id, 'test', 'totp', 'verified',
       now() - interval '1 day', now(), 'secret-de-test'
from auth.users where id::text like '%-00000000780_';
insert into public.platform_roles (user_id, role) values ('c0000000-0000-0000-0000-000000007801', 'moderator');

-- Une filière propre au test, et ses matières.
insert into public.academic_programs (code, domain_code, labels) values
  ('zz_ia_prog', 'sciences_technology', '{"fr": "Filière du test IA", "en": "AI test program"}');
insert into public.subjects (program_code, code, labels, is_active) values
  ('zz_ia_prog', 'zz_crypto', '{"fr": "Cryptographie appliquée", "en": "Applied cryptography"}', true),
  ('zz_ia_prog', 'zz_reseaux', '{"fr": "Réseaux de neurones", "en": "Neural networks"}', true),
  ('zz_ia_prog', 'zz_bases', '{"fr": "Bases de données", "en": "Databases"}', true),
  ('zz_ia_prog', 'zz_algo', '{"fr": "Algorithmique", "en": "Algorithms"}', true),
  ('zz_ia_prog', 'zz_deja', '{"fr": "Chiffrement", "en": "Encryption"}', true),
  ('zz_ia_prog', 'zz_inactive', '{"fr": "Compilation avancée", "en": "Advanced compilers"}', false),
  ('zz_ia_prog', 'zz_sys1', '{"fr": "Systèmes embarqués", "en": "Embedded platforms"}', true),
  ('zz_ia_prog', 'zz_sys2', '{"fr": "Systèmes distribués", "en": "Distributed platforms"}', true),
  ('zz_ia_prog', 'zz_sys3', '{"fr": "Systèmes experts", "en": "Expert platforms"}', true),
  ('zz_ia_prog', 'zz_sys4', '{"fr": "Systèmes critiques", "en": "Critical platforms"}', true),
  ('zz_ia_prog', 'zz_hors', '{"fr": "Géologie marine", "en": "Marine geology"}', true);

insert into public.organizations (id, slug, name, status) values
  ('78000000-0000-0000-0000-0000000000f1', 'ia-test-org', 'Organisation du test IA', 'verified');

-- R1 : la fiche examinée. R2 même DOI ; R3 même lien ; R4 titre presque
-- identique, même année, même auteur ; R5 titre proche, même année ; R6 titre
-- proche sans rien d'autre en commun ; R7 même année et même auteur, titre sans
-- rapport ; R8 même lien, mais réservée à une organisation.
insert into public.resources
  (id, type_code, title, abstract, authors, tags, language_code, program_code, subject_codes, publication_year,
   doi, official_url, source_kind, source_name, access_status, editorial_status, visibility, organization_id,
   last_verified_at, published_at)
values
  ('78000000-0000-0000-0000-000000000001', 'article',
   'Zzdoublon cryptographie appliquée aux réseaux de neurones profonds',
   'Étude des bases de données chiffrées et des algorithmes. Compilation avancée des systèmes.',
   array['Awa Diop', 'Kofi Mensah'], array['chiffrement'], 'fr', 'zz_ia_prog', array['zz_deja'], 2020,
   '10.1234/ZZ.Doublon.1', 'https://www.Exemple.invalid/zz/doublon/', 'connector', 'test', 'open_access',
   'published', 'public', null, now(), now()),
  ('78000000-0000-0000-0000-000000000002', 'article', 'Tout autre intitulé zzautre deux', null,
   array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', '{}', 2011,
   '10.1234/zz.doublon.1', 'https://exemple.invalid/zz/autre-2', 'connector', 'test', 'open_access',
   'pending', 'public', null, null, null),
  ('78000000-0000-0000-0000-000000000003', 'article', 'Encore un intitulé zzautre trois', null,
   array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', '{}', 2012,
   null, 'http://exemple.invalid/zz/doublon#section', 'connector', 'test', 'open_access',
   'rejected', 'public', null, null, null),
  ('78000000-0000-0000-0000-000000000004', 'article',
   'Zzdoublon cryptographie appliquée aux réseaux de neurones profond', null,
   array['awa DIOP'], '{}', 'fr', 'zz_ia_prog', '{}', 2020,
   null, 'https://exemple.invalid/zz/autre-4', 'connector', 'test', 'open_access',
   'pending', 'public', null, null, null),
  ('78000000-0000-0000-0000-000000000005', 'article',
   'Zzdoublon cryptographie appliquée aux réseaux de neurones', null,
   array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', '{}', 2020,
   null, 'https://exemple.invalid/zz/autre-5', 'connector', 'test', 'open_access',
   'pending', 'public', null, null, null),
  ('78000000-0000-0000-0000-000000000006', 'article',
   'Zzdoublon cryptographie appliquée aux réseaux de neurones profonds', null,
   array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', '{}', 1999,
   null, 'https://exemple.invalid/zz/autre-6', 'connector', 'test', 'open_access',
   'pending', 'public', null, null, null),
  ('78000000-0000-0000-0000-000000000007', 'article', 'Géologie marine des fonds zzautre sept', null,
   array['Awa Diop'], '{}', 'fr', 'zz_ia_prog', '{}', 2020,
   null, 'https://exemple.invalid/zz/autre-7', 'connector', 'test', 'open_access',
   'pending', 'public', null, null, null),
  ('78000000-0000-0000-0000-000000000008', 'article', 'Fiche réservée zzautre huit', null,
   array['Awa Diop'], '{}', 'fr', 'zz_ia_prog', '{}', 2020,
   null, 'https://exemple.invalid/zz/doublon', 'organization', 'test', 'open_access',
   'pending', 'organization', '78000000-0000-0000-0000-0000000000f1', null, null);

-- R9 : même lien, au protocole et à la casse de l'hôte près. R10 : même lien
-- seulement une fois le chemin mis en minuscules. R11 : même DOI, mais réservée
-- à une organisation.
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, publication_year, doi, official_url,
   source_kind, source_name, access_status, editorial_status, visibility, organization_id)
values
  ('78000000-0000-0000-0000-000000000009', 'article', 'Intitulé zzautre neuf', array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', 2013,
   null, 'http://WWW.EXEMPLE.INVALID/zz/doublon/', 'connector', 'test', 'open_access', 'pending', 'public', null),
  ('78000000-0000-0000-0000-00000000000a', 'article', 'Intitulé zzautre dix', array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', 2014,
   null, 'https://www.exemple.invalid/ZZ/Doublon/', 'connector', 'test', 'open_access', 'pending', 'public', null),
  ('78000000-0000-0000-0000-00000000000b', 'article', 'Fiche réservée zzautre onze', array['Jane Roe'], '{}', 'fr', 'zz_ia_prog', 2015,
   '10.1234/zz.doublon.1', 'https://exemple.invalid/zz/autre-11', 'organization', 'test', 'open_access', 'pending', 'organization',
   '78000000-0000-0000-0000-0000000000f1');

-- Valeurs figées des deux fonctions d'index : si l'une change (montée de
-- version de PostgreSQL ou de l'extension unaccent), les index sont à refaire.
select is(private.fold_text('  L''Été — Données, RÉSEAUX & « IA » !'), 'l ete donnees reseaux ia', 'fold_text : accents, casse, ponctuation');
select is(private.fold_text('Œuvre straße naïve Ça'), 'oeuvre strasse naive ca', 'fold_text : ligatures et lettres composées');
select is(private.fold_text('Алгоритмы и СТРУКТУРЫ данных'), 'алгоритмы и структуры данных', 'fold_text : le cyrillique est gardé, en minuscules');
select is(private.fold_text('خوارزميات البيانات'), 'خوارزميات البيانات', 'fold_text : l''arabe est gardé');
select is(private.fold_text('機械学習 入門'), '機械学習 入門', 'fold_text : le japonais est gardé');
select is(private.fold_text(null), '', 'fold_text : rien donne rien');
select is(private.normalize_url('HTTPS://WWW.Exemple.INVALID/Chemin/Page/?Q=Un#ancre'), 'exemple.invalid/chemin/page/?q=un', 'normalize_url : protocole, www, casse, ancre');
select is(private.normalize_url('http://exemple.invalid'), 'exemple.invalid', 'normalize_url : hôte seul');
select is(private.normalize_url(null), null, 'normalize_url : rien donne rien');
select is(private.url_exact_form('HTTP://WWW.Exemple.INVALID/Chemin/#a'), 'www.exemple.invalid/Chemin/#a', 'url_exact_form : seuls le protocole et la casse de l''hôte sont ignorés');

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('similar_resources', 'suggest_resource_classification', 'is_stop_word')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni un visiteur ni le rôle serveur n''exécutent ces fonctions'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname in ('fold_text', 'normalize_url')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or p.prosecdef)),
  0::bigint, 'Les deux fonctions d''index, pures et sans droit particulier, restent fermées aux visiteurs et aux comptes'
);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-000000000001') $$, '42501', null, 'Le rôle serveur ne cherche pas de doublons');
select throws_ok($$ select * from private.suggest_resource_classification('78000000-0000-0000-0000-000000000001') $$, '42501', null, 'Ni ne demande de classification');
-- Les index sur le titre et le lien sont calculés sous le rôle qui écrit : le
-- rôle serveur, qui importe des fiches, doit toujours pouvoir en écrire une.
select lives_ok(
  $$ insert into public.resources (type_code, title, authors, language_code, program_code, official_url,
                                    source_kind, source_name, source_identifier, retrieved_at)
     values ('article', 'Fiche importée du test 78', array['Auteur Test'], 'fr', 'zz_ia_prog',
             'https://exemple.invalid/zz/importee', 'connector', 'test-78', 'W78', now()) $$,
  'Le rôle serveur écrit toujours une fiche : les index de titre et de lien ne l''en empêchent pas'
);
select lives_ok(
  $$ update public.resources set title = 'Fiche importée du test 78, retouchée' where source_name = 'test-78' $$,
  'Et la modifie'
);
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-000000000001') $$, '42501', null, 'Un visiteur non plus');
reset role;

select tests.login('d0000000-0000-0000-0000-000000007802', 'aal2');
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'Un utilisateur ordinaire ne cherche pas de doublons');
select throws_ok($$ select * from public.suggest_resource_classification('78000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'Ni ne demande de classification');
reset role;
-- Modératrice dans une session au seul mot de passe.
select tests.login('c0000000-0000-0000-0000-000000007801', 'aal1');
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'Sans second facteur présenté, une modératrice ne cherche pas de doublons');
select throws_ok($$ select * from public.suggest_resource_classification('78000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'Ni ne demande de classification');
reset role;

-- ---------------------------------------------------------------------------
-- Doublons
-- ---------------------------------------------------------------------------
select tests.login('c0000000-0000-0000-0000-000000007801', 'aal2');
insert into tests.found select 'r1', * from public.similar_resources('78000000-0000-0000-0000-000000000001');
insert into tests.found select 'r7', * from public.similar_resources('78000000-0000-0000-0000-000000000007');
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-00000000dead') $$, 'P0001', 'not_found', 'Fiche inconnue');
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-000000000008') $$, 'P0001', 'not_found', 'Fiche réservée à une organisation : même réponse');
reset role;

select results_eq(
  $$ select id, editorial_status, reason, score, confidence from tests.found
     where label = 'r1' and id::text like '78000000-%' and reason <> 'similar_title' order by id $$,
  $$ values ('78000000-0000-0000-0000-000000000002'::uuid, 'pending', 'same_doi', 1.00, 'high'),
            ('78000000-0000-0000-0000-000000000003'::uuid, 'rejected', 'same_url', 1.00, 'medium'),
            ('78000000-0000-0000-0000-000000000009'::uuid, 'pending', 'same_url', 1.00, 'high'),
            ('78000000-0000-0000-0000-00000000000a'::uuid, 'pending', 'same_url', 1.00, 'medium') $$,
  'Même DOI : confiance haute. Même lien au protocole et à la casse de l''hôte près : haute ; égal seulement une fois normalisé (www, ancre, casse du chemin) : moyenne'
);
select results_eq(
  $$ select id, reason, confidence from tests.found
     where label = 'r1' and id = '78000000-0000-0000-0000-000000000004' $$,
  $$ values ('78000000-0000-0000-0000-000000000004'::uuid, 'similar_title', 'high') $$,
  'Titre presque identique, même année, même auteur : confiance haute'
);
select ok(
  (select score >= 0.9 and score < 1 from tests.found where label = 'r1' and id = '78000000-0000-0000-0000-000000000004'),
  'Le score d''un titre proche est sa similarité'
);
select results_eq(
  $$ select reason, confidence in ('medium', 'low'), score >= 0.6 from tests.found
     where label = 'r1' and id = '78000000-0000-0000-0000-000000000005' $$,
  $$ values ('similar_title', true, true) $$,
  'Titre proche et même année seulement : signalé, sans confiance haute'
);
select is(
  (select confidence from tests.found where label = 'r1' and id = '78000000-0000-0000-0000-000000000005'),
  case when extensions.similarity(
    private.fold_text('Zzdoublon cryptographie appliquée aux réseaux de neurones'),
    private.fold_text('Zzdoublon cryptographie appliquée aux réseaux de neurones profonds')) >= 0.8
  then 'medium' else 'low' end,
  'Sa confiance suit la règle : moyenne à partir de 0,8 de similarité'
);
select is_empty(
  $$ select 1 from tests.found where label = 'r1' and id in (
       '78000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-000000000006',
       '78000000-0000-0000-0000-000000000007', '78000000-0000-0000-0000-000000000008',
       '78000000-0000-0000-0000-00000000000b') $$,
  'Ni la fiche elle-même, ni un titre identique sans année ni auteur communs, ni un titre sans rapport, ni une fiche réservée de même lien ou de même DOI'
);
select is(
  (select count(*) from tests.found where label = 'r1'),
  (select count(*) from tests.found where label = 'r1' and id::text like '78000000-%'),
  'Aucune fiche étrangère au test n''est prise pour un doublon'
);
select is_empty(
  $$ select 1 from tests.found where label = 'r7' $$,
  'Une fiche sans jumelle ne se voit proposer aucun doublon : même auteur et même année ne suffisent pas'
);
select ok(
  (select bool_and(confidence in ('high', 'medium', 'low') and reason in ('same_doi', 'same_url', 'similar_title')) from tests.found),
  'Raisons et confiances sont prises dans leurs listes fermées'
);

-- ---------------------------------------------------------------------------
-- Classification assistée
-- ---------------------------------------------------------------------------
select tests.login('c0000000-0000-0000-0000-000000007801', 'aal2');
insert into tests.suggested select * from public.suggest_resource_classification('78000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.suggest_resource_classification('78000000-0000-0000-0000-00000000dead') $$, 'P0001', 'not_found', 'Fiche inconnue');
select throws_ok($$ select * from public.suggest_resource_classification('78000000-0000-0000-0000-000000000008') $$, 'P0001', 'not_found', 'Fiche réservée : même réponse');
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-00000000000b') $$, 'P0001', 'not_found', 'Une fiche réservée ne s''examine pas davantage par son DOI');
select results_eq(
  $$ select confidence from public.suggest_resource_classification('78000000-0000-0000-0000-000000000001') limit 2 $$,
  $$ values ('high'), ('high') $$,
  'Les suggestions les plus sûres viennent d''abord'
);
select is_empty(
  $$ select * from public.suggest_resource_classification('78000000-0000-0000-0000-000000000002') $$,
  'Une fiche dont aucun mot ne correspond ne reçoit aucune suggestion'
);
select results_eq(
  $$ select code, confidence from public.suggest_resource_classification('78000000-0000-0000-0000-000000000007') $$,
  $$ values ('zz_hors', 'high') $$,
  'Une autre fiche reçoit la matière de son propre titre'
);
reset role;

select results_eq(
  $$ select kind, code, matched_words, confidence from tests.suggested order by code $$,
  $$ values ('subject', 'zz_algo', array['algorithmes'], 'low'),
            ('subject', 'zz_bases', array['bases', 'donnees'], 'medium'),
            ('subject', 'zz_crypto', array['appliquee', 'cryptographie'], 'high'),
            ('subject', 'zz_reseaux', array['neurones', 'reseaux'], 'high') $$,
  'Les matières proposées, leurs mots et leur confiance : libellé entier dans le titre, libellé entier dans le résumé, correspondance faible'
);
select is(
  (select labels from tests.suggested where code = 'zz_crypto'),
  '{"fr": "Cryptographie appliquée", "en": "Applied cryptography"}'::jsonb,
  'Chaque suggestion rend le libellé du référentiel, tel quel'
);
select is_empty(
  $$ select 1 from tests.suggested where code = 'zz_inactive' $$,
  'Jamais une matière désactivée, même si ses mots correspondent'
);
select is_empty(
  $$ select 1 from tests.suggested where code = 'zz_deja' $$,
  'Ni une matière que la fiche porte déjà'
);
select is_empty(
  $$ select 1 from tests.suggested where code like 'zz_sys%' $$,
  'Un mot commun à plus de trois matières ne distingue rien'
);
select is_empty(
  $$ select 1 from tests.suggested s
     where not exists (select 1 from public.subjects x where x.program_code = 'zz_ia_prog' and x.code = s.code and x.is_active) $$,
  'Jamais une matière d''une autre filière : toutes existent, actives, dans celle de la fiche'
);
select is(
  (select subject_codes from public.resources where id = '78000000-0000-0000-0000-000000000001'),
  array['zz_deja'], 'La fonction n''a rien modifié : la fiche porte les mêmes matières'
);
select is(
  (select count(*) from public.audit_logs where actor_id = 'c0000000-0000-0000-0000-000000007801'),
  0::bigint, 'Ni rien écrit au journal'
);

-- ---------------------------------------------------------------------------
-- Quotas
-- ---------------------------------------------------------------------------
insert into private.rate_limit_buckets (bucket_key, window_start, hits)
select a || ':user:' || left(encode(sha256(convert_to(a || ':c0000000-0000-0000-0000-000000007801', 'UTF8')), 'hex'), 40),
       to_timestamp(floor(extract(epoch from clock_timestamp()) / 300) * 300), 120
from unnest(array['similar-resources', 'classification-suggest']) as a
on conflict (bucket_key, window_start) do update set hits = 120;
select tests.login('c0000000-0000-0000-0000-000000007801', 'aal2');
select throws_ok($$ select * from public.similar_resources('78000000-0000-0000-0000-000000000001') $$, 'P0001', 'rate_limited', 'Cent vingt recherches de doublons par cinq minutes');
select throws_ok($$ select * from public.suggest_resource_classification('78000000-0000-0000-0000-000000000001') $$, 'P0001', 'rate_limited', 'Cent vingt demandes de classification par cinq minutes');
reset role;

select * from finish();
rollback;
