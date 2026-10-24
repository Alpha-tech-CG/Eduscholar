-- LOT 1 : catalogue public, sans compte (ADR-0014).
-- Ce qu'un visiteur lit, et surtout ce qu'il ne lit pas : brouillons, fiches en
-- modération, refusées, suspendues, retirées, réservées à une organisation,
-- identité du contributeur, notes internes, signalements.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
create or replace function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function tests.as_visitor()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Trois comptes : leurs favoris font la popularité. Le premier contribue.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000008301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'public-a@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000008302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'public-b@test.invalid', now()),
  ('c0000000-0000-0000-0000-000000008303', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'public-c@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id = 'a0000000-0000-0000-0000-000000008301';

insert into public.organizations (id, name, slug, status) values
  ('83000000-0000-0000-0000-0000000000f1', 'Université zzpublic', 'universite-zzpublic', 'verified'),
  ('83000000-0000-0000-0000-0000000000f2', 'Institut zzpublic suspendu', 'institut-zzpublic', 'suspended');

-- Publiées et publiques : P1 (Sénégal, informatique, licence 3), P2 (en
-- anglais, sans pays), I1 (institution vérifiée), I2 (organisation suspendue).
-- Dates de publication lointaines : elles passent devant les fiches que
-- d'autres essais auraient laissées dans la base locale. Tout est annulé à la fin.
insert into public.resources
  (id, type_code, title, abstract, authors, institution_name, tags, language_code, country_code, program_code, level_codes,
   source_kind, source_name, source_identifier, official_url, access_status, editorial_status, visibility,
   organization_id, submitted_by, last_verified_at, published_at)
values
  ('83000000-0000-0000-0000-000000000001', 'article', 'Zzpublic réseaux du Sahel', 'Résumé zzpublic.',
   array['Awa Diop'], null, array['zzpublic'], 'fr', 'SN', 'computer_science', array['bachelor_3'],
   'contribution', 'contribution', null, 'https://exemple.invalid/p1', 'open_access', 'published', 'public',
   null, 'a0000000-0000-0000-0000-000000008301', now(), now() + interval '100 years' + interval '4 hours'),
  ('83000000-0000-0000-0000-000000000002', 'thesis', 'Zzpublic in English', null,
   array['Jane Roe'], null, '{}', 'en', null, 'computer_science', '{}',
   'connector', 'crossref', '10.1/zzpublic', 'https://exemple.invalid/p2', 'paid', 'published', 'public',
   null, null, now(), now() + interval '100 years' + interval '3 hours'),
  ('83000000-0000-0000-0000-000000000003', 'article', 'Zzpublic institutionnel vérifié', null,
   '{}', 'Université zzpublic', '{}', 'fr', 'SN', 'computer_science', '{}',
   'organization', 'Université zzpublic', null, 'https://exemple.invalid/i1', 'open_access', 'published', 'public',
   '83000000-0000-0000-0000-0000000000f1', null, now(), now() + interval '100 years' + interval '2 hours'),
  ('83000000-0000-0000-0000-000000000004', 'article', 'Zzpublic institut suspendu', null,
   '{}', 'Institut zzpublic', '{}', 'fr', null, 'computer_science', '{}',
   'organization', 'Institut zzpublic', null, 'https://exemple.invalid/i2', 'open_access', 'published', 'public',
   '83000000-0000-0000-0000-0000000000f2', null, now(), now() + interval '100 years' + interval '1 hour');

-- Invisibles du visiteur, à chaque statut, et une fiche publiée mais réservée.
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility, submitted_by)
select ('83000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       'article', 'Zzpublic caché ' || s, array['Awa Diop'], array['zzpublic'], 'fr', 'computer_science',
       'contribution', 'contribution', 'https://exemple.invalid/x-' || s, 'open_access', 'pending', 'public',
       'a0000000-0000-0000-0000-000000008301'
from unnest(array['pending', 'under_review', 'changes_requested', 'verified', 'rejected', 'suspended', 'removed'])
  with ordinality as t (s, n);
-- Les statuts sont posés après coup, comme la modération les pose : la
-- contrainte de publication exige une date de vérification.
update public.resources set last_verified_at = now(), access_status = 'open_access'
  where id::text like '83000000-0000-0000-0000-0000000001%';
update public.resources r set editorial_status = t.s
  from unnest(array['pending', 'under_review', 'changes_requested', 'verified', 'rejected', 'suspended', 'removed'])
       with ordinality as t (s, n)
  where r.id = ('83000000-0000-0000-0000-0000000001' || lpad(t.n::text, 2, '0'))::uuid;
insert into public.resources
  (id, type_code, title, authors, tags, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, visibility, organization_id, last_verified_at, published_at)
values
  ('83000000-0000-0000-0000-000000000199', 'article', 'Zzpublic réservé', array['Awa Diop'], array['zzpublic'],
   'fr', 'computer_science', 'organization', 'Université zzpublic', 'https://exemple.invalid/r',
   'open_access', 'published', 'organization', '83000000-0000-0000-0000-0000000000f1', now(), now() + interval '100 years' + interval '5 hours');

-- Notes internes et signalement sur P1 : jamais rendus.
insert into public.resource_internal (resource_id, contributor_comment, moderation_notes)
values ('83000000-0000-0000-0000-000000000001', 'zzsecret-commentaire', 'zzsecret-moderation')
on conflict (resource_id) do update set contributor_comment = excluded.contributor_comment,
  moderation_notes = excluded.moderation_notes;
insert into public.resource_reports (resource_id, reporter_id, reason, details)
values ('83000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000008302', 'error', 'zzsecret-signalement');

-- Favoris : trois sur P1 (populaire), deux sur P2 (sous le seuil), trois sur
-- une fiche suspendue (jamais populaire).
insert into public.resource_favorites (user_id, resource_id) values
  ('a0000000-0000-0000-0000-000000008301', '83000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000008302', '83000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000008303', '83000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000008301', '83000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000008302', '83000000-0000-0000-0000-000000000002');
-- La fiche suspendue : les favoris se posent avant la suspension, par la base.
update public.resources set editorial_status = 'published', published_at = now()
  where id = '83000000-0000-0000-0000-000000000106';
insert into public.resource_favorites (user_id, resource_id) values
  ('a0000000-0000-0000-0000-000000008301', '83000000-0000-0000-0000-000000000106'),
  ('b0000000-0000-0000-0000-000000008302', '83000000-0000-0000-0000-000000000106'),
  ('c0000000-0000-0000-0000-000000008303', '83000000-0000-0000-0000-000000000106');
update public.resources set editorial_status = 'suspended' where id = '83000000-0000-0000-0000-000000000106';

-- Popularité (migration 008400) : seuls comptent les comptes actifs créés
-- depuis sept jours au moins. A, B et C sont anciens. Trois favoris de plus
-- sur P2, aucun retenu : D est trop récent, E suspendu, F sans adresse confirmée.
update auth.users set created_at = now() - interval '8 days'
  where id in ('a0000000-0000-0000-0000-000000008301', 'b0000000-0000-0000-0000-000000008302',
               'c0000000-0000-0000-0000-000000008303');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at) values
  ('d0000000-0000-0000-0000-000000008304', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'public-d@test.invalid', now(), now() - interval '6 days'),
  ('e0000000-0000-0000-0000-000000008305', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'public-e@test.invalid', now(), now() - interval '30 days'),
  ('f0000000-0000-0000-0000-000000008306', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'public-f@test.invalid', null, now() - interval '30 days');
insert into private.account_status (user_id, status, reason) values
  ('e0000000-0000-0000-0000-000000008305', 'suspended', 'essai');
insert into public.resource_favorites (user_id, resource_id) values
  ('d0000000-0000-0000-0000-000000008304', '83000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000008305', '83000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000008306', '83000000-0000-0000-0000-000000000002');
select private.refresh_resource_popularity();

create temporary table hidden_ids on commit drop as
  select id from public.resources
  where id::text like '83000000-0000-0000-0000-0000000001%';
grant select on hidden_ids to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Le visiteur : une fiche
-- ---------------------------------------------------------------------------
select tests.as_visitor();

select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.public_resource('83000000-0000-0000-0000-000000000001')) as k),
  array['abstract', 'access_status', 'authors', 'country_code', 'doi', 'id', 'institution_name', 'language_code',
        'last_verified_at', 'level_codes', 'license_code', 'official_url', 'program_code', 'publication_year',
        'published_at', 'source_kind', 'source_name', 'subject_codes', 'tags', 'thesis_degree', 'title',
        'type_code', 'updated_at', 'verified_institution'],
  'Une fiche publique ne rend que ses colonnes de description : ni contributeur, ni organisation, ni statut, ni identifiant chez la source'
);
select is(public.public_resource('83000000-0000-0000-0000-000000000001') ->> 'title', 'Zzpublic réseaux du Sahel',
  'Le visiteur lit une fiche publiée et publique');
select ok(
  public.public_resource('83000000-0000-0000-0000-000000000001')::text !~ 'zzsecret|a0000000-0000-0000-0000-000000008301',
  'Ni notes internes, ni signalement, ni identité du contributeur'
);
select is(
  (select count(*) from hidden_ids h where public.public_resource(h.id) is not null), 0::bigint,
  'En attente, en examen, à corriger, vérifiée, refusée, suspendue, retirée, réservée : aucune ne se lit'
);
select is(public.public_resource('83000000-0000-0000-0000-00000000ffff'), null,
  'Une fiche inexistante donne la même réponse');
select is((public.public_resource('83000000-0000-0000-0000-000000000003') ->> 'verified_institution')::boolean, true,
  'Fiche d''une organisation vérifiée : badge');
select is((public.public_resource('83000000-0000-0000-0000-000000000004') ->> 'verified_institution')::boolean, false,
  'Organisation suspendue : pas de badge');
select is((public.public_resource('83000000-0000-0000-0000-000000000001') ->> 'verified_institution')::boolean, false,
  'Contribution : pas de badge');

-- ---------------------------------------------------------------------------
-- Le visiteur : la recherche
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(e ->> 'id' order by e ->> 'id')
   from jsonb_array_elements(public.public_search_resources('{"terms": ["zzpublic"]}') -> 'items') as e),
  array['83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002',
        '83000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000004'],
  'La recherche ne rend que les fiches publiées et publiques'
);
select is((public.public_search_resources('{"terms": ["zzpublic"]}') ->> 'total')::integer, 4,
  'Le décompte ne compte pas les fiches cachées');
select is(
  (select array_agg(e ->> 'id' order by e ->> 'id')
   from jsonb_array_elements(public.public_search_resources('{"terms": ["zzpublic"], "country": "SN"}') -> 'items') as e),
  array['83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000003'],
  'Filtre par pays'
);
select is(
  (select array_agg(e ->> 'id')
   from jsonb_array_elements(public.public_search_resources('{"terms": ["zzpublic"], "level": "bachelor_3", "program": "computer_science"}') -> 'items') as e),
  array['83000000-0000-0000-0000-000000000001'],
  'Filtres par niveau et par filière, cumulés'
);
select is(public.public_search_resources('{"terms": ["zzpublic"], "country": "ZZ"}'),
  '{"items": [], "total": 0, "capped": false}'::jsonb, 'Un filtre hors référentiel ne trouve rien');
select is(jsonb_array_length(public.public_search_resources('{"terms": ["zzpublic"], "page": 2}') -> 'items'), 0,
  'Une page au-delà de la dernière est vide');
select ok(
  public.public_search_resources('{"terms": ["zzpublic"]}')::text !~ 'zzsecret|caché|réservé|submitted_by|organization_id',
  'Rien des fiches cachées ni des données internes dans la réponse'
);
select throws_ok($$ select public.public_search_resources('{"terms": ["a b"]}') $$, '22023', 'invalid_payload',
  'Un mot avec espace est refusé');
select throws_ok($$ select public.public_search_resources('{"terms": ["a","b","c","d","e","f","g","h","i"]}') $$,
  '22023', 'invalid_payload', 'Neuf mots sont refusés');
select throws_ok($$ select public.public_search_resources('{"page": 251}') $$, '22023', 'invalid_payload',
  'Au-delà de la page 250, refus');
select throws_ok($$ select public.public_search_resources('{"country": ["SN"]}') $$, '22023', 'invalid_payload',
  'Un filtre qui n''est pas une chaîne est refusé');
select throws_ok($$ select public.public_search_resources('[]') $$, '22023', 'invalid_payload',
  'Une demande qui n''est pas un objet est refusée');

-- ---------------------------------------------------------------------------
-- Le visiteur : l'accueil et le plan du site
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(e ->> 'id' not in (select id::text from hidden_ids))
   from jsonb_each(public.public_home_sections()) as s (name, list),
        jsonb_array_elements(s.list) as e),
  'Aucune section de l''accueil ne montre une fiche cachée'
);
select ok(
  (select bool_or(e ->> 'id' = '83000000-0000-0000-0000-000000000001')
   from jsonb_array_elements(public.public_home_sections() -> 'recent') as e),
  'Les récentes montrent une fiche publiée'
);
select ok(
  (select bool_or(e ->> 'id' = '83000000-0000-0000-0000-000000000001')
   from jsonb_array_elements(public.public_home_sections() -> 'popular') as e),
  'Trois favoris : la fiche est populaire'
);
select ok(
  (select coalesce(bool_and(e ->> 'id' <> '83000000-0000-0000-0000-000000000002'), true)
   from jsonb_array_elements(public.public_home_sections() -> 'popular') as e),
  'Cinq favoris dont deux retenus (compte récent, suspendu ou non confirmé) : sous le seuil'
);
select ok(
  public.public_home_sections()::text !~ '"(n|count|favorites)"',
  'Le nombre de favoris n''est pas rendu'
);
select ok(
  (select bool_or(e ->> 'id' = '83000000-0000-0000-0000-000000000003')
   from jsonb_array_elements(public.public_home_sections() -> 'institutional') as e)
  and (select bool_and(e ->> 'id' <> '83000000-0000-0000-0000-000000000004'
                       and (e ->> 'verified_institution')::boolean)
       from jsonb_array_elements(public.public_home_sections() -> 'institutional') as e),
  'Mise en avant : les seules fiches d''une institution vérifiée'
);
select ok(
  (select bool_or(e ->> 'id' = '83000000-0000-0000-0000-000000000001')
   from jsonb_array_elements(public.public_sitemap_resources()) as e)
  and (select bool_and(e ->> 'id' not in (select id::text from hidden_ids))
       from jsonb_array_elements(public.public_sitemap_resources()) as e),
  'Le plan du site liste les fiches publiques, aucune fiche cachée'
);
select is(
  (select array_agg(distinct k order by k)
   from jsonb_array_elements(public.public_sitemap_resources()) as e, jsonb_object_keys(e) as k),
  array['id', 'updated_at'], 'Le plan du site ne rend qu''un identifiant et une date'
);
select ok(jsonb_array_length(public.public_reference_data() -> 'countries') > 0,
  'Le visiteur lit les référentiels');

-- ---------------------------------------------------------------------------
-- Le visiteur ne lit rien d'autre
-- ---------------------------------------------------------------------------
select throws_ok('select id from public.resources', '42501', null, 'Pas de lecture directe des fiches');
select throws_ok('select 1 from public.resource_internal', '42501', null, 'Ni des notes internes');
select throws_ok('select 1 from public.resource_reports', '42501', null, 'Ni des signalements');
select throws_ok('select 1 from public.resource_favorites', '42501', null, 'Ni des favoris');
select throws_ok('select 1 from public.organizations', '42501', null, 'Ni des organisations');
select throws_ok('select 1 from public.resource_status_history', '42501', null, 'Ni de l''historique');
select throws_ok($$ select private.public_resource_object(null::public.resources) $$, '42501', null,
  'La fonction de mise en forme n''est pas appelable');
select throws_ok($$ select * from public.search_resources('{}') $$, '42501', null,
  'La recherche des comptes reste fermée au visiteur');
select throws_ok($$ select public.reference_data() $$, '42501', null,
  'Les référentiels des comptes aussi');
select throws_ok($$ select public.set_favorite('83000000-0000-0000-0000-000000000001', true) $$, '42501', null,
  'Aucune écriture : pas de favori');
select throws_ok($$ select public.report_resource('83000000-0000-0000-0000-000000000001', 'error', null) $$, '42501', null,
  'Aucune écriture : pas de signalement');

select set_config('role', 'postgres', true);

-- ---------------------------------------------------------------------------
-- Les comptes et le rôle serveur n'appellent pas ces fonctions
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000008301');
select throws_ok($$ select public.public_resource('83000000-0000-0000-0000-000000000001') $$, '42501', null,
  'Un compte connecté lit par ses propres fonctions, sous RLS');
select throws_ok($$ select public.public_search_resources('{}') $$, '42501', null,
  'Ni la recherche publique');
-- Même forme que les référentiels des comptes : gardé en mémoire pour comparer.
select set_config('tests.reference', public.reference_data()::text, true);
select set_config('role', 'postgres', true);
select is(private.public_reference_data(), current_setting('tests.reference')::jsonb,
  'Les référentiels publics sont ceux que lit un compte actif (dérive détectée)');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname like 'public\_%'
     and has_function_privilege('service_role', p.oid, 'execute')),
  0::bigint, 'Le rôle serveur n''exécute aucune fonction du catalogue public'
);

-- ---------------------------------------------------------------------------
-- Agrégat de popularité (migration 008400)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select resource_id, favorites from private.resource_popularity
     where resource_id::text like '83000000-%' order by resource_id $$,
  $$ values ('83000000-0000-0000-0000-000000000001'::uuid, 3) $$,
  'L''agrégat ne garde que P1 : ni P2 (deux favoris retenus), ni la fiche suspendue'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) as r (role)
   where has_table_privilege(r.role, 'private.resource_popularity', 'select,insert,update,delete')
      or has_function_privilege(r.role, 'private.refresh_resource_popularity()', 'execute')),
  0::bigint, 'Aucun rôle de l''API ne lit l''agrégat ni ne le recalcule'
);
select is(
  (select count(*) from cron.job where jobname = 'eduscholar-popularity' and active and username = 'postgres'),
  1::bigint, 'Le recalcul est planifié chaque nuit, sous le rôle postgres'
);
-- Un nouveau favori ne change rien avant le recalcul : l'ordre ne date aucun geste.
insert into public.resource_favorites (user_id, resource_id) values
  ('a0000000-0000-0000-0000-000000008301', '83000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000008302', '83000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000008303', '83000000-0000-0000-0000-000000000003');
select ok(
  (select coalesce(bool_and(e ->> 'id' <> '83000000-0000-0000-0000-000000000003'), true)
   from jsonb_array_elements(private.public_home_sections() -> 'popular') as e),
  'Avant le recalcul, trois favoris récents ne classent pas la fiche'
);
select private.refresh_resource_popularity();
select ok(
  (select bool_or(e ->> 'id' = '83000000-0000-0000-0000-000000000003')
   from jsonb_array_elements(private.public_home_sections() -> 'popular') as e),
  'Après le recalcul, elle l''est'
);
-- Une fiche suspendue sort de l'accueil sans attendre le recalcul.
update public.resources set editorial_status = 'suspended' where id = '83000000-0000-0000-0000-000000000001';
select ok(
  (select coalesce(bool_and(e ->> 'id' <> '83000000-0000-0000-0000-000000000001'), true)
   from jsonb_array_elements(private.public_home_sections() -> 'popular') as e),
  'Une fiche suspendue quitte les populaires aussitôt'
);

select * from finish();
rollback;
