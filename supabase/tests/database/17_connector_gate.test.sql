-- Égards dus aux sources : pause demandée et plafond journalier (D-20).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

-- Qui peut appeler.
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, 'public.connector_gate(text, integer)', 'execute')
      or has_function_privilege(r, 'public.connector_pause(text, integer)', 'execute')),
  0::bigint, 'Ni visiteur ni utilisateur n''agissent sur les pauses des sources'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'private.connector_pauses', 'select')
      or has_table_privilege(r, 'private.connector_pauses', 'insert')),
  0::bigint, 'La table n''est lue ni écrite directement par aucun rôle de l''API'
);

set local role service_role;

-- Plafond journalier.
select is(public.connector_gate('source-test', 2), 'ok', 'Première requête du jour : acceptée');
select is(public.connector_gate('source-test', 2), 'ok', 'Deuxième : acceptée');
select is(public.connector_gate('source-test', 2), 'daily_limit', 'Au-delà du plafond : refusée');
select is(public.connector_gate('autre-source', 2), 'ok', 'Le plafond est tenu par source');

-- Pause demandée.
select lives_ok($$ select public.connector_pause('autre-source', 120) $$, 'Une pause est posée');
select is(public.connector_gate('autre-source', 2), 'paused', 'Pendant la pause, la source n''est pas sollicitée');
select is(public.connector_gate('source-neuve', 5), 'ok', 'La pause d''une source ne touche pas les autres');

-- Entrées refusées.
select throws_ok($$ select public.connector_gate('Source Invalide', 2) $$, '22023', null, 'Nom de source invalide : refusé');
select throws_ok($$ select public.connector_gate('source-test', 0) $$, '22023', null, 'Plafond nul : refusé');
select throws_ok($$ select public.connector_pause(null, 60) $$, '22023', null, 'Pause sans source : refusée');
reset role;

-- Une requête refusée pendant la pause n'est pas comptée dans le plafond.
select is(
  (select hits from private.rate_limit_buckets where bucket_key = 'connector:day:autre-source'),
  1, 'Une requête retenue par la pause ne consomme pas le plafond'
);

-- Bornes de la pause : une minute au moins, une heure au plus ; jamais raccourcie.
select cmp_ok(
  (select paused_until from private.connector_pauses where source_name = 'autre-source'),
  '>', now() + interval '110 seconds', 'La pause demandée est tenue'
);
set local role service_role;
select public.connector_pause('autre-source', 1);
reset role;
select cmp_ok(
  (select paused_until from private.connector_pauses where source_name = 'autre-source'),
  '>', now() + interval '110 seconds', 'Une pause plus courte ne raccourcit pas celle en cours'
);
set local role service_role;
select public.connector_pause('autre-source', 999999);
select public.connector_pause('source-courte', 1);
reset role;
select cmp_ok(
  (select paused_until from private.connector_pauses where source_name = 'autre-source'),
  '<=', now() + interval '1 hour', 'Une heure au plus'
);
select cmp_ok(
  (select paused_until from private.connector_pauses where source_name = 'source-courte'),
  '>=', now() + interval '59 seconds', 'Une minute au moins'
);

-- La pause passée, la source est de nouveau sollicitée.
update private.connector_pauses set paused_until = now() - interval '1 second' where source_name = 'autre-source';
set local role service_role;
select is(public.connector_gate('autre-source', 5), 'ok', 'La pause écoulée, les requêtes reprennent');
reset role;

select * from finish();
rollback;
