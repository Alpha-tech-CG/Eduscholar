-- =============================================================================
-- D-12, D-23 : purges planifiées
-- =============================================================================
-- Deux durées de conservation étaient annoncées sans que rien ne les applique :
--
--   - un projet de recherche supprimé est effacé définitivement après trente
--     jours (politique de confidentialité) ;
--   - un compte dont l'adresse n'a jamais été confirmée est effacé après sept
--     jours : il retient une adresse qui n'appartient peut-être pas à qui l'a
--     saisie.
--
-- La purge est planifiée dans la base elle-même (pg_cron), chaque nuit. Elle ne
-- dépend d'aucun service extérieur et ne passe pas par l'API : la fonction
-- refuse toute session qui n'est pas celle du propriétaire de la base.
--
-- Réversibilité : retirer la tâche (`select cron.unschedule('eduscholar-purges')`)
-- et supprimer la fonction.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

create function private.run_scheduled_purges()
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
  -- Un compte qui détiendrait un rôle n'est pas touché : ce serait une anomalie
  -- à examiner, pas à effacer.
  delete from auth.users u
  where u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.last_sign_in_at is null
    and u.created_at < now() - interval '7 days'
    and not coalesce(u.is_sso_user, false)
    and not exists (select 1 from public.platform_roles r where r.user_id = u.id)
    and not exists (select 1 from public.organization_members m where m.user_id = u.id);
  get diagnostics v_accounts = row_count;

  -- Une ligne d'audit par passage qui a effacé quelque chose : des nombres,
  -- aucun identifiant.
  if v_projects > 0 or v_accounts > 0 then
    perform private.write_audit(
      'platform', 'retention.purged', null, null, null, 'retention', 'scheduled',
      jsonb_build_object('deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts)
    );
  end if;

  return jsonb_build_object('deleted_projects', v_projects, 'unconfirmed_accounts', v_accounts);
end
$$;

revoke all on function private.run_scheduled_purges() from public, anon, authenticated, service_role;

comment on function private.run_scheduled_purges() is
  'Purges de conservation : projets supprimés depuis trente jours, comptes jamais confirmés depuis sept jours. Appelée chaque nuit par pg_cron.';

-- Chaque nuit à 3 h 17 (UTC). La tâche est remplacée si elle existe déjà.
select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-purges';
select cron.schedule('eduscholar-purges', '17 3 * * *', 'select private.run_scheduled_purges()');
