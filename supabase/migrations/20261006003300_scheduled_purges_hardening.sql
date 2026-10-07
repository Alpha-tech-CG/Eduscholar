-- =============================================================================
-- D-12, D-23 : corrections de la revue de sécurité des purges planifiées
-- =============================================================================
--   - la purge d'un compte jamais confirmé écrivait, par le déclencheur du
--     profil, une ligne d'audit `account.deleted` portant son identifiant : le
--     journal, en ajout seul, grossissait d'une ligne par inscription
--     abandonnée, à la main de n'importe quel tiers. La purge n'écrit plus que
--     sa ligne de nombres ;
--   - un compte suspendu n'est pas effacé : sa suspension partirait avec lui ;
--   - un compte à qui un courriel vient d'être envoyé n'est pas effacé : son
--     lien, encore valable, ne mènerait plus à rien ;
--   - la migration échoue si la tâche n'appartient pas au propriétaire de la
--     base : la fonction la refuserait chaque nuit, sans bruit.
--
-- Réversibilité : rétablir les deux fonctions des migrations 000800 et 003200.
-- =============================================================================

create or replace function private.audit_account_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Purge planifiée : le passage est inscrit une fois, en nombres. Le marqueur
  -- seul ne suffit pas : il ne vaut que dans une session du propriétaire.
  if session_user = 'postgres'
     and coalesce(current_setting('eduscholar.scheduled_purge', true), '') = 'on' then
    return old;
  end if;

  perform private.write_audit(
    'security', 'account.deleted', null, old.user_id, null,
    'profiles', old.user_id::text, '{}'::jsonb
  );
  return old;
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

-- La tâche doit appartenir au propriétaire de la base, sans quoi la fonction
-- la refuse à chaque passage.
do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-purges' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-purges doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
