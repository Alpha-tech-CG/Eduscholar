-- =============================================================================
-- D-03 : durée de conservation du journal d'audit
-- =============================================================================
-- Le journal est en ajout seul, et rien ne l'effaçait jamais. La durée de
-- conservation est une décision juridique qui n'est pas encore prise
-- (`docs/product/privacy-policy-draft.md`) : le mécanisme est posé ici, sans
-- durée. Tant que le réglage est vide, rien n'est effacé.
--
-- Le réglage se pose en base, par le propriétaire, hors de l'application :
--
--   update private.platform_settings
--   set value = '12'::jsonb where key = 'audit_retention_months';
--
-- La purge nocturne efface alors les lignes plus anciennes. Elle seule le
-- peut : le journal reste en ajout seul pour tous les rôles, propriétaire
-- compris hors de cette purge.
--
-- Le partitionnement par mois est remis à plus tard : mesuré sur un million de
-- lignes, la lecture de ses propres événements par un utilisateur prend un
-- quart de seconde (`docs/architecture/database.md`). À reprendre au-delà de
-- cinq millions de lignes.
--
-- Réversibilité : rétablir `reject_audit_change` (migration 000100) et
-- `run_scheduled_purges` (003500), puis supprimer la table des réglages.
-- =============================================================================

create table private.platform_settings (
  key text primary key
    constraint platform_settings_key_check check (key ~ '^[a-z][a-z0-9_]{2,59}$'),
  value jsonb,
  updated_at timestamptz not null default now()
);
comment on table private.platform_settings is
  'Réglages de la plateforme posés par son propriétaire, hors application. Aucun accès par l''API.';

alter table private.platform_settings enable row level security;
alter table private.platform_settings force row level security;
revoke all on private.platform_settings from public, anon, authenticated, service_role;

-- Nombre de mois de conservation du journal d'audit ; vide : rien n'est effacé.
insert into private.platform_settings (key, value) values ('audit_retention_months', null);

-- Le journal reste en ajout seul. Seule la purge planifiée, dans une session
-- du propriétaire et sous son marqueur, peut en effacer des lignes.
create or replace function private.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and session_user = 'postgres'
     and coalesce(current_setting('eduscholar.scheduled_purge', true), '') = 'audit' then
    return old;
  end if;
  raise exception 'Le journal d''audit est en ajout seul.' using errcode = '42501';
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

  -- Journal d'audit : seulement si une durée de conservation a été posée, et
  -- seulement entre six mois et dix ans — un réglage hors de ces bornes
  -- n'efface rien.
  select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric::integer end
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
      )
    );
  end if;

  return jsonb_build_object(
    'deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts, 'audit_rows', v_audit
  );
end
$$;
