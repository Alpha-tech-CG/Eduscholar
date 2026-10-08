-- =============================================================================
-- D-09 (partie) : alerte de nouvelle connexion et compteurs d'événements
-- =============================================================================
-- Deux compléments de l'authentification, tenus par l'application :
--
--   - une connexion depuis un navigateur que le compte ne connaît pas prévient
--     le titulaire par courriel. Le navigateur est reconnu à un témoin
--     aléatoire dont la base ne garde que l'empreinte : ni adresse IP, ni
--     nom d'appareil, ni lieu ;
--   - les échecs de connexion et les limites de débit atteintes sont comptés
--     par heure et par nature. Ce sont des nombres : aucune adresse, aucun
--     compte. L'administration les lit pour voir une attaque en cours.
--
-- Limite connue : une connexion faite par appel direct au service
-- d'authentification, sans passer par l'application, ne déclenche ni l'un ni
-- l'autre. Ce sont des compléments, pas une barrière.
--
-- Réversibilité : supprimer la tâche planifiée, les fonctions, puis les tables.
-- =============================================================================

create table public.known_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_hash text not null
    constraint known_devices_hash_check check (device_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_hash)
);
comment on table public.known_devices is
  'Navigateurs depuis lesquels un compte s''est déjà connecté : une empreinte et deux dates. Lu et écrit par fonctions seulement.';

alter table public.known_devices enable row level security;
alter table public.known_devices force row level security;
revoke all on public.known_devices from public, anon, authenticated, service_role;

create table private.auth_event_counters (
  hour timestamptz not null,
  kind text not null
    constraint auth_event_counters_kind_check check (kind ~ '^(failed|limited|new-device):[a-z-]{3,40}$'),
  total integer not null default 0,
  primary key (hour, kind)
);
comment on table private.auth_event_counters is
  'Échecs et limites atteintes de l''authentification, par heure et par nature. Des nombres seulement.';

alter table private.auth_event_counters enable row level security;
alter table private.auth_event_counters force row level security;
revoke all on private.auth_event_counters from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Le titulaire : enregistrer le navigateur de sa connexion
-- -----------------------------------------------------------------------------
-- Rend vrai si ce navigateur est nouveau pour un compte qui en connaissait déjà
-- d'autres : c'est le cas qui mérite un avis. La toute première connexion d'un
-- compte n'en est pas un.
--
-- La fonction s'appelle dès le mot de passe accepté, avant le second facteur :
-- que quelqu'un d'autre tienne le mot de passe est déjà ce que le titulaire
-- doit apprendre. Elle n'exige donc pas un compte « actif » au sens des autres.
create function private.register_sign_in_device(p_device_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_known integer;
begin
  if v_uid is null or ((select auth.jwt()) ->> 'is_anonymous') = 'true' then
    perform private.fail('forbidden', '42501');
  end if;
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    perform private.fail('invalid_payload', '22023');
  end if;
  perform private.consume_user_quota('sign-in-device', 30, 3600);

  update public.known_devices d set last_seen_at = now()
  where d.user_id = v_uid and d.device_hash = p_device_hash;
  if found then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('known_devices:' || v_uid::text, 0));
  select count(*) into v_known from public.known_devices d where d.user_id = v_uid;
  insert into public.known_devices (user_id, device_hash) values (v_uid, p_device_hash)
  on conflict do nothing;
  -- Vingt navigateurs au plus : les plus anciens sont oubliés.
  delete from public.known_devices d
  where d.user_id = v_uid and d.device_hash in (
    select o.device_hash from public.known_devices o
    where o.user_id = v_uid
    order by o.last_seen_at desc, o.device_hash
    offset 20
  );
  return v_known > 0;
end
$$;

-- Copie des données : les dates seulement, l'empreinte ne dit rien à personne.
create function private.my_known_devices()
returns table (first_seen_at timestamptz, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.first_seen_at, d.last_seen_at
  from public.known_devices d
  where private.is_account_active() and d.user_id = (select auth.uid())
  order by d.first_seen_at, d.device_hash;
$$;

-- -----------------------------------------------------------------------------
-- Le serveur : compter un événement
-- -----------------------------------------------------------------------------
create function private.record_auth_event(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind is null or p_kind !~ '^(failed|limited|new-device):[a-z-]{3,40}$' then
    return;
  end if;
  insert into private.auth_event_counters as c (hour, kind, total)
  values (date_trunc('hour', now()), p_kind, 1)
  on conflict (hour, kind) do update set total = c.total + 1;
end
$$;

-- -----------------------------------------------------------------------------
-- L'administration : lire les compteurs des sept derniers jours
-- -----------------------------------------------------------------------------
create function private.admin_auth_events()
returns table (day date, kind text, total bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select (c.hour at time zone 'UTC')::date, c.kind, sum(c.total)::bigint
  from private.auth_event_counters c
  where c.hour >= date_trunc('day', now()) - interval '6 days'
  group by 1, 2
  order by 1 desc, 2
  limit 500;
end
$$;

create function public.register_sign_in_device(device_hash text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.register_sign_in_device(device_hash); $$;

create function public.my_known_devices()
returns table (first_seen_at timestamptz, last_seen_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_known_devices(); $$;

create function public.record_auth_event(p_kind text) returns void
language sql security invoker set search_path = ''
as $$ select private.record_auth_event(p_kind); $$;

create function public.admin_auth_events()
returns table (day date, kind text, total bigint)
language sql security invoker set search_path = ''
as $$ select * from private.admin_auth_events(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'register_sign_in_device(text)', 'my_known_devices()', 'admin_auth_events()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
  revoke all on function private.record_auth_event(text) from public, anon, authenticated;
  revoke all on function public.record_auth_event(text) from public, anon, authenticated;
  grant execute on function private.record_auth_event(text) to service_role;
  grant execute on function public.record_auth_event(text) to service_role;
end
$$;

-- -----------------------------------------------------------------------------
-- Conservation : navigateurs non revus depuis six mois, compteurs de trois mois
-- -----------------------------------------------------------------------------
create function private.purge_auth_traces()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_devices integer;
  v_counters integer;
begin
  if session_user <> 'postgres' then
    perform private.fail('forbidden', '42501');
  end if;
  delete from public.known_devices d where d.last_seen_at < now() - interval '180 days';
  get diagnostics v_devices = row_count;
  delete from private.auth_event_counters c where c.hour < now() - interval '90 days';
  get diagnostics v_counters = row_count;
  return v_devices + v_counters;
end
$$;

revoke all on function private.purge_auth_traces() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-auth-traces-purge';
select cron.schedule('eduscholar-auth-traces-purge', '47 3 * * *', 'select private.purge_auth_traces()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-auth-traces-purge' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-auth-traces-purge doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
