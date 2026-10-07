-- =============================================================================
-- Corrections de la revue de sécurité des lots D-25, D-20, D-03
-- =============================================================================
--   - `my_account_events` rend une liste fermée d'actions : elle ne dit plus au
--     titulaire qu'un administrateur a cherché son compte, et une action
--     ajoutée plus tard au journal n'y entre pas d'elle-même ;
--   - l'exception de suppression du journal ne vaut que pour `audit_logs` :
--     l'historique de modération reste en ajout seul, propriétaire compris ;
--   - le réglage de conservation est borné par contrainte, sa lecture ne peut
--     plus faire échouer la purge, et la durée appliquée est inscrite ;
--   - le plafond journalier d'une source se compte en jours UTC.
--
-- Réversibilité : rétablir les fonctions des migrations 004100, 004200, 004300
-- et retirer la contrainte.
-- =============================================================================

create or replace function private.my_account_events()
returns table (occurred_at timestamptz, category text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.occurred_at, a.category, a.action
  from public.audit_logs a
  where private.is_account_active()
    and a.subject_user_id = (select auth.uid())
    and a.action in (
      'account.data_exported',
      'account.deletion_requested',
      'account_status.insert',
      'account_status.update',
      'account_status.delete',
      'platform_roles.insert',
      'platform_roles.delete',
      'second_factor.recovery_code_used',
      'second_factor.recovery_codes_generated',
      'second_factor.recovery_codes_discarded'
    )
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;

create or replace function private.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and tg_table_schema = 'public' and tg_table_name = 'audit_logs'
     and session_user = 'postgres'
     and coalesce(current_setting('eduscholar.scheduled_purge', true), '') = 'audit' then
    return old;
  end if;
  raise exception 'Le journal d''audit est en ajout seul.' using errcode = '42501';
end
$$;

-- Durée de conservation : vide, ou un entier de 6 à 120.
alter table private.platform_settings
  add constraint platform_settings_audit_retention_check check (
    key <> 'audit_retention_months'
    or value is null
    or value = 'null'::jsonb
    or (jsonb_typeof(value) = 'number'
        and (value #>> '{}') ~ '^[0-9]{1,3}$'
        and (value #>> '{}')::integer between 6 and 120)
  );

create or replace function private.run_scheduled_purges()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projects integer;
  v_accounts integer;
  v_audit integer := 0;
  v_months integer;
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

  -- Journal d'audit : seulement si une durée de conservation a été posée. La
  -- contrainte de la table la borne ; la lecture se garde elle-même, pour
  -- qu'une valeur inattendue n'arrête jamais les autres purges.
  select case
    when jsonb_typeof(s.value) = 'number' and (s.value #>> '{}') ~ '^[0-9]{1,3}$'
      then (s.value #>> '{}')::integer
  end
  into v_months
  from private.platform_settings s where s.key = 'audit_retention_months';
  if v_months between 6 and 120 then
    perform set_config('eduscholar.scheduled_purge', 'audit', true);
    delete from public.audit_logs a where a.occurred_at < now() - make_interval(months => v_months);
    get diagnostics v_audit = row_count;
    perform set_config('eduscholar.scheduled_purge', 'off', true);
  end if;

  -- Une ligne d'audit par passage qui a effacé quelque chose : des nombres,
  -- aucun identifiant. C'est la seule trace de la purge au journal.
  if v_projects > 0 or v_accounts > 0 or v_audit > 0 then
    perform private.write_audit(
      'platform', 'retention.purged', null, null, null, 'retention', 'scheduled',
      jsonb_build_object(
        'deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts, 'audit_rows', v_audit
      ) || case when v_audit > 0 then jsonb_build_object('audit_retention_months', v_months) else '{}'::jsonb end
    );
  end if;

  return jsonb_build_object(
    'deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts, 'audit_rows', v_audit
  );
end
$$;

create or replace function private.connector_gate(p_source text, p_daily_limit integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Le jour se compte en UTC, quel que soit le fuseau de la session.
  v_day timestamptz := date_trunc('day', now(), 'UTC');
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
