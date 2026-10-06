-- Index plein texte du catalogue (B-16).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rech-a@test.invalid');

insert into public.resources
  (id, type_code, title, abstract, authors, institution_name, tags, language_code, program_code,
   source_kind, source_name, official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('5e000000-0000-0000-0000-000000000001', 'article', 'Sécurité des réseaux zzrecherche', 'Étude des pare-feu.',
   array['Awa Diop'], 'Université de test', array['cryptographie'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/s1', 'open_access', 'published', now(), now()),
  ('5e000000-0000-0000-0000-000000000002', 'article', 'Brouillon zzrecherche', null,
   array['Awa Diop'], null, '{}', 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/s2', 'open_access', 'pending', null, null);

select isnt(
  (select search_vector from public.resources where id = '5e000000-0000-0000-0000-000000000001'),
  null, 'L''index est rempli à la création'
);
select ok(
  (select search_vector @@ to_tsquery('simple', 'securite:* & reseau:*')
   from public.resources where id = '5e000000-0000-0000-0000-000000000001'),
  'Le titre se cherche sans accents et par début de mot'
);
select ok(
  (select search_vector @@ to_tsquery('simple', 'diop:*') and search_vector @@ to_tsquery('simple', 'cryptographie:*')
          and search_vector @@ to_tsquery('simple', 'universite:*') and search_vector @@ to_tsquery('simple', 'pare:*')
   from public.resources where id = '5e000000-0000-0000-0000-000000000001'),
  'Auteurs, mots-clés, institution et résumé sont indexés'
);
select ok(
  (select not (search_vector @@ to_tsquery('simple', 'exemple:*'))
   from public.resources where id = '5e000000-0000-0000-0000-000000000001'),
  'Le lien officiel n''est pas indexé'
);

-- Nombres signés, mots composés, versions : chaque partie se cherche seule.
update public.resources set title = 'Pare-feu v2.1 lot 1791308603856-223772 zzrecherche l''état'
  where id = '5e000000-0000-0000-0000-000000000001';
select ok(
  (select search_vector @@ to_tsquery('simple', 'feu:* & 223772:* & 1791308603856:* & 2:* & 1:* & etat:* & pare:*')
   from public.resources where id = '5e000000-0000-0000-0000-000000000001'),
  'Les parties d''un mot composé, d''un nombre signé ou d''une version se cherchent une à une'
);

-- L'index suit les modifications.
update public.resources set title = 'Compilation zzrecherche' where id = '5e000000-0000-0000-0000-000000000001';
select ok(
  (select search_vector @@ to_tsquery('simple', 'compilation:*') and not (search_vector @@ to_tsquery('simple', 'securite:*'))
   from public.resources where id = '5e000000-0000-0000-0000-000000000001'),
  'L''index est recalculé quand le titre change'
);

-- Une valeur fournie est écrasée : l'index ne se falsifie pas.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into public.resources
  (id, type_code, title, authors, language_code, program_code, source_kind, source_name, source_identifier,
   official_url, search_vector)
values
  ('5e000000-0000-0000-0000-000000000003', 'article', 'Titre réel zzrecherche', array['Auteur Test'], 'fr',
   'computer_science', 'connector', 'test', 'S3', 'https://exemple.invalid/s3', to_tsvector('simple', 'motfalsifie'));
reset role;
select set_config('request.jwt.claims', '', true);
select ok(
  (select not (search_vector @@ to_tsquery('simple', 'motfalsifie')) and search_vector @@ to_tsquery('simple', 'reel')
   from public.resources where id = '5e000000-0000-0000-0000-000000000003'),
  'Un index fourni à l''insertion est remplacé par celui du contenu'
);

-- Sous la session d'un utilisateur : la recherche ne voit que ce que la RLS montre.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000005e1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select results_eq(
  $$ select id from public.resources where search_vector @@ to_tsquery('simple', 'zzrecherche:*') $$,
  $$ values ('5e000000-0000-0000-0000-000000000001'::uuid) $$,
  'Un utilisateur ne trouve que les fiches publiées'
);
select throws_ok(
  $$ update public.resources set search_vector = to_tsvector('simple', 'x') $$,
  '42501', null, 'Un utilisateur n''écrit pas l''index'
);
select throws_ok(
  $$ select private.resource_search_vector('a', '{}', '{}', null, null) $$,
  '42501', null, 'La fonction de calcul n''est pas appelable par un utilisateur'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select 1 from public.resources where search_vector @@ to_tsquery('simple', 'zzrecherche:*') $$,
  '42501', null, 'Un visiteur ne cherche pas dans le catalogue par l''API'
);
reset role;

select * from finish();
rollback;
