-- =============================================================================
-- B-10 — Limitation de débit des opérations d'authentification
--
-- Références : modèle de menaces M-01, M-35 ; authorization-model §7.1 (limites
-- imposées côté base) et §7.5 (opérations service_role).
--
-- L'application appelle Supabase Auth depuis le serveur : les limites par
-- adresse IP de Supabase voient donc l'adresse du serveur, pas celle du
-- visiteur. Cette table compte les tentatives par clé (action + empreinte de
-- l'adresse IP ou de l'adresse électronique), sans stocker de donnée lisible.
--
-- Réversibilité : supprimer la fonction public.consume_rate_limit puis la
-- table private.rate_limit_buckets.
-- =============================================================================

create table private.rate_limit_buckets (
  bucket_key text not null
    constraint rate_limit_buckets_key_check check (char_length(bucket_key) between 8 and 200),
  window_start timestamptz not null,
  hits integer not null default 1
    constraint rate_limit_buckets_hits_check check (hits >= 1),
  primary key (bucket_key, window_start)
);
comment on table private.rate_limit_buckets is
  'Compteurs de tentatives par fenêtre fixe. Les clés sont des empreintes, jamais une adresse en clair.';

create index rate_limit_buckets_window_start_idx
  on private.rate_limit_buckets (window_start);

alter table private.rate_limit_buckets enable row level security;
alter table private.rate_limit_buckets force row level security;

revoke all on private.rate_limit_buckets from anon, authenticated, service_role;
grant select, insert, update, delete on private.rate_limit_buckets to service_role;

-- Consomme une tentative et dit si elle est autorisée.
-- SECURITY INVOKER : seule une opération serveur (service_role) peut l'appeler,
-- avec ses propres droits sur la table.
create function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_key is null or char_length(p_key) not between 8 and 200 then
    raise exception 'Clé de limitation invalide.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'Limite invalide.' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Fenêtre invalide.' using errcode = '22023';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set hits = b.hits + 1
  returning b.hits into v_hits;

  -- Purge opportuniste des fenêtres échues, pour que la table reste petite.
  if random() < 0.02 then
    delete from private.rate_limit_buckets
    where window_start < clock_timestamp() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
