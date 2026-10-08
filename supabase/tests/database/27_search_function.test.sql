-- D-21 : recherche du catalogue par une fonction dédiée.

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
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- A : compte au profil complété. N : profil non complété. F : second facteur non présenté.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000006401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cherche-a@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000006402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cherche-n@test.invalid', now()),
  ('f0000000-0000-0000-0000-000000006403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cherche-f@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-000000006401', 'f0000000-0000-0000-0000-000000006403');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('fa000000-0000-0000-0000-000000006403', 'f0000000-0000-0000-0000-000000006403', 'test', 'totp', 'verified', now(), now(), 'x');

insert into public.organizations (id, name, slug, status) values
  ('64000000-0000-0000-0000-0000000000f1', 'Organisation zzfonction', 'organisation-zzfonction', 'verified');

-- Quatre fiches publiées et publiques, une en attente, une réservée à une organisation.
insert into public.resources
  (id, type_code, title, abstract, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility, organization_id, last_verified_at, published_at)
values
  ('64000000-0000-0000-0000-000000000001', 'article', 'Zzfonction zzfonction des réseaux', 'Zzfonction encore.',
   array['Awa Diop'], array['zzfonction'], 'fr', 'computer_science', 'connector', 'test',
   'https://exemple.invalid/f1', 'open_access', 'published', 'public', null, now(), now() - interval '3 days'),
  ('64000000-0000-0000-0000-000000000002', 'article', 'Une étude', 'Mention unique de zzfonction dans le résumé.',
   array['Kofi Mensah'], '{}', 'fr', 'computer_science', 'connector', 'test',
   'https://exemple.invalid/f2', 'open_access', 'published', 'public', null, now(), now() - interval '1 day'),
  ('64000000-0000-0000-0000-000000000003', 'thesis', 'Zzfonction en anglais', null,
   array['Jane Roe'], '{}', 'en', 'computer_science', 'connector', 'test',
   'https://exemple.invalid/f3', 'paid', 'published', 'public', null, now(), now() - interval '2 days'),
  ('64000000-0000-0000-0000-000000000004', 'article', 'Autre sujet zzautre', null,
   array['Awa Diop'], '{}', 'fr', 'computer_science', 'connector', 'test',
   'https://exemple.invalid/f4', 'open_access', 'published', 'public', null, now(), now()),
  ('64000000-0000-0000-0000-000000000005', 'article', 'Zzfonction en attente', null,
   array['Awa Diop'], '{}', 'fr', 'computer_science', 'connector', 'test',
   'https://exemple.invalid/f5', 'open_access', 'pending', 'public', null, null, null),
  ('64000000-0000-0000-0000-000000000006', 'article', 'Zzfonction réservée', null,
   array['Awa Diop'], '{}', 'fr', 'computer_science', 'connector', 'test',
   'https://exemple.invalid/f6', 'open_access', 'published', 'organization',
   '64000000-0000-0000-0000-0000000000f1', now(), now());

-- Fiches suspendue, retirée et rejetée portant le mot : jamais rendues ni comptées.
insert into public.resources
  (type_code, title, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility)
select 'article', 'Zzfonction ' || s, array['Awa Diop'], '{}', 'fr', 'computer_science', 'connector', 'test',
       'https://exemple.invalid/x-' || s, 'open_access', s, 'public'
from unnest(array['rejected', 'removed']) as s;
update public.resources set editorial_status = 'suspended' where id = '64000000-0000-0000-0000-000000000006';
update public.resources set visibility = 'public' where id = '64000000-0000-0000-0000-000000000006';

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname = 'search_resources'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur ne cherchent par cette fonction'
);
select tests.login('b0000000-0000-0000-0000-000000006402');
select throws_ok($$ select * from public.search_resources('{"terms": ["zzfonction"]}') $$, '42501', 'forbidden', 'Un profil non complété ne cherche pas');
reset role;
select tests.login('f0000000-0000-0000-0000-000000006403');
select throws_ok($$ select * from public.search_resources('{"terms": ["zzfonction"]}') $$, '42501', 'forbidden', 'Ni une session au seul mot de passe d''un compte à second facteur');
reset role;

-- ---------------------------------------------------------------------------
-- Ce que la recherche rend
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000006401');
select results_eq(
  $$ select id, total, capped from public.search_resources('{"terms": ["zzfonction"]}') $$,
  $$ values ('64000000-0000-0000-0000-000000000001'::uuid, 3, false),
            ('64000000-0000-0000-0000-000000000003'::uuid, 3, false),
            ('64000000-0000-0000-0000-000000000002'::uuid, 3, false) $$,
  'Les seules fiches publiées et publiques, les plus pertinentes d''abord : ni en attente, ni suspendue, ni retirée, ni rejetée'
);
select results_eq(
  $$ select id from public.search_resources('{"terms": ["zzfonc", "reseau"]}') $$,
  $$ values ('64000000-0000-0000-0000-000000000001'::uuid) $$,
  'Tous les mots sont exigés, chacun cherché par son début'
);
select results_eq(
  $$ select id from public.search_resources('{"terms": ["zzfonction"], "language": "en"}') $$,
  $$ values ('64000000-0000-0000-0000-000000000003'::uuid) $$,
  'Un filtre restreint les résultats'
);
select results_eq(
  $$ select id from public.search_resources('{"terms": ["zzfonction"], "type": "article", "access": "open_access"}') $$,
  $$ values ('64000000-0000-0000-0000-000000000001'::uuid), ('64000000-0000-0000-0000-000000000002'::uuid) $$,
  'Plusieurs filtres se cumulent'
);
select is(
  (select count(*) from public.search_resources('{"terms": ["zzfonction"], "page": 2}')), 0::bigint,
  'Une page au-delà de la dernière est vide'
);
select is(
  (select count(*) from public.search_resources('{"terms": ["zzintrouvable"]}')), 0::bigint,
  'Un mot absent ne trouve rien'
);
-- Sans mot : les plus récemment publiées d'abord.
select results_eq(
  $$ select id from public.search_resources('{"language": "fr", "type": "article"}') $$,
  $$ select r.id from public.resources r
     where r.editorial_status = 'published' and r.visibility = 'public'
       and r.language_code = 'fr' and r.type_code = 'article'
     order by r.published_at desc, r.id limit 20 $$,
  'Sans mot cherché, les plus récemment publiées d''abord, par pages de vingt'
);
select is(
  (select id from public.search_resources('{"language": "fr", "type": "article"}') limit 1),
  '64000000-0000-0000-0000-000000000004'::uuid, 'La fiche publiée à l''instant vient en tête'
);
select ok(
  (select bool_and(total >= 3 and not capped) from public.search_resources('{"language": "fr", "type": "article"}')),
  'Le décompte accompagne chaque ligne'
);

-- ---------------------------------------------------------------------------
-- Ce qui est refusé
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from public.search_resources(null) $$, '22023', 'invalid_payload', 'Une demande absente est refusée');
select throws_ok($$ select * from public.search_resources('[]') $$, '22023', 'invalid_payload', 'Une demande qui n''est pas un objet aussi');
select throws_ok($$ select * from public.search_resources('{"terms": "zzfonction"}') $$, '22023', 'invalid_payload', 'Des mots qui ne sont pas une liste');
select throws_ok(
  $$ select * from public.search_resources('{"terms": ["zzfonction | zzautre"]}') $$, '22023', 'invalid_payload',
  'Un mot qui porte un opérateur est refusé'
);
select throws_ok(
  $$ select * from public.search_resources('{"terms": ["a:*", "b"]}') $$, '22023', 'invalid_payload',
  'Un mot qui porte un suffixe de requête aussi'
);
select throws_ok(
  $$ select * from public.search_resources('{"terms": ["a","b","c","d","e","f","g","h","i"]}') $$, '22023', 'invalid_payload',
  'Plus de huit mots'
);
select throws_ok($$ select * from public.search_resources('{"page": 0}') $$, '22023', 'invalid_payload', 'Une page nulle');
select throws_ok($$ select * from public.search_resources('{"page": 251}') $$, '22023', 'invalid_payload', 'Une page au-delà du plafond');
select throws_ok($$ select * from public.search_resources('{"page": "1; drop"}') $$, '22023', 'invalid_payload', 'Une page qui n''est pas un nombre');
select is(
  (select count(*) from public.search_resources('{"terms": ["zzfonction"], "type": "x'' or 1=1 --"}')), 0::bigint,
  'Un filtre inconnu du référentiel ne trouve rien et ne casse rien'
);
select is(
  (select count(*) from public.search_resources('{"subject": "zzinconnu"}')), 0::bigint,
  'Sans mot non plus'
);
select is(
  (select count(*) from public.search_resources('{"access": "removed"}')), 0::bigint,
  'Un statut d''accès qui ne se cherche pas ne trouve rien'
);
select throws_ok($$ select * from public.search_resources('{"page": "٣"}') $$, '22023', 'invalid_payload', 'Une page écrite en chiffres d''une autre écriture');
select throws_ok($$ select * from public.search_resources('{"terms": [1]}') $$, '22023', 'invalid_payload', 'Un mot qui n''est pas une chaîne');
select throws_ok($$ select * from public.search_resources('{"terms": [null]}') $$, '22023', 'invalid_payload', 'Un mot absent');
select throws_ok($$ select * from public.search_resources('{"terms": [""]}') $$, '22023', 'invalid_payload', 'Un mot vide');
select throws_ok(
  $$ select * from public.search_resources(jsonb_build_object('terms', jsonb_build_array(repeat('a', 41)))) $$,
  '22023', 'invalid_payload', 'Un mot de quarante et une lettres'
);
select lives_ok(
  $$ select * from public.search_resources(jsonb_build_object('terms', jsonb_build_array(repeat('a', 40), 'été', 'كتاب', 'm²', 'ZZFONCTION'))) $$,
  'Quarante lettres, des accents, une autre écriture, un exposant, des majuscules : acceptés'
);
-- Un mot d'une ou deux lettres est cherché tel quel, pas par son début.
select is(
  (select count(*) from public.search_resources('{"terms": ["zz"]}')), 0::bigint,
  'Deux lettres ne développent pas tous les mots qui commencent ainsi'
);
select is(
  (select count(*) from public.search_resources('{"terms": ["zzf"]}')), 3::bigint,
  'À partir de trois lettres, le mot est cherché par son début'
);

-- Deux cents recherches par cinq minutes et par compte.
reset role;
delete from private.rate_limit_buckets where bucket_key like 'catalogue-search:%';
select tests.login('a0000000-0000-0000-0000-000000006401');
select count(*) from (
  select public.search_resources('{"terms": ["zzintrouvable"]}') from generate_series(1, 200)
) s;
select throws_ok(
  $$ select * from public.search_resources('{"terms": ["zzfonction"]}') $$, 'P0001', 'rate_limited',
  'Au-delà de deux cents recherches en cinq minutes, la suivante est refusée'
);
reset role;

-- ---------------------------------------------------------------------------
-- Décompte plafonné
-- ---------------------------------------------------------------------------
delete from private.rate_limit_buckets where bucket_key like 'catalogue-search:%';
insert into public.resources
  (type_code, title, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility, last_verified_at, published_at)
select 'article', 'Zzmasse ' || i, array['Auteur Test'], '{}', 'fr', 'computer_science', 'connector', 'test',
       'https://exemple.invalid/m' || i, 'open_access', 'published', 'public', now(), now() - make_interval(secs => i)
from generate_series(1, 5010) i;
select tests.login('a0000000-0000-0000-0000-000000006401');
select results_eq(
  $$ select distinct total, capped from public.search_resources('{"terms": ["zzmasse"]}') $$,
  $$ values (5000, true) $$,
  'Au-delà de cinq mille fiches, le décompte s''arrête et le dit'
);
select is(
  (select count(*) from public.search_resources('{"terms": ["zzmasse"], "page": 250}')), 20::bigint,
  'La dernière page servie est la deux cent cinquantième'
);
select ok(
  (select bool_and(total = 5000 and capped) from public.search_resources('{"language": "fr", "type": "article"}')),
  'Sans mot cherché, le décompte est plafonné de la même façon'
);
reset role;
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'resources'
     and indexdef like '%gin (search_vector)%' and indexdef like '%published%' and indexdef like '%public%'),
  1::bigint, 'L''index de recherche ne couvre que les fiches publiées et publiques'
);
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'resources'
     and indexdef like '%gin (search_vector)%'),
  1::bigint, 'Et il est le seul sur cette colonne'
);

select * from finish();
rollback;
