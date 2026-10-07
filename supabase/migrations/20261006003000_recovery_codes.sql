-- =============================================================================
-- D-17 : codes de secours de la validation en deux étapes
-- =============================================================================
-- Qui perd son application d'authentification restait bloqué hors de son compte.
-- Dix codes à usage unique, remis une seule fois, permettent de lever la
-- validation en deux étapes : le compte revient à la connexion par mot de
-- passe, et son titulaire en réactive une nouvelle.
--
--   - seule l'empreinte des codes est conservée ;
--   - les générer exige une session au second facteur présenté récemment ;
--   - en utiliser un se fait dans la session ouverte par le mot de passe, avec
--     cinq essais par quart d'heure et par compte, comptés en base ;
--   - chaque génération et chaque usage est inscrit au journal de sécurité.
--
-- Un compte à rôle privilégié qui utilise un code de secours perd l'effet de
-- son rôle : celui-ci exige un second facteur antérieur à son attribution. Un
-- administrateur le lui réattribue après réactivation.
--
-- Réversibilité : supprimer les fonctions et les deux tables.
-- =============================================================================

create table private.second_factor_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Empreinte SHA-256 du code, liée au compte.
  code_hash text not null
    constraint second_factor_recovery_codes_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint second_factor_recovery_codes_user_hash_key unique (user_id, code_hash)
);
comment on table private.second_factor_recovery_codes is
  'Codes de secours du second facteur : empreintes seulement. Aucun accès utilisateur.';

create table private.recovery_code_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  failures integer not null default 0
    constraint recovery_code_attempts_failures_check check (failures >= 0)
);
comment on table private.recovery_code_attempts is
  'Essais de code de secours erronés, par compte et par fenêtre de quinze minutes.';

alter table private.second_factor_recovery_codes enable row level security;
alter table private.second_factor_recovery_codes force row level security;
alter table private.recovery_code_attempts enable row level security;
alter table private.recovery_code_attempts force row level security;
revoke all on private.second_factor_recovery_codes, private.recovery_code_attempts
  from public, anon, authenticated, service_role;

-- Forme canonique d'un code saisi : majuscules, lettres et chiffres seulement.
create function private.normalize_recovery_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
$$;
revoke all on function private.normalize_recovery_code(text) from public, anon, authenticated, service_role;

create function private.recovery_code_hash(p_user uuid, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_user::text || ':' || private.normalize_recovery_code(p_code), 'sha256'), 'hex');
$$;
revoke all on function private.recovery_code_hash(uuid, text) from public, anon, authenticated, service_role;

-- Nombre de codes encore utilisables par l'appelant, et date de leur génération.
create function private.recovery_codes_status()
returns table (remaining integer, generated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where c.used_at is null)::integer, max(c.created_at)
  from private.second_factor_recovery_codes c
  where c.user_id = (select auth.uid())
    and private.is_account_active();
$$;

-- Génère dix nouveaux codes et les remet, une seule fois. Les précédents sont
-- supprimés.
create function private.generate_recovery_codes()
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  -- Trente-deux signes sans ambiguïté de lecture : ni I, ni O, ni 0, ni 1.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  if v_uid is null or not private.is_account_active() or not private.has_verified_factor() then
    perform private.fail('forbidden', '42501');
  end if;
  if not private.has_recent_second_factor() then
    perform private.fail('recent_second_factor_required', '42501');
  end if;

  delete from private.second_factor_recovery_codes c where c.user_id = v_uid;
  delete from private.recovery_code_attempts a where a.user_id = v_uid;

  for v_index in 1 .. 10 loop
    -- Dix signes tirés au hasard : cinquante bits par code.
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    for v_position in 0 .. 9 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_position) % 32) + 1, 1);
    end loop;
    insert into private.second_factor_recovery_codes (user_id, code_hash)
    values (v_uid, private.recovery_code_hash(v_uid, v_code))
    on conflict do nothing;
    return next substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
  end loop;

  perform private.write_audit(
    'security', 'second_factor.recovery_codes_generated', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
  );
end
$$;

-- Supprime les codes de l'appelant : à l'activation ou à la désactivation du
-- second facteur, les codes de l'ancien ne doivent plus valoir.
create function private.discard_recovery_codes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  delete from private.second_factor_recovery_codes c where c.user_id = v_uid;
  delete from private.recovery_code_attempts a where a.user_id = v_uid;
end
$$;

-- Vérifie et consomme un code de secours. Appelée dans la session ouverte par
-- le seul mot de passe : c'est précisément le cas où le second facteur manque.
-- Vrai si le code est accepté ; l'application lève alors le second facteur.
create function private.redeem_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := private.normalize_recovery_code(p_code);
  v_attempts private.recovery_code_attempts;
  v_id uuid;
begin
  if v_uid is null
     or ((select auth.jwt()) ->> 'is_anonymous') is not distinct from 'true'
     or exists (select 1 from private.account_status s where s.user_id = v_uid and s.status = 'suspended')
     or not private.has_verified_factor() then
    perform private.fail('forbidden', '42501');
  end if;

  -- Les essais d'un même compte passent un par un.
  perform pg_advisory_xact_lock(hashtextextended('recovery_code:' || v_uid::text, 0));
  select * into v_attempts from private.recovery_code_attempts a where a.user_id = v_uid;
  if v_attempts.window_start is not null and v_attempts.window_start < now() - interval '15 minutes' then
    delete from private.recovery_code_attempts a where a.user_id = v_uid;
    v_attempts.failures := 0;
  end if;
  if coalesce(v_attempts.failures, 0) >= 5 then
    perform private.fail('rate_limited');
  end if;

  if char_length(v_code) = 10 then
    update private.second_factor_recovery_codes c
    set used_at = now()
    where c.user_id = v_uid
      and c.used_at is null
      and c.code_hash = private.recovery_code_hash(v_uid, v_code)
    returning c.id into v_id;
  end if;

  if v_id is null then
    -- L'échec est compté : la fonction rend faux au lieu de lever une erreur,
    -- pour que le compteur soit bien enregistré.
    insert into private.recovery_code_attempts (user_id, window_start, failures)
    values (v_uid, now(), 1)
    on conflict (user_id) do update set failures = private.recovery_code_attempts.failures + 1;
    return false;
  end if;

  delete from private.recovery_code_attempts a where a.user_id = v_uid;
  perform private.write_audit(
    'security', 'second_factor.recovery_code_used', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
  );
  return true;
end
$$;

create function public.recovery_codes_status()
returns table (remaining integer, generated_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.recovery_codes_status(); $$;

create function public.generate_recovery_codes() returns setof text
language sql security invoker set search_path = ''
as $$ select private.generate_recovery_codes(); $$;

create function public.discard_recovery_codes() returns void
language sql security invoker set search_path = ''
as $$ select private.discard_recovery_codes(); $$;

create function public.redeem_recovery_code(code text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.redeem_recovery_code(code); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'recovery_codes_status()',
    'generate_recovery_codes()',
    'discard_recovery_codes()',
    'redeem_recovery_code(text)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
