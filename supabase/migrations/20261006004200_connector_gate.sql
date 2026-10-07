-- =============================================================================
-- D-20 : égards dus aux sources — pause demandée et plafond journalier
-- =============================================================================
-- Une source qui répond « trop de requêtes » fixe souvent le délai à attendre.
-- L'application le respecte désormais, pour tous ses serveurs à la fois : la
-- pause est tenue en base. Un plafond journalier par source borne en outre ce
-- que la plateforme entière lui demande, quel que soit le nombre de
-- modérateurs.
--
-- Les deux fonctions sont réservées au rôle serveur, qui les appelle juste
-- avant et juste après une requête vers la source ; elles ne lisent ni
-- n'écrivent aucune donnée d'utilisateur.
--
-- Réversibilité : supprimer les deux fonctions et la table.
-- =============================================================================

create table private.connector_pauses (
  source_name text primary key
    constraint connector_pauses_source_check check (source_name ~ '^[a-z][a-z0-9_-]{1,39}$'),
  paused_until timestamptz not null,
  updated_at timestamptz not null default now()
);
comment on table private.connector_pauses is
  'Pause demandée par une source externe (réponse 429 ou 503 avec délai). Aucune donnée d''utilisateur.';

alter table private.connector_pauses enable row level security;
alter table private.connector_pauses force row level security;
revoke all on private.connector_pauses from public, anon, authenticated, service_role;

-- Avant une requête : la source est-elle en pause, le plafond du jour est-il
-- atteint ? Sinon la requête est comptée.
create function private.connector_gate(p_source text, p_daily_limit integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day timestamptz := date_trunc('day', now());
  v_hits integer;
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9_-]{1,39}$'
     or p_daily_limit is null or p_daily_limit not between 1 and 1000000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  if exists (
    select 1 from private.connector_pauses p
    where p.source_name = p_source and p.paused_until > now()
  ) then
    return 'paused';
  end if;

  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values ('connector:day:' || p_source, v_day, 1)
  on conflict (bucket_key, window_start)
  do update set hits = b.hits + 1
  returning b.hits into v_hits;

  if v_hits > p_daily_limit then
    return 'daily_limit';
  end if;
  return 'ok';
end
$$;

-- Après une réponse « trop de requêtes » : la pause demandée, bornée entre une
-- minute et une heure. Une pause en cours n'est jamais raccourcie.
create function private.connector_pause(p_source text, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz := now() + make_interval(secs => least(greatest(coalesce(p_seconds, 300), 60), 3600));
begin
  if p_source is null or p_source !~ '^[a-z][a-z0-9_-]{1,39}$' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  insert into private.connector_pauses as p (source_name, paused_until)
  values (p_source, v_until)
  on conflict (source_name)
  do update set paused_until = greatest(p.paused_until, excluded.paused_until), updated_at = now();
end
$$;

create function public.connector_gate(p_source text, p_daily_limit integer) returns text
language sql security invoker set search_path = ''
as $$ select private.connector_gate(p_source, p_daily_limit); $$;

create function public.connector_pause(p_source text, p_seconds integer) returns void
language sql security invoker set search_path = ''
as $$ select private.connector_pause(p_source, p_seconds); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array['connector_gate(text, integer)', 'connector_pause(text, integer)'] loop
    execute format('revoke all on function private.%s from public, anon, authenticated', v_signature);
    execute format('revoke all on function public.%s from public, anon, authenticated', v_signature);
    execute format('grant execute on function private.%s to service_role', v_signature);
    execute format('grant execute on function public.%s to service_role', v_signature);
  end loop;
end
$$;
