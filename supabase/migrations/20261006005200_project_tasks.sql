-- =============================================================================
-- E-04 : tâches et échéances d'un projet partagé (cahier §6.11)
-- =============================================================================
-- L'étudiant et son encadreur se fixent des tâches, avec une échéance. Tous les
-- membres les lisent ; le propriétaire les modifie toutes ; l'encadreur ne
-- modifie que celles qu'il a créées ; un lecteur simple n'en crée pas
-- (matrice §5.3, lignes 18 à 20).
--
-- Comme pour le reste du partage : aucune lecture ni écriture directe.
--
-- Réversibilité : supprimer les fonctions, puis la table.
-- =============================================================================

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  title text not null
    constraint project_tasks_title_check check (private.is_clean_long_text(title, 200)),
  details text
    constraint project_tasks_details_check check (private.is_clean_long_text(details, 1000)),
  due_date date
    constraint project_tasks_due_date_check check (due_date between date '2000-01-01' and date '2100-12-31'),
  -- Simples identifiants, sans clé étrangère (voir 004800) ; mis à vide à la suppression du compte.
  created_by uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid
);
comment on table public.project_tasks is
  'Tâches et échéances d''un projet partagé. Lues et écrites par fonctions seulement.';
create index project_tasks_project_id_idx on public.project_tasks (project_id, due_date);
create index project_tasks_created_by_idx on public.project_tasks (created_by);

alter table public.project_tasks enable row level security;
alter table public.project_tasks force row level security;
revoke all on public.project_tasks from public, anon, authenticated, service_role;

-- Nettoie le contenu d'une tâche ; refuse ce qui ne se range pas.
create function private.task_fields(p jsonb, out o_title text, out o_details text, out o_due date)
language plpgsql
set search_path = ''
as $$
begin
  o_title := private.clean_line(p ->> 'title');
  o_details := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'details', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  if not private.is_clean_long_text(o_title, 200) or not private.is_clean_long_text(o_details, 1000) then
    perform private.fail('invalid_payload', '22023');
  end if;
  if coalesce(p ->> 'due_date', '') <> '' then
    if (p ->> 'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform private.fail('invalid_date', '22007');
    end if;
    begin
      o_due := (p ->> 'due_date')::date;
    exception when others then
      perform private.fail('invalid_date', '22007');
    end;
    if o_due not between date '2000-01-01' and date '2100-12-31' then
      perform private.fail('invalid_date', '22007');
    end if;
  end if;
end
$$;

create function private.add_project_task(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.project_role(p_project_id);
  v_fields record;
  v_id uuid;
begin
  if v_role not in ('owner', 'supervisor') or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  select * into v_fields from private.task_fields(p);
  if v_fields.o_title is null then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Cinquante tâches par jour et par compte ; cent par projet.
  perform private.consume_user_quota('project-task', 50, 86400);
  perform pg_advisory_xact_lock(hashtextextended('project_tasks:' || p_project_id::text, 0));
  if (select count(*) from public.project_tasks t where t.project_id = p_project_id) >= 100 then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_tasks (project_id, title, details, due_date, created_by)
  values (p_project_id, v_fields.o_title, v_fields.o_details, v_fields.o_due, (select auth.uid()))
  returning id into v_id;
  return v_id;
end
$$;

-- La tâche que l'appelant peut modifier : toutes pour le propriétaire, les
-- siennes pour l'encadreur. Tâche inconnue ou projet fermé : même refus.
create function private.require_editable_task(p_task_id uuid)
returns public.project_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.project_tasks;
  v_role text;
begin
  select t.* into v_task from public.project_tasks t where t.id = p_task_id for update;
  if v_task.id is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_task.project_id);
  if v_role <> 'owner'
     and not (v_role = 'supervisor' and v_task.created_by is not distinct from (select auth.uid())) then
    perform private.fail('forbidden', '42501');
  end if;
  return v_task;
end
$$;

-- Modifie une tâche ou la clôt. Seules les clés présentes sont écrites.
create function private.update_project_task(p_task_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.project_tasks := private.require_editable_task(p_task_id);
  v_fields record;
  v_done boolean;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  select * into v_fields from private.task_fields(p);
  if p ? 'title' and v_fields.o_title is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'done' then
    if jsonb_typeof(p -> 'done') is distinct from 'boolean' then
      perform private.fail('invalid_payload', '22023');
    end if;
    v_done := (p ->> 'done')::boolean;
  end if;
  perform private.consume_user_quota('project-task', 50, 86400);

  update public.project_tasks t
  set title = case when p ? 'title' then v_fields.o_title else t.title end,
      details = case when p ? 'details' then v_fields.o_details else t.details end,
      due_date = case when p ? 'due_date' then v_fields.o_due else t.due_date end,
      done_at = case when v_done is null then t.done_at when v_done then coalesce(t.done_at, now()) end,
      done_by = case when v_done is null then t.done_by when v_done then coalesce(t.done_by, (select auth.uid())) end
  where t.id = v_task.id;
end
$$;

create function private.delete_project_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.project_tasks := private.require_editable_task(p_task_id);
begin
  delete from public.project_tasks t where t.id = v_task.id;
end
$$;

-- Les tâches d'un projet, pour son propriétaire et ses membres : les tâches
-- ouvertes d'abord, par échéance.
create function private.project_tasks(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.project_role(p_project_id);
  v_owner uuid;
begin
  select r.owner_id into v_owner from public.research_projects r where r.id = p_project_id;
  return jsonb_build_object(
    'role', v_role,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'details', t.details, 'due_date', t.due_date,
        'done', t.done_at is not null, 'created_at', t.created_at,
        'author_role', case
          when t.created_by is null then null
          when t.created_by = v_owner then 'owner'
          else m.role
        end,
        'editable', v_role = 'owner' or (v_role = 'supervisor' and t.created_by is not distinct from v_uid)
      ) order by (t.done_at is not null), t.due_date nulls last, t.created_at, t.id)
      from public.project_tasks t
      left join public.research_project_members m on m.project_id = t.project_id and m.user_id = t.created_by
      where t.project_id = p_project_id
    ), '[]'::jsonb)
  );
end
$$;

-- Les tâches que l'appelant a créées, et celles de ses projets : copie de ses données.
create function private.my_project_tasks()
returns table (id uuid, project_id uuid, title text, details text, due_date date, created_at timestamptz, done_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.project_id, t.title, t.details, t.due_date, t.created_at, t.done_at
  from public.project_tasks t
  join public.research_projects r on r.id = t.project_id
  where private.is_account_active()
    and (t.created_by = (select auth.uid()) or r.owner_id = (select auth.uid()))
  order by t.created_at, t.id
  limit 5000;
$$;

create function public.add_project_task(project_id uuid, payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.add_project_task(project_id, payload); $$;

create function public.update_project_task(task_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.update_project_task(task_id, payload); $$;

create function public.delete_project_task(task_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_project_task(task_id); $$;

create function public.project_tasks(project_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.project_tasks(project_id); $$;

create function public.my_project_tasks()
returns table (id uuid, project_id uuid, title text, details text, due_date date, created_at timestamptz, done_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_project_tasks(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'add_project_task(uuid, jsonb)', 'update_project_task(uuid, jsonb)', 'delete_project_task(uuid)',
    'project_tasks(uuid)', 'my_project_tasks()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

revoke all on function private.task_fields(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.require_editable_task(uuid) from public, anon, authenticated, service_role;

-- Suppression d'un compte : ses tâches restent dans les projets d'autrui, sans son identifiant.
create or replace function private.anonymize_departed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_comments c
  set author_id = case when c.author_id = old.id then null else c.author_id end,
      resolved_by = case when c.resolved_by = old.id then null else c.resolved_by end
  where (c.author_id = old.id or c.resolved_by = old.id)
    and not exists (
      select 1 from public.research_projects r where r.id = c.project_id and r.owner_id = old.id
    );
  update public.version_decisions d
  set decided_by = null
  where d.decided_by = old.id
    and not exists (
      select 1 from public.research_projects r where r.id = d.project_id and r.owner_id = old.id
    );
  update public.project_tasks t
  set created_by = case when t.created_by = old.id then null else t.created_by end,
      done_by = case when t.done_by = old.id then null else t.done_by end
  where (t.created_by = old.id or t.done_by = old.id)
    and not exists (
      select 1 from public.research_projects r where r.id = t.project_id and r.owner_id = old.id
    );
  update public.research_project_members m
  set invited_by = null
  where m.invited_by = old.id
    and not exists (
      select 1 from public.research_projects r where r.id = m.project_id and r.owner_id = old.id
    );
  update public.project_invitations i
  set accepted_by = case when i.accepted_by = old.id then null else i.accepted_by end,
      created_by = case when i.created_by = old.id then null else i.created_by end
  where (i.accepted_by = old.id or i.created_by = old.id)
    and not exists (
      select 1 from public.research_projects r where r.id = i.project_id and r.owner_id = old.id
    );
  return old;
end
$$;
