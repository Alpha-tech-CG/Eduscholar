-- =============================================================================
-- E-05 (suite) : corrections de la revue de sécurité des courriels de notification
-- =============================================================================
--   - les deux fonctions appelées sous le rôle de service laissent une trace :
--     un envoi (le nombre de personnes prévenues, rien d'autre) et un
--     désabonnement par lien, que le titulaire lit parmi ses événements ;
--   - un compte banni ou supprimé auprès du service d'authentification ne
--     reçoit pas de courriel ;
--   - seules comptent les notifications arrivées après le dernier courriel ou
--     après le dernier réglage : activer le courriel ne prévient pas de ce qui
--     attendait déjà ;
--   - une tâche n'est marquée comme rappelée que si son propriétaire a bien un
--     rappel à lire : un rappel qui n'a pas pu s'écrire est retenté le
--     lendemain.
--
-- Accepté : le jeton de désabonnement reste le même d'un courriel à l'autre
-- tant qu'il n'a pas servi. Le renouveler à chaque envoi rendrait muet le lien
-- d'un courriel plus ancien, qui répondrait pourtant « c'est fait ».
--
-- Réversibilité : rétablir les fonctions de la migration 005900 et
-- `private.my_account_events` de la migration 005700.
-- =============================================================================

drop function public.claim_notification_digests(integer);
drop function private.claim_notification_digests(integer);

create function private.claim_notification_digests(p_limit integer)
returns table (email text, unsubscribe_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  return query
  with due as (
    select p.user_id
    from public.notification_preferences p
    join auth.users u on u.id = p.user_id
    where p.email_digest
      and u.email is not null and u.email_confirmed_at is not null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and (p.last_emailed_at is null or p.last_emailed_at < now() - interval '20 hours')
      and not exists (
        select 1 from private.account_status s
        where s.user_id = p.user_id and s.status <> 'active'
      )
      and exists (
        select 1 from public.notifications n
        where n.user_id = p.user_id and n.read_at is null
          and n.created_at > greatest(p.last_emailed_at, p.updated_at)
          and private.notification_visible_to(p.user_id, n.project_id, n.section_id)
      )
    order by p.last_emailed_at nulls first, p.user_id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update of p skip locked
  )
  update public.notification_preferences p
  set last_emailed_at = now()
  from due
  join auth.users u on u.id = due.user_id
  where p.user_id = due.user_id
  returning u.email::text, p.unsubscribe_token;

  get diagnostics v_count = row_count;
  if v_count > 0 then
    -- Le nombre seulement : ni adresse, ni jeton, ni personne.
    perform private.write_audit(
      'platform', 'notifications.digest_claimed', null, null, null, null, null,
      jsonb_build_object('count', v_count)
    );
  end if;
end
$$;

create function public.claim_notification_digests(p_limit integer)
returns table (email text, unsubscribe_token text)
language sql security invoker set search_path = ''
as $$ select * from private.claim_notification_digests(p_limit); $$;

revoke all on function private.claim_notification_digests(integer) from public, anon, authenticated;
revoke all on function public.claim_notification_digests(integer) from public, anon, authenticated;
grant execute on function private.claim_notification_digests(integer) to service_role;
grant execute on function public.claim_notification_digests(integer) to service_role;

-- Un réglage ne change `updated_at` que s'il change le choix : répéter
-- « activer » ne repousse pas le point à partir duquel on est prévenu.
create or replace function private.set_notification_preferences(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_enabled boolean;
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  if p is null or jsonb_typeof(p -> 'email_digest') is distinct from 'boolean' then
    perform private.fail('invalid_payload', '22023');
  end if;
  perform private.consume_user_quota('notification-preferences', 20, 3600);
  v_enabled := (p ->> 'email_digest')::boolean;

  -- Activer repart d'un jeton neuf : un ancien courriel ne désabonne plus.
  insert into public.notification_preferences as q (user_id, email_digest, unsubscribe_token)
  values (v_uid, v_enabled, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (user_id) do update
  set email_digest = excluded.email_digest,
      unsubscribe_token = case
        when excluded.email_digest and not q.email_digest then excluded.unsubscribe_token
        else q.unsubscribe_token
      end,
      updated_at = now()
  where q.email_digest is distinct from excluded.email_digest;
end
$$;

create or replace function private.unsubscribe_notifications(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  update public.notification_preferences p
  set email_digest = false,
      unsubscribe_token = encode(extensions.gen_random_bytes(32), 'hex'),
      updated_at = now()
  where p.unsubscribe_token = p_token
  returning p.user_id into v_user;
  if v_user is not null then
    -- Le titulaire le lit parmi les événements de son compte.
    perform private.write_audit(
      'security', 'notifications.unsubscribed_by_link', null, v_user, null,
      'notification_preferences', v_user::text, '{}'::jsonb
    );
  end if;
end
$$;

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
      'second_factor.recovery_codes_discarded',
      'project.shared',
      'project.unshared',
      'project.scope_changed',
      'project.version_erased',
      'notifications.unsubscribed_by_link'
    )
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;

create or replace function private.notify_due_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
  v_member uuid;
  v_count integer := 0;
begin
  if session_user <> 'postgres' then
    perform private.fail('forbidden', '42501');
  end if;
  for v_task in
    select t.id, t.project_id, t.due_date, r.owner_id
    from public.project_tasks t
    join public.research_projects r on r.id = t.project_id
    where t.done_at is null and r.deleted_at is null
      and t.due_date between current_date and current_date + 2
      and t.reminded_for is distinct from t.due_date
    order by t.due_date, t.id
    limit 5000
  loop
    perform private.notify(v_task.owner_id, null, 'task_due', v_task.project_id);
    for v_member in
      select m.user_id from public.research_project_members m
      where m.project_id = v_task.project_id and m.role = 'supervisor' and m.full_access
    loop
      perform private.notify(v_member, null, 'task_due', v_task.project_id);
    end loop;
    -- Un rappel non lu vaut pour toutes les tâches proches du projet. S'il n'a
    -- pas pu s'écrire (trop de notifications non lues), on réessaiera demain.
    if exists (
      select 1 from public.notifications n
      where n.user_id = v_task.owner_id and n.project_id = v_task.project_id
        and n.kind = 'task_due' and n.read_at is null
    ) then
      update public.project_tasks t set reminded_for = v_task.due_date where t.id = v_task.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$$;
