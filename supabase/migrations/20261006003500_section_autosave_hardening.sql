-- =============================================================================
-- D-24 : corrections de la revue de sécurité de l'enregistrement automatique
-- =============================================================================
--   - la clé du compteur par compte est une empreinte, comme toutes les clés de
--     la table : celle-ci ne dit plus qui a rédigé, ni quand ;
--   - les compteurs de plus d'un jour sont effacés par la purge nocturne ;
--   - `update_thesis_section` prend ses verrous dans le même ordre que l'ajout
--     d'une section (compte, puis projet) : plus d'interblocage entre un
--     enregistrement automatique et un ajout fait dans un autre onglet ;
--   - la forme de la requête est contrôlée entièrement avant le décompte.
--
-- La limite compte les enregistrements aboutis : un refus (conflit, plafond de
-- texte) annule son propre décompte. Ces refus n'écrivent rien.
--
-- Réversibilité : rétablir les fonctions des migrations 003300 et 003400.
-- =============================================================================

create or replace function private.consume_user_quota(p_action text, p_limit integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_window timestamptz;
  v_hits integer;
begin
  if v_uid is null then
    perform private.fail('forbidden', '42501');
  end if;
  if p_action is null or p_action !~ '^[a-z-]{3,40}$'
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    perform private.fail('invalid_payload', '22023');
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  -- Empreinte : la table ne porte aucun identifiant de compte lisible.
  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (
    p_action || ':user:' || left(encode(sha256(convert_to(p_action || ':' || v_uid::text, 'UTF8')), 'hex'), 40),
    v_window, 1
  )
  on conflict (bucket_key, window_start)
  do update set hits = b.hits + 1
  returning b.hits into v_hits;

  if v_hits > p_limit then
    perform private.fail('rate_limited');
  end if;
end
$$;

-- Les compteurs écrits sous l'ancienne clé, en clair, sont retirés.
delete from private.rate_limit_buckets where bucket_key ~ '^section-save:user:[0-9a-f]{8}-';

create or replace function private.update_thesis_section(p_section_id uuid, p jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expected text;
  v_updated_at timestamptz;
  v_body text;
begin
  -- Même ordre de verrous que l'ajout d'une section : le compte, puis le projet.
  if v_uid is not null then
    perform pg_advisory_xact_lock(hashtextextended('section_quota:' || v_uid::text, 0));
  end if;
  perform private.require_own_section(p_section_id);

  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'level' and coalesce(p ->> 'level', '') !~ '^[1-3]$' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_expected := p ->> 'expected_updated_at';
  if v_expected is not null
     and v_expected !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Deux cents enregistrements par dix minutes et par compte, toutes sections
  -- confondues : l'enregistrement automatique en fait au plus soixante.
  perform private.consume_user_quota('section-save', 200, 600);

  if v_expected is not null then
    select s.updated_at into v_updated_at from public.thesis_sections s where s.id = p_section_id;
    if v_expected::timestamptz is distinct from v_updated_at then
      perform private.fail('conflict', '40001');
    end if;
  end if;

  if p ? 'body' then
    -- Sauts de ligne simples ; espaces de début et de fin retirés, paragraphes conservés.
    v_body := nullif(btrim(
      replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
      E' \t\n'), '');

    -- Texte total du compte, projets supprimés compris : trois millions de
    -- caractères, soit plus de mille pages.
    if coalesce(char_length(v_body), 0) + coalesce((
      select sum(char_length(s.body))
      from public.thesis_sections s
      join public.research_projects r on r.id = s.project_id
      where r.owner_id = v_uid and s.id <> p_section_id
    ), 0) > 3000000 then
      perform private.fail('limit_reached');
    end if;
  end if;

  update public.thesis_sections s
  set title = case when p ? 'title' then coalesce(private.clean_line(p ->> 'title'), '') else s.title end,
      level = case when p ? 'level' then (p ->> 'level')::smallint else s.level end,
      body = case when p ? 'body' then v_body else s.body end
  where s.id = p_section_id
  returning s.updated_at into v_updated_at;

  return v_updated_at;
end
$$;

create or replace function private.run_scheduled_purges()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projects integer;
  v_accounts integer;
begin
  -- Tâche planifiée ou maintenance seulement : jamais par l'API, quel que soit le rôle.
  if session_user <> 'postgres' then
    perform private.fail('forbidden', '42501');
  end if;

  -- Projets supprimés depuis plus de trente jours ; sources, fiches de lecture,
  -- sections et citations partent en cascade.
  delete from public.research_projects r
  where r.deleted_at is not null and r.deleted_at < now() - interval '30 days';
  get diagnostics v_projects = row_count;

  -- Comptes jamais confirmés, jamais connectés, créés il y a plus de sept jours.
  -- Un compte qui détiendrait un rôle ou serait suspendu n'est pas touché : ce
  -- serait une anomalie à examiner, pas à effacer. Un courriel envoyé dans
  -- l'heure retient le compte : son lien est peut-être encore valable. La
  -- fenêtre est courte, pour que redemander un envoi ne retienne pas la ligne.
  perform set_config('eduscholar.scheduled_purge', 'on', true);
  delete from auth.users u
  where u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.last_sign_in_at is null
    and u.created_at < now() - interval '7 days'
    and coalesce(u.confirmation_sent_at, u.created_at) < now() - interval '1 hour'
    and coalesce(u.recovery_sent_at, u.created_at) < now() - interval '1 hour'
    and not coalesce(u.is_sso_user, false)
    and not exists (select 1 from public.platform_roles r where r.user_id = u.id)
    and not exists (select 1 from public.organization_members m where m.user_id = u.id)
    and not exists (select 1 from private.account_status s where s.user_id = u.id);
  get diagnostics v_accounts = row_count;
  perform set_config('eduscholar.scheduled_purge', 'off', true);

  -- Compteurs de débit : aucune fenêtre ne dépasse un jour.
  delete from private.rate_limit_buckets b where b.window_start < now() - interval '2 days';

  -- Une ligne d'audit par passage qui a effacé quelque chose : des nombres,
  -- aucun identifiant. C'est la seule trace de la purge au journal.
  if v_projects > 0 or v_accounts > 0 then
    perform private.write_audit(
      'platform', 'retention.purged', null, null, null, 'retention', 'scheduled',
      jsonb_build_object('deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts)
    );
  end if;

  return jsonb_build_object('deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts);
end
$$;
