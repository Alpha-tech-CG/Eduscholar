-- Lots 5 et 6 : types de ressources (mémoire séparé de la thèse, codes réservés
-- activés) ; région du profil et réglages de confidentialité (profile_public).

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

create function tests.anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create function tests.payload(p_overrides jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'type_code', 'memoir',
    'title', 'Mémoire sur les arbres équilibrés',
    'authors', jsonb_build_array('Awa Diop'),
    'institution_name', 'Université de test',
    'publication_year', 2024,
    'thesis_degree', 'master',
    'language_code', 'fr',
    'program_code', 'computer_science',
    'official_url', 'https://exemple.invalid/memoire',
    'access_status', 'open_access',
    'license_code', 'cc-by-4.0',
    'rights_declared', true
  ) || p_overrides;
$$;
create function tests.insert_resource(p_type text, p_degree text)
returns void language sql as $$
  insert into public.resources (type_code, title, language_code, program_code, source_kind, source_name, thesis_degree)
  values (p_type, 'Fiche de contrôle du diplôme', 'fr', 'computer_science', 'contribution', 'test', p_degree);
$$;

create function tests.set_region(p_value text)
returns void language sql as $$
  update public.profiles set region = p_value where user_id = 'a0000000-0000-0000-0000-0000000037a1';
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- A et B au profil complété ; C sans profil complété.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000037a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000037b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot-b@test.invalid'),
  ('c0000000-0000-0000-0000-0000000037c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lot-c@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id in ('a0000000-0000-0000-0000-0000000037a1', 'b0000000-0000-0000-0000-0000000037b2');

-- ===========================================================================
-- Lot 5 : types de ressources
-- ===========================================================================
select is(
  (select labels from public.resource_types where code = 'memoir'),
  '{"fr": "Mémoire", "en": "Dissertation (bachelor''s or master''s)"}'::jsonb,
  'Le type « mémoire » existe, libellé en français et en anglais'
);
select is(
  (select labels ->> 'fr' from public.resource_types where code = 'thesis'), 'Thèse',
  'Le type « thesis » désigne désormais la thèse'
);
select is(
  (select array_agg(code order by code) from public.resource_types where not is_active), null,
  'Aucun type n''est plus réservé : tous sont actifs'
);
select is(
  (select count(*) from public.resource_types
   where is_active and code in ('chapter', 'report', 'preprint', 'past_exam',
                                'technical_documentation', 'dataset', 'presentation')),
  7::bigint, 'Les sept codes réservés sont activés'
);
select tests.login('a0000000-0000-0000-0000-0000000037a1');
select ok(
  public.reference_data() -> 'resource_types' @> '[{"code": "memoir"}, {"code": "dataset"}, {"code": "presentation"}]'::jsonb,
  'Les référentiels servis à l''application proposent les nouveaux types'
);
reset role;

-- Contrainte : diplôme cohérent avec le type.
select lives_ok($$ select tests.insert_resource('thesis', 'doctorate') $$, 'Une thèse de doctorat');
select lives_ok($$ select tests.insert_resource('thesis', null) $$, 'Une thèse sans diplôme précisé');
select lives_ok($$ select tests.insert_resource('memoir', 'master') $$, 'Un mémoire de master');
select lives_ok($$ select tests.insert_resource('memoir', 'bachelor') $$, 'Un mémoire de licence');
select lives_ok($$ select tests.insert_resource('memoir', null) $$, 'Un mémoire sans diplôme précisé');
select throws_ok($$ select tests.insert_resource('thesis', 'master') $$, '23514', null,
  'Une « thèse » de master est un mémoire : refusée');
select throws_ok($$ select tests.insert_resource('thesis', 'bachelor') $$, '23514', null,
  'Une « thèse » de licence est refusée');
select throws_ok($$ select tests.insert_resource('memoir', 'doctorate') $$, '23514', null,
  'Un « mémoire » de doctorat est refusé');
select throws_ok($$ select tests.insert_resource('article', 'master') $$, '23514', null,
  'Un article ne porte pas de diplôme');
select throws_ok($$ select tests.insert_resource('dataset', 'doctorate') $$, '23514', null,
  'Un jeu de données ne porte pas de diplôme');
select is(
  (select count(*) from public.resources where type_code = 'thesis' and thesis_degree in ('bachelor', 'master')),
  0::bigint, 'Plus aucune thèse de licence ou de master au catalogue'
);

-- Soumission par la fonction nommée, avec les nouveaux types.
select tests.login('a0000000-0000-0000-0000-0000000037a1');
select lives_ok($$ select public.submit_resource(tests.payload()) $$, 'Un mémoire de master se propose');
select lives_ok(
  $$ select public.submit_resource(tests.payload('{"type_code": "chapter", "thesis_degree": "", "official_url": "https://exemple.invalid/chapitre"}')) $$,
  'Un chapitre se propose'
);
select lives_ok(
  $$ select public.submit_resource(tests.payload('{"type_code": "past_exam", "thesis_degree": "", "official_url": "https://exemple.invalid/annale"}')) $$,
  'Une annale se propose'
);
select throws_ok(
  $$ select public.submit_resource(tests.payload('{"thesis_degree": "doctorate", "official_url": "https://exemple.invalid/m2"}')) $$,
  '23514', null, 'Un mémoire de doctorat est refusé par la fonction aussi'
);
reset role;

-- Codes câblés : ils ne se désactivent par aucun chemin.
select throws_ok($$ update public.resource_types set is_active = false where code = 'memoir' $$,
  'P0001', 'protected_reference', 'Le type « memoir » ne se désactive pas');
select throws_ok($$ update public.resource_types set is_active = false where code = 'thesis' $$,
  'P0001', 'protected_reference', 'Le type « thesis » non plus, même hors de la fonction d''administration');
select lives_ok($$ update public.resource_types set labels = labels where code = 'memoir' $$,
  'Un type câblé reste modifiable pour le reste');
select lives_ok($$ update public.resource_types set is_active = false where code = 'presentation' $$,
  'Un type non câblé se désactive');
select tests.login('a0000000-0000-0000-0000-0000000037a1');
select throws_ok(
  $$ select public.submit_resource(tests.payload('{"type_code": "presentation", "thesis_degree": "", "official_url": "https://exemple.invalid/p"}')) $$,
  '23514', 'invalid_type', 'Un type désactivé est refusé'
);
reset role;

-- Reclassement d'une fiche importée, hors migration : la modification est
-- bien suivie (le déclencheur a été réactivé).
insert into public.resources (id, type_code, title, language_code, program_code, source_kind, source_name)
values ('37000000-0000-0000-0000-000000000009', 'thesis', 'Thèse importée', 'fr', 'computer_science', 'connector', 'test');
update public.resources set type_code = 'memoir' where id = '37000000-0000-0000-0000-000000000009';
select is(
  (select edited_fields from public.resources where id = '37000000-0000-0000-0000-000000000009'),
  array['type_code'], 'Après la migration, un changement de type d''une fiche importée est consigné'
);

-- Reprise d'une fiche publiée dans un projet.
insert into public.resources
  (id, type_code, title, authors, publication_year, institution_name, thesis_degree, language_code, program_code,
   source_kind, source_name, official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('37000000-0000-0000-0000-000000000001', 'memoir', 'Mémoire publié', array['Awa Diop'], 2023, 'Université de test', 'master',
   'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/m', 'open_access', 'published', now(), now()),
  ('37000000-0000-0000-0000-000000000002', 'report', 'Rapport publié', array['Agence de test'], 2022, 'Agence de test', null,
   'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/r', 'open_access', 'published', now(), now()),
  ('37000000-0000-0000-0000-000000000003', 'chapter', 'Chapitre publié', array['Kofi Mensah'], 2021, 'Université de test', null,
   'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/c', 'open_access', 'published', now(), now()),
  ('37000000-0000-0000-0000-000000000004', 'dataset', 'Jeu de données publié', array['Kofi Mensah'], 2021, 'Université de test', null,
   'fr', 'computer_science', 'connector', 'test', 'https://exemple.invalid/d', 'open_access', 'published', now(), now());
insert into public.research_projects (id, owner_id, title) values
  ('37000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000037a1', 'Projet de A');

select tests.login('a0000000-0000-0000-0000-0000000037a1');
select public.add_project_source_from_resource('37000000-0000-0000-0000-0000000000a1', r.id)
from (values ('37000000-0000-0000-0000-000000000001'::uuid), ('37000000-0000-0000-0000-000000000002'),
             ('37000000-0000-0000-0000-000000000003'), ('37000000-0000-0000-0000-000000000004')) as r (id);
select results_eq(
  $$ select s.title, s.source_type, s.publisher from public.project_sources s
     where s.project_id = '37000000-0000-0000-0000-0000000000a1' order by s.title $$,
  $$ values ('Chapitre publié', 'chapter', null::text),
            ('Jeu de données publié', 'other', null::text),
            ('Mémoire publié', 'thesis', 'Université de test'),
            ('Rapport publié', 'report', 'Agence de test') $$,
  'Un mémoire se reprend comme thèse ou mémoire, un rapport comme rapport, un chapitre comme chapitre'
);
reset role;

-- ===========================================================================
-- Lot 6 : région du profil
-- ===========================================================================
select tests.login('a0000000-0000-0000-0000-0000000037a1');
select lives_ok(
  $$ update public.profiles set region = 'Île-de-France' where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'Le titulaire renseigne sa région'
);
select is((select region from public.profiles), 'Île-de-France', 'Et la relit');
select lives_ok(
  $$ update public.profiles set region = 'الرباط' where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'Une région en écriture non latine est admise'
);
select lives_ok(
  $$ update public.profiles set region = null where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'La région s''efface'
);

select throws_ok($$ select tests.set_region(' Dakar') $$, '23514', null, 'Une région non normalisée est refusée');
select throws_ok($$ select tests.set_region('Grand  Dakar') $$, '23514', null, 'Des espaces doublés sont refusés');
select throws_ok($$ select tests.set_region('x') $$, '23514', null, 'Une région d''un caractère est refusée');
select throws_ok($$ select tests.set_region(repeat('x', 101)) $$, '23514', null, 'Une région de plus de 100 caractères est refusée');
select throws_ok($$ select tests.set_region('<b>Dakar</b>') $$, '23514', null, 'Une balise est refusée');
select throws_ok($$ select tests.set_region('=HYPERLINK("x")') $$, '23514', null, 'Une formule de tableur est refusée');
select throws_ok($$ select tests.set_region('Da' || chr(8203) || 'kar') $$, '23514', null, 'Un caractère invisible est refusé');
select throws_ok($$ select tests.set_region('Dakar' || chr(8238)) $$, '23514', null, 'Un caractère bidirectionnel est refusé');
select throws_ok($$ select tests.set_region('Da' || chr(10) || 'kar') $$, '23514', null, 'Un saut de ligne est refusé');
select throws_ok($$ select tests.set_region('75 013') $$, '23514', null, 'Une région sans lettre est refusée');
select lives_ok($$ select tests.set_region('Dakar') $$, 'Région de A : Dakar');
reset role;

-- B ne lit ni ne modifie la région de A.
select tests.login('b0000000-0000-0000-0000-0000000037b2');
select is_empty(
  $$ select region from public.profiles where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'B ne lit pas la région de A'
);
update public.profiles set region = 'Usurpée' where user_id = 'a0000000-0000-0000-0000-0000000037a1';
reset role;
select is(
  (select region from public.profiles where user_id = 'a0000000-0000-0000-0000-0000000037a1'), 'Dakar',
  'B ne modifie pas la région de A'
);
select tests.anon();
select throws_ok($$ select region from public.profiles $$, '42501', null, 'anon ne lit aucun profil');
select throws_ok($$ select display_name from public.profile_public $$, '42501', null, 'anon ne lit pas profile_public');
reset role;

-- ===========================================================================
-- Lot 6 : confidentialité
-- ===========================================================================
select is(
  (select count(*) from public.profile_public
   where user_id::text like '%-0000000037__' and (is_public or display_name is not null)),
  0::bigint, 'Par défaut, rien n''est public ni nommé'
);

select tests.login('a0000000-0000-0000-0000-0000000037a1');
select throws_ok(
  $$ update public.profile_public set is_public = true where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  '23514', null, 'Un profil public sans nom affiché est refusé'
);
select throws_ok(
  $$ update public.profile_public set display_name = '<script>' where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  '23514', null, 'Un nom affiché avec balise est refusé'
);
select throws_ok(
  $$ update public.profile_public set display_name = ' Awa' where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  '23514', null, 'Un nom affiché non normalisé est refusé'
);
select throws_ok(
  $$ update public.profile_public set display_name = '@Awa' where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  '23514', null, 'Un nom affiché en forme de formule est refusé'
);
select lives_ok(
  $$ update public.profile_public set display_name = 'Awa D.' where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'Un nom affiché sans publication'
);
reset role;
select is(
  (select count(*) from public.audit_logs where target_type = 'profile_public'
     and subject_user_id = 'a0000000-0000-0000-0000-0000000037a1'),
  0::bigint, 'Changer de nom sans changer de visibilité n''est pas journalisé'
);

-- Le nom n'est pas public : B ne le voit pas.
select tests.login('b0000000-0000-0000-0000-0000000037b2');
select is_empty(
  $$ select 1 from public.profile_public where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'B ne voit pas le nom affiché d''un profil privé'
);
update public.profile_public set is_public = true, display_name = 'Usurpé' where user_id = 'a0000000-0000-0000-0000-0000000037a1';
reset role;
select is(
  (select display_name || '/' || is_public::text from public.profile_public where user_id = 'a0000000-0000-0000-0000-0000000037a1'),
  'Awa D./false', 'B ne publie ni ne renomme le profil de A'
);

select tests.login('a0000000-0000-0000-0000-0000000037a1');
select lives_ok(
  $$ update public.profile_public set is_public = true where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'A publie son profil'
);
select ok(
  exists (select 1 from public.my_account_events() where action = 'profile.published' and category = 'security'),
  'La publication figure dans les événements du compte de A'
);
reset role;
select results_eq(
  $$ select actor_id, subject_user_id, category, metadata from public.audit_logs
     where target_type = 'profile_public' and subject_user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  $$ values ('a0000000-0000-0000-0000-0000000037a1'::uuid, 'a0000000-0000-0000-0000-0000000037a1'::uuid,
             'security'::text, '{}'::jsonb) $$,
  'La publication est journalisée par son auteur, sans le nom'
);

select tests.login('b0000000-0000-0000-0000-0000000037b2');
select results_eq(
  $$ select display_name from public.profile_public where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  $$ values ('Awa D.'::text) $$,
  'Une fois publié, B lit le nom affiché de A'
);
select is_empty(
  $$ select region from public.profiles where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'Ni la région ni le reste du profil ne deviennent lisibles'
);
reset role;

select tests.login('a0000000-0000-0000-0000-0000000037a1');
select lives_ok(
  $$ update public.profile_public set is_public = false where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'A retire son profil public'
);
reset role;
select is(
  (select array_agg(action order by id) from public.audit_logs
   where target_type = 'profile_public' and subject_user_id = 'a0000000-0000-0000-0000-0000000037a1'),
  array['profile.published', 'profile.unpublished'], 'Le retrait est journalisé aussi'
);
select tests.login('b0000000-0000-0000-0000-0000000037b2');
select is_empty(
  $$ select 1 from public.profile_public where user_id = 'a0000000-0000-0000-0000-0000000037a1' $$,
  'Retiré, le profil de A n''est plus visible de B'
);
reset role;

-- C n'a pas complété son profil : rien ne se publie.
select tests.login('c0000000-0000-0000-0000-0000000037c3');
update public.profile_public set display_name = 'Pas encore', is_public = true
  where user_id = 'c0000000-0000-0000-0000-0000000037c3';
reset role;
select is(
  (select is_public from public.profile_public where user_id = 'c0000000-0000-0000-0000-0000000037c3'), false,
  'Sans profil complété, rien ne se publie'
);

select * from finish();
rollback;
