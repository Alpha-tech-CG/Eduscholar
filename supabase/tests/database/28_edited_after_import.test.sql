-- D-20 : champs modifiés après un import par connecteur.

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
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- M : modératrice. A : compte ordinaire.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('c0000000-0000-0000-0000-000000006701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'modif-m@test.invalid', now()),
  ('a0000000-0000-0000-0000-000000006702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'modif-a@test.invalid', now());
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-00000000670_';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('fa000000-0000-0000-0000-000000006701', 'c0000000-0000-0000-0000-000000006701', 'test', 'totp', 'verified', now() - interval '2 days', now(), 'x');
insert into public.platform_roles (user_id, role) values ('c0000000-0000-0000-0000-000000006701', 'moderator');

-- Une fiche importée, une fiche proposée par un contributeur.
insert into public.resources
  (id, type_code, title, authors, publication_year, tags, language_code, program_code, source_kind, source_name,
   source_identifier, official_url, access_status, license_code, editorial_status, visibility, edited_fields)
values
  ('67000000-0000-0000-0000-000000000001', 'article', 'Titre de la source', array['Awa Diop'], 2021, '{}', 'fr',
   'computer_science', 'connector', 'crossref', '10.1234/zzmodif', 'https://doi.org/10.1234/zzmodif',
   'unknown', 'unknown', 'pending', 'public', array['title']),
  ('67000000-0000-0000-0000-000000000002', 'article', 'Titre proposé', array['Kofi Mensah'], 2020, '{}', 'fr',
   'computer_science', 'contribution', 'Contribution', null, 'https://exemple.invalid/zzmodif',
   'unknown', 'unknown', 'pending', 'public', '{}');

select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000001'), '{}'::text[],
  'À la création, la liste est vide, même si une valeur est fournie'
);
select ok(
  has_column_privilege('authenticated', 'public.resources', 'edited_fields', 'select'),
  'La liste se lit avec la fiche'
);
select ok(
  not has_column_privilege('authenticated', 'public.resources', 'edited_fields', 'update')
  and not has_column_privilege('authenticated', 'public.resources', 'edited_fields', 'insert'),
  'Un utilisateur ne l''écrit pas ; le rôle serveur écrit des fiches, mais le déclencheur écrase sa valeur'
);

-- La modératrice renseigne ce qui ne vient pas de la source : rien n'est signalé.
select tests.login('c0000000-0000-0000-0000-000000006701', 'aal2');
select public.moderator_update_resource('67000000-0000-0000-0000-000000000001',
  '{"access_status": "open_access", "tags": ["réseaux"], "abstract": "Résumé rédigé par la modération."}');
reset role;
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000001'), '{}'::text[],
  'Renseigner le statut d''accès, les mots-clés ou le résumé n''est pas modifier la source'
);

-- Elle corrige le titre et la licence : les deux sont signalés.
select tests.login('c0000000-0000-0000-0000-000000006701', 'aal2');
select public.moderator_update_resource('67000000-0000-0000-0000-000000000001',
  '{"title": "Titre corrigé", "license_code": "cc-by-4.0"}');
reset role;
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000001'),
  array['title', 'license_code'], 'Le titre et la licence corrigés sont signalés'
);
-- Elle corrige les auteurs, et le titre de nouveau : sans doublon, dans un ordre fixe.
select tests.login('c0000000-0000-0000-0000-000000006701', 'aal2');
select public.moderator_update_resource('67000000-0000-0000-0000-000000000001',
  '{"title": "Titre corrigé encore", "authors": ["Awa Diop", "Kofi Mensah"]}');
-- Une modification qui ne change rien n'ajoute rien.
select public.moderator_update_resource('67000000-0000-0000-0000-000000000001', '{"publication_year": "2021"}');
reset role;
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000001'),
  array['title', 'authors', 'license_code'], 'La liste s''allonge sans doublon ; une valeur inchangée n''y entre pas'
);
-- Revenir à la valeur d'origine ne retire rien : la base ne garde pas l'original.
select tests.login('c0000000-0000-0000-0000-000000006701', 'aal2');
select public.moderator_update_resource('67000000-0000-0000-0000-000000000001', '{"title": "Titre de la source"}');
reset role;
select ok(
  (select 'title' = any (edited_fields) from public.resources where id = '67000000-0000-0000-0000-000000000001'),
  'Un champ signalé le reste'
);

-- Personne ne vide ni n'écrit la liste, pas même le propriétaire de la base.
update public.resources set edited_fields = '{}' where id = '67000000-0000-0000-0000-000000000001';
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000001'),
  array['title', 'authors', 'license_code'], 'Une valeur fournie est écrasée : la liste ne se vide pas'
);
update public.resources set edited_fields = array['official_url'] where id = '67000000-0000-0000-0000-000000000002';
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000002'), '{}'::text[],
  'Ni ne s''invente'
);

-- Une fiche qui ne vient pas d'un connecteur n'a rien à signaler.
select tests.login('c0000000-0000-0000-0000-000000006701', 'aal2');
select public.moderator_update_resource('67000000-0000-0000-0000-000000000002', '{"title": "Titre revu"}');
reset role;
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000002'), '{}'::text[],
  'Une contribution corrigée n''est pas signalée : elle n''a pas de source à contredire'
);

-- Publiée, la fiche montre sa liste à tout compte actif.
update public.resources
set editorial_status = 'published', last_verified_at = now(), published_at = now()
where id = '67000000-0000-0000-0000-000000000001';
select tests.login('a0000000-0000-0000-0000-000000006702');
select is(
  (select edited_fields from public.resources where id = '67000000-0000-0000-0000-000000000001'),
  array['title', 'authors', 'license_code'], 'Un lecteur voit quels champs ont été modifiés depuis l''import'
);
select throws_ok(
  $$ update public.resources set edited_fields = '{}' where id = '67000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'Et ne peut pas y toucher'
);
reset role;

select * from finish();
rollback;
