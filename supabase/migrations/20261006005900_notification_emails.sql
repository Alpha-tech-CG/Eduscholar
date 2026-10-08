-- =============================================================================
-- E-05 (suite) : courriel des notifications et rappel d'échéance (cahier §6.12)
-- =============================================================================
-- Deux compléments aux notifications internes :
--
--   - qui le demande reçoit un courriel quand de nouvelles notifications
--     l'attendent. Le choix est désactivé par défaut ; au plus un courriel par
--     vingt heures ; le message ne dit rien du projet. Chaque courriel porte un
--     lien de désabonnement qui vaut sans connexion ;
--   - une tâche non faite dont l'échéance tombe sous deux jours est rappelée,
--     une fois, au propriétaire et aux encadreurs à accès complet.
--
-- La base ne sait pas envoyer de courriel : le serveur de l'application
-- demande, sous le rôle de service, la liste des personnes à prévenir. La
-- fonction les marque comme prévenues dans la même requête : deux appels
-- simultanés ne préviennent pas deux fois.
--
-- Le jeton de désabonnement est gardé en clair : il doit figurer dans chaque
-- courriel. Il ne permet qu'une chose, couper ces courriels, et il est
-- remplacé à chaque usage et à chaque réactivation. La table n'est lisible par
-- aucun rôle de l'API.
--
-- Réversibilité : supprimer les tâches planifiées, les fonctions, la colonne
-- `project_tasks.reminded_for`, puis la table ; rétablir la contrainte et
-- `private.can_see_notification` de la migration 005600.
-- =============================================================================

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_digest boolean not null default false,
  unsubscribe_token text not null
    constraint notification_preferences_token_check check (unsubscribe_token ~ '^[0-9a-f]{64}$'),
  last_emailed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint notification_preferences_token_key unique (unsubscribe_token)
);
comment on table public.notification_preferences is
  'Choix de recevoir un courriel des notifications. Lu et écrit par fonctions seulement.';

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
revoke all on public.notification_preferences from public, anon, authenticated, service_role;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment', 'reply', 'version_submitted', 'version_decided', 'task_added',
                  'access_requested', 'task_due'));

-- -----------------------------------------------------------------------------
-- Ce qu'une personne peut voir d'une notification : une seule règle
-- -----------------------------------------------------------------------------
create function private.notification_visible_to(p_user_id uuid, p_project_id uuid, p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.research_projects r
    left join public.research_project_members m
      on m.project_id = r.id and m.user_id = p_user_id
    where r.id = p_project_id and r.deleted_at is null
      and (
        r.owner_id = p_user_id
        or m.full_access
        or (m.user_id is not null and p_section_id is not null and exists (
          select 1 from public.research_project_member_sections x
          where x.project_id = r.id and x.user_id = m.user_id and x.section_id = p_section_id
        ))
      )
  );
$$;

revoke all on function private.notification_visible_to(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.can_see_notification(p_project_id uuid, p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.notification_visible_to((select auth.uid()), p_project_id, p_section_id);
$$;

-- -----------------------------------------------------------------------------
-- Le titulaire : lire et fixer son choix
-- -----------------------------------------------------------------------------
create function private.my_notification_preferences()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active() and coalesce((
    select p.email_digest from public.notification_preferences p
    where p.user_id = (select auth.uid())
  ), false);
$$;

create function private.set_notification_preferences(p jsonb)
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
      updated_at = now();
end
$$;

-- -----------------------------------------------------------------------------
-- Le serveur de l'application, sous le rôle de service
-- -----------------------------------------------------------------------------
-- Rend les personnes à prévenir, et les marque comme prévenues. Sont exclus :
-- un compte suspendu, une adresse non confirmée, qui a été prévenu depuis moins
-- de vingt heures, et qui n'a rien de nouveau qu'il puisse encore voir.
create function private.claim_notification_digests(p_limit integer)
returns table (email text, unsubscribe_token text)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select p.user_id
    from public.notification_preferences p
    join auth.users u on u.id = p.user_id
    where p.email_digest
      and u.email is not null and u.email_confirmed_at is not null
      and (p.last_emailed_at is null or p.last_emailed_at < now() - interval '20 hours')
      and not exists (
        select 1 from private.account_status s
        where s.user_id = p.user_id and s.status = 'suspended'
      )
      and exists (
        select 1 from public.notifications n
        where n.user_id = p.user_id and n.read_at is null
          and n.created_at > coalesce(p.last_emailed_at, '-infinity'::timestamptz)
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
$$;

-- Désabonne qui présente le jeton d'un courriel. Jeton inconnu, déjà utilisé ou
-- mal formé : rien ne se passe, et rien ne le dit.
create function private.unsubscribe_notifications(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  update public.notification_preferences p
  set email_digest = false,
      unsubscribe_token = encode(extensions.gen_random_bytes(32), 'hex'),
      updated_at = now()
  where p.unsubscribe_token = p_token;
end
$$;

create function public.my_notification_preferences() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.my_notification_preferences(); $$;

create function public.set_notification_preferences(payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.set_notification_preferences(payload); $$;

create function public.claim_notification_digests(p_limit integer)
returns table (email text, unsubscribe_token text)
language sql security invoker set search_path = ''
as $$ select * from private.claim_notification_digests(p_limit); $$;

create function public.unsubscribe_notifications(p_token text) returns void
language sql security invoker set search_path = ''
as $$ select private.unsubscribe_notifications(p_token); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'my_notification_preferences()', 'set_notification_preferences(jsonb)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
  foreach v_signature in array array[
    'claim_notification_digests(integer)', 'unsubscribe_notifications(text)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, authenticated', v_signature);
    execute format('revoke all on function public.%s from public, anon, authenticated', v_signature);
    execute format('grant execute on function private.%s to service_role', v_signature);
    execute format('grant execute on function public.%s to service_role', v_signature);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Rappel d'échéance
-- -----------------------------------------------------------------------------
-- Échéance pour laquelle la tâche a déjà été rappelée : la déplacer la rappelle
-- de nouveau, la laisser ne la rappelle qu'une fois.
alter table public.project_tasks add column reminded_for date;

create function private.notify_due_tasks()
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
    update public.project_tasks t set reminded_for = v_task.due_date where t.id = v_task.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke all on function private.notify_due_tasks() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-task-reminders';
select cron.schedule('eduscholar-task-reminders', '7 5 * * *', 'select private.notify_due_tasks()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-task-reminders' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-task-reminders doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
