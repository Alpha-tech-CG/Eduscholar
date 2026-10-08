-- =============================================================================
-- E-04 : corrections de la revue de sécurité des tâches
-- =============================================================================
--   - la copie des données ne rend plus à un membre retiré le texte actuel des
--     tâches qu'il avait posées : le propriétaire a pu les réécrire depuis ;
--   - un membre ne peut plus saturer le projet : trente tâches ouvertes au plus
--     par membre, pour que le propriétaire garde la main sur les siennes ;
--   - modifier ou clore n'entame plus le quota des créations ;
--   - l'intitulé est une chaîne, sur une seule ligne ;
--   - la tâche n'est verrouillée qu'après le contrôle de la place de
--     l'appelant, et modifier exige un profil complété, comme créer.
--
-- Réversibilité : rétablir les fonctions de la migration 005200.
-- =============================================================================

create or replace function private.task_fields(p jsonb, out o_title text, out o_details text, out o_due date)
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p -> 'title') not in ('string', 'null')
     or jsonb_typeof(p -> 'details') not in ('string', 'null')
     or jsonb_typeof(p -> 'due_date') not in ('string', 'null') then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- L'intitulé tient sur une ligne.
  o_title := private.clean_line(regexp_replace(coalesce(p ->> 'title', ''), '[\r\n\t]+', ' ', 'g'));
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
    exception when data_exception then
      perform private.fail('invalid_date', '22007');
    end;
    if o_due not between date '2000-01-01' and date '2100-12-31' then
      perform private.fail('invalid_date', '22007');
    end if;
  end if;
end
$$;

create or replace function private.add_project_task(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
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

  -- Cinquante tâches créées par jour et par compte ; cent par projet ; trente
  -- tâches ouvertes au plus pour un membre, qui ne peut donc pas remplir le
  -- projet à la place de son propriétaire.
  perform private.consume_user_quota('project-task', 50, 86400);
  perform pg_advisory_xact_lock(hashtextextended('project_tasks:' || p_project_id::text, 0));
  if (select count(*) from public.project_tasks t where t.project_id = p_project_id) >= 100
     or (v_role <> 'owner'
         and (select count(*) from public.project_tasks t
              where t.project_id = p_project_id and t.created_by = v_uid and t.done_at is null) >= 30) then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_tasks (project_id, title, details, due_date, created_by)
  values (p_project_id, v_fields.o_title, v_fields.o_details, v_fields.o_due, v_uid)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function private.require_editable_task(p_task_id uuid)
returns public.project_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_task public.project_tasks;
  v_role text;
begin
  -- La place de l'appelant d'abord ; la ligne n'est verrouillée qu'ensuite.
  select t.project_id into v_project from public.project_tasks t where t.id = p_task_id;
  if v_project is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_project);
  select t.* into v_task from public.project_tasks t where t.id = p_task_id for update;
  if v_task.id is null then
    perform private.fail('not_found');
  end if;
  if not private.is_onboarded()
     or (v_role <> 'owner'
         and not (v_role = 'supervisor' and v_task.created_by is not distinct from (select auth.uid()))) then
    perform private.fail('forbidden', '42501');
  end if;
  return v_task;
end
$$;

create or replace function private.update_project_task(p_task_id uuid, p jsonb)
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
  -- Deux cents modifications par jour et par compte, comptées à part des créations.
  perform private.consume_user_quota('project-task-update', 200, 86400);

  update public.project_tasks t
  set title = case when p ? 'title' then v_fields.o_title else t.title end,
      details = case when p ? 'details' then v_fields.o_details else t.details end,
      due_date = case when p ? 'due_date' then v_fields.o_due else t.due_date end,
      done_at = case when v_done is null then t.done_at when v_done then coalesce(t.done_at, now()) end,
      done_by = case when v_done is null then t.done_by when v_done then coalesce(t.done_by, (select auth.uid())) end
  where t.id = v_task.id;
end
$$;

-- Copie des données : les tâches de ses projets ; et celles qu'il a posées
-- ailleurs, tant qu'il est encore membre à accès complet du projet. Retiré, il
-- ne relit pas ce que le propriétaire a pu en faire.
create or replace function private.my_project_tasks()
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
    and r.deleted_at is null
    and (
      r.owner_id = (select auth.uid())
      or (t.created_by = (select auth.uid()) and exists (
        select 1 from public.research_project_members m
        where m.project_id = t.project_id and m.user_id = (select auth.uid()) and m.full_access
      ))
    )
  order by t.created_at, t.id
  limit 5000;
$$;
