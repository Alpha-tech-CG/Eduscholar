-- Limitation de débit (modèle de menaces M-01, M-35).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

-- Un visiteur ou un utilisateur ne peut ni consommer ni lire les compteurs :
-- sinon il pourrait bloquer la connexion d'un tiers ou sonder son activité.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select public.consume_rate_limit('sign-in:ip:test-anon', 5, 60) $$,
  '42501', null, 'anon n''appelle pas la limitation de débit'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.consume_rate_limit('sign-in:ip:test-user', 5, 60) $$,
  '42501', null, 'Un utilisateur n''appelle pas la limitation de débit'
);
select throws_ok(
  $$ select * from private.rate_limit_buckets $$,
  '42501', null, 'Un utilisateur ne lit pas les compteurs'
);
reset role;

-- Opération serveur.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select ok(public.consume_rate_limit('test:cle-un', 3, 3600), 'Première tentative autorisée');
select ok(public.consume_rate_limit('test:cle-un', 3, 3600), 'Deuxième tentative autorisée');
select ok(public.consume_rate_limit('test:cle-un', 3, 3600), 'Troisième tentative autorisée');
select ok(not public.consume_rate_limit('test:cle-un', 3, 3600), 'Quatrième tentative refusée');
select ok(not public.consume_rate_limit('test:cle-un', 3, 3600), 'Les tentatives suivantes restent refusées');
select ok(public.consume_rate_limit('test:cle-deux', 3, 3600), 'Une autre clé a son propre compteur');

select throws_ok(
  $$ select public.consume_rate_limit('court', 3, 60) $$,
  '22023', null, 'Une clé trop courte est refusée'
);
select throws_ok(
  $$ select public.consume_rate_limit('test:cle-trois', 0, 60) $$,
  '22023', null, 'Une limite nulle est refusée'
);
select throws_ok(
  $$ select public.consume_rate_limit('test:cle-trois', 3, 0) $$,
  '22023', null, 'Une fenêtre nulle est refusée'
);
select throws_ok(
  $$ select public.consume_rate_limit('test:cle-trois', 3, 90000) $$,
  '22023', null, 'Une fenêtre de plus d''un jour est refusée'
);

reset role;

select is(
  (select hits from private.rate_limit_buckets where bucket_key = 'test:cle-un'),
  5, 'Chaque tentative est comptée, y compris celles refusées'
);

select * from finish();
rollback;
