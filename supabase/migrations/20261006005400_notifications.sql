-- =============================================================================
-- E-05 : notifications internes du suivi d'un projet (cahier §6.12)
-- =============================================================================
-- Quand l'encadreur commente, décide ou pose une tâche, l'étudiant en est
-- averti à sa prochaine visite ; et inversement quand l'étudiant répond, soumet
-- une version ou pose une tâche. Les notifications sont écrites par la base,
-- dans la transaction même de l'événement : aucune ne peut être fabriquée par
-- un appel, et aucune ne manque.
--
-- Une notification ne porte aucun contenu : elle dit qu'il s'est passé quelque
-- chose, et où. Ce qu'elle désigne n'est lu qu'à travers les fonctions
-- habituelles, qui revérifient les droits ; retiré d'un projet, on ne voit
-- plus les notifications qui le concernent.
--
-- Cette tranche ne comprend pas d'envoi par courriel : il demande des
-- préférences et un désabonnement, à construire d'abord.
--
-- Réversibilité : supprimer les déclencheurs, les fonctions, la tâche
-- planifiée, puis la table.
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    constraint notifications_kind_check
      check (kind in ('comment', 'reply', 'version_submitted', 'version_decided', 'task_added')),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  -- Ce que la notification désigne : simples identifiants, sans clé étrangère.
  section_id uuid,
  version_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz
);
comment on table public.notifications is
  'Notifications internes. Écrites par la base seulement ; aucun contenu, seulement ce qui s''est passé et où.';
create index notifications_user_id_idx on public.notifications (user_id, created_at desc);
create index notifications_project_id_idx on public.notifications (project_id);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on public.notifications from public, anon, authenticated, service_role;

-- Écrit une notification, sauf à l'auteur de l'événement, et sauf si le
-- destinataire en a déjà deux cents non lues : on n'inonde personne.
create function private.notify(
  p_user_id uuid, p_actor uuid, p_kind text, p_project_id uuid,
  p_section_id uuid default null, p_version_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id is not distinct from p_actor then
    return;
  end if;
  if (select count(*) from public.notifications n
      where n.user_id = p_user_id and n.read_at is null) >= 200 then
    return;
  end if;
  insert into public.notifications (user_id, kind, project_id, section_id, version_id)
  values (p_user_id, p_kind, p_project_id, p_section_id, p_version_id);
end
$$;

-- Avertit l'autre partie d'un projet : le propriétaire si un membre a agi,
-- les encadreurs à accès complet si c'est le propriétaire.
create function private.notify_counterpart(
  p_actor uuid, p_kind text, p_project_id uuid,
  p_section_id uuid default null, p_version_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_member uuid;
begin
  select r.owner_id into v_owner from public.research_projects r where r.id = p_project_id;
  if p_actor is distinct from v_owner then
    perform private.notify(v_owner, p_actor, p_kind, p_project_id, p_section_id, p_version_id);
    return;
  end if;
  for v_member in
    select m.user_id from public.research_project_members m
    where m.project_id = p_project_id and m.role = 'supervisor' and m.full_access
  loop
    perform private.notify(v_member, p_actor, p_kind, p_project_id, p_section_id, p_version_id);
  end loop;
end
$$;

create function private.notify_on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'project_comments' then
    perform private.notify_counterpart(
      new.author_id, case when new.parent_id is null then 'comment' else 'reply' end,
      new.project_id, new.section_id
    );
  elsif tg_table_name = 'thesis_versions' then
    perform private.notify_counterpart(new.created_by, 'version_submitted', new.project_id, null, new.id);
  elsif tg_table_name = 'version_decisions' then
    perform private.notify_counterpart(new.decided_by, 'version_decided', new.project_id, null, new.version_id);
  elsif tg_table_name = 'project_tasks' then
    perform private.notify_counterpart(new.created_by, 'task_added', new.project_id);
  end if;
  return new;
end
$$;

create trigger project_comments_notify after insert on public.project_comments
  for each row execute function private.notify_on_event();
create trigger thesis_versions_notify after insert on public.thesis_versions
  for each row execute function private.notify_on_event();
create trigger version_decisions_notify after insert on public.version_decisions
  for each row execute function private.notify_on_event();
create trigger project_tasks_notify after insert on public.project_tasks
  for each row execute function private.notify_on_event();

revoke all on function private.notify(uuid, uuid, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.notify_counterpart(uuid, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.notify_on_event() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lire, marquer comme lues
-- -----------------------------------------------------------------------------
-- Les notifications de l'appelant sur les projets qui lui sont encore ouverts :
-- les cinquante plus récentes, avec le titre du projet et la place qu'il y tient.
create function private.my_notifications()
returns table (
  id uuid, kind text, created_at timestamptz, is_read boolean,
  project_id uuid, project_title text, scope text, section_id uuid, version_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.created_at, n.read_at is not null,
         r.id, r.title,
         case when r.owner_id = (select auth.uid()) then 'owner' else 'member' end,
         n.section_id, n.version_id
  from public.notifications n
  join public.research_projects r on r.id = n.project_id
  left join public.research_project_members m
    on m.project_id = r.id and m.user_id = (select auth.uid()) and m.full_access
  where private.is_account_active()
    and n.user_id = (select auth.uid())
    and r.deleted_at is null
    and (r.owner_id = (select auth.uid()) or m.user_id is not null)
  order by n.created_at desc, n.id
  limit 50;
$$;

create function private.my_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  join public.research_projects r on r.id = n.project_id
  left join public.research_project_members m
    on m.project_id = r.id and m.user_id = (select auth.uid()) and m.full_access
  where private.is_account_active()
    and n.user_id = (select auth.uid())
    and n.read_at is null
    and r.deleted_at is null
    and (r.owner_id = (select auth.uid()) or m.user_id is not null);
$$;

create function private.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  update public.notifications n
  set read_at = now()
  where n.user_id = (select auth.uid()) and n.read_at is null;
end
$$;

create function public.my_notifications()
returns table (
  id uuid, kind text, created_at timestamptz, is_read boolean,
  project_id uuid, project_title text, scope text, section_id uuid, version_id uuid
)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_notifications(); $$;

create function public.my_unread_notification_count() returns integer
language sql stable security invoker set search_path = ''
as $$ select private.my_unread_notification_count(); $$;

create function public.mark_notifications_read() returns void
language sql security invoker set search_path = ''
as $$ select private.mark_notifications_read(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'my_notifications()', 'my_unread_notification_count()', 'mark_notifications_read()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Conservation : lues depuis trente jours, ou vieilles de six mois
-- -----------------------------------------------------------------------------
create function private.purge_old_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if session_user <> 'postgres' then
    perform private.fail('forbidden', '42501');
  end if;
  delete from public.notifications n
  where n.read_at < now() - interval '30 days' or n.created_at < now() - interval '180 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function private.purge_old_notifications() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-notifications-purge';
select cron.schedule('eduscholar-notifications-purge', '37 3 * * *', 'select private.purge_old_notifications()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-notifications-purge' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-notifications-purge doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
