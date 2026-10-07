-- =============================================================================
-- E-02 : commentaires sur les sections d'un projet partagé (cahier §6.11)
-- =============================================================================
-- Le propriétaire et son encadreur commentent une section, se répondent, et
-- closent un fil quand la remarque est traitée. Un lecteur simple lit les
-- commentaires sans en écrire (matrice §5.3, lignes 14 à 17).
--
-- Un commentaire porte toujours une section. Il peut citer le passage qu'il
-- vise : le texte cité est recopié, pour rester lisible quand la section
-- change. Chacun ne modifie et ne supprime que les siens.
--
-- Comme pour le reste du partage : aucune lecture ni écriture directe, tout
-- passe par des fonctions qui revérifient l'appartenance à chaque appel.
--
-- Réversibilité : supprimer les fonctions, puis la table.
-- =============================================================================

create table public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  section_id uuid not null references public.thesis_sections (id) on delete cascade,
  -- Réponse à un commentaire de premier niveau ; un seul niveau de réponses.
  parent_id uuid references public.project_comments (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text
    constraint project_comments_body_check check (private.is_clean_long_text(body, 2000)),
  -- Passage visé, recopié de la section au moment du commentaire.
  quote text
    constraint project_comments_quote_check check (private.is_clean_long_text(quote, 400)),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Commentaire retiré par son auteur alors qu'on lui avait répondu : le fil reste.
  deleted_at timestamptz,
  -- Fil clos : porté par le commentaire de premier niveau.
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  constraint project_comments_content_check check ((body is null) = (deleted_at is not null)),
  constraint project_comments_reply_check check (parent_id is null or (quote is null and resolved_at is null))
);
comment on table public.project_comments is
  'Commentaires sur les sections d''un projet partagé. Lus et écrits par fonctions seulement.';
create index project_comments_section_id_idx on public.project_comments (section_id, created_at);
create index project_comments_project_id_idx on public.project_comments (project_id);
create index project_comments_parent_id_idx on public.project_comments (parent_id);
create index project_comments_author_id_idx on public.project_comments (author_id);

alter table public.project_comments enable row level security;
alter table public.project_comments force row level security;
revoke all on public.project_comments from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Appui : la place de l'appelant dans un projet
-- -----------------------------------------------------------------------------
-- « owner », « supervisor » ou « viewer ». Projet inexistant, supprimé, ou dont
-- l'appelant n'est ni propriétaire ni membre à accès complet : même refus.
create function private.project_role(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select case when r.owner_id = v_uid then 'owner' else m.role end into v_role
  from public.research_projects r
  left join public.research_project_members m
    on m.project_id = r.id and m.user_id = v_uid and m.full_access
  where r.id = p_project_id and r.deleted_at is null
    and (r.owner_id = v_uid or m.user_id is not null);
  if v_role is null then
    perform private.fail('not_found');
  end if;
  return v_role;
end
$$;

-- -----------------------------------------------------------------------------
-- Écrire
-- -----------------------------------------------------------------------------
create function private.add_project_comment(p_section_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_role text;
  v_parent uuid;
  v_body text;
  v_quote text;
  v_id uuid;
begin
  -- La section, puis la place de l'appelant dans son projet : une section
  -- inconnue et une section d'un projet fermé à l'appelant répondent pareil.
  select s.project_id into v_project from public.thesis_sections s where s.id = p_section_id;
  if v_project is null then
    if v_uid is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_project);
  if v_role not in ('owner', 'supervisor') then
    perform private.fail('forbidden', '42501');
  end if;
  if not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;

  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_body := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  v_quote := private.clean_line(p ->> 'quote');
  if v_body is null or not private.is_clean_long_text(v_body, 2000)
     or not private.is_clean_long_text(v_quote, 400) then
    perform private.fail('invalid_payload', '22023');
  end if;

  if p ->> 'parent_id' is not null then
    if (p ->> 'parent_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    -- Une réponse suit un commentaire de premier niveau de la même section.
    select c.id into v_parent
    from public.project_comments c
    where c.id = (p ->> 'parent_id')::uuid and c.section_id = p_section_id and c.parent_id is null;
    if v_parent is null then
      perform private.fail('not_found');
    end if;
    v_quote := null;
  end if;

  -- Deux cents commentaires par jour et par compte ; cinq cents par projet.
  perform private.consume_user_quota('project-comment', 200, 86400);
  perform pg_advisory_xact_lock(hashtextextended('project_comments:' || v_project::text, 0));
  if (select count(*) from public.project_comments c where c.project_id = v_project) >= 500 then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_comments (project_id, section_id, parent_id, author_id, body, quote)
  values (v_project, p_section_id, v_parent, v_uid, v_body, v_quote)
  returning id into v_id;
  return v_id;
end
$$;

-- Le commentaire de l'appelant, dans un projet qui lui est encore ouvert.
create function private.require_own_comment(p_comment_id uuid)
returns public.project_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.project_comments;
begin
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select c.* into v_comment
  from public.project_comments c
  where c.id = p_comment_id and c.author_id = (select auth.uid()) and c.deleted_at is null
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  -- Retiré du projet, on ne touche plus à ses anciens commentaires.
  perform private.project_role(v_comment.project_id);
  return v_comment;
end
$$;

create function private.update_project_comment(p_comment_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.project_comments := private.require_own_comment(p_comment_id);
  v_body text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_body := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  if v_body is null or not private.is_clean_long_text(v_body, 2000) then
    perform private.fail('invalid_payload', '22023');
  end if;
  perform private.consume_user_quota('project-comment', 200, 86400);
  update public.project_comments c
  set body = v_body, edited_at = now()
  where c.id = v_comment.id and c.body is distinct from v_body;
end
$$;

create function private.delete_project_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.project_comments := private.require_own_comment(p_comment_id);
begin
  -- Un commentaire auquel on a répondu laisse sa place dans le fil, sans son
  -- texte : les réponses des autres ne partent pas avec lui.
  if exists (select 1 from public.project_comments r where r.parent_id = v_comment.id) then
    update public.project_comments c
    set body = null, quote = null, deleted_at = now()
    where c.id = v_comment.id;
  else
    delete from public.project_comments c where c.id = v_comment.id;
  end if;
end
$$;

-- Clore ou rouvrir un fil : le propriétaire ou l'encadreur.
create function private.resolve_project_thread(p_comment_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_role text;
begin
  if p_resolved is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  select c.project_id into v_project
  from public.project_comments c where c.id = p_comment_id and c.parent_id is null;
  if v_project is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_project);
  if v_role not in ('owner', 'supervisor') then
    perform private.fail('forbidden', '42501');
  end if;
  update public.project_comments c
  set resolved_at = case when p_resolved then coalesce(c.resolved_at, now()) end,
      resolved_by = case when p_resolved then coalesce(c.resolved_by, (select auth.uid())) end
  where c.id = p_comment_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Lire
-- -----------------------------------------------------------------------------
-- Les commentaires d'un projet, pour son propriétaire et ses membres. L'auteur
-- est décrit par sa place dans le projet ; son adresse n'est donnée que si
-- c'est le propriétaire ou un membre actuel.
create function private.project_comments(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.project_role(p_project_id);
begin
  return jsonb_build_object(
    'role', v_role,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'section_id', c.section_id,
        'parent_id', c.parent_id,
        'mine', c.author_id is not distinct from v_uid,
        'author_role', case
          when c.author_id is null then null
          when c.author_id = r.owner_id then 'owner'
          else m.role
        end,
        'author_email', case
          when c.author_id = r.owner_id or m.user_id is not null then u.email
        end,
        'body', c.body,
        'quote', c.quote,
        'created_at', c.created_at,
        'edited', c.edited_at is not null,
        'deleted', c.deleted_at is not null,
        'resolved_at', c.resolved_at
      ) order by c.created_at, c.id)
      from public.project_comments c
      join public.research_projects r on r.id = c.project_id
      left join public.research_project_members m on m.project_id = c.project_id and m.user_id = c.author_id
      left join auth.users u on u.id = c.author_id
      where c.project_id = p_project_id
    ), '[]'::jsonb)
  );
end
$$;

-- Les commentaires écrits par l'appelant, pour la copie de ses données.
create function private.my_project_comments()
returns table (id uuid, project_id uuid, section_id uuid, body text, quote text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.project_id, c.section_id, c.body, c.quote, c.created_at
  from public.project_comments c
  where private.is_account_active()
    and c.author_id = (select auth.uid())
    and c.deleted_at is null
  order by c.created_at, c.id
  limit 5000;
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées et droits
-- -----------------------------------------------------------------------------
create function public.add_project_comment(section_id uuid, payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.add_project_comment(section_id, payload); $$;

create function public.update_project_comment(comment_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.update_project_comment(comment_id, payload); $$;

create function public.delete_project_comment(comment_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_project_comment(comment_id); $$;

create function public.resolve_project_thread(comment_id uuid, resolved boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.resolve_project_thread(comment_id, resolved); $$;

create function public.project_comments(project_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.project_comments(project_id); $$;

create function public.my_project_comments()
returns table (id uuid, project_id uuid, section_id uuid, body text, quote text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_project_comments(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'add_project_comment(uuid, jsonb)',
    'update_project_comment(uuid, jsonb)',
    'delete_project_comment(uuid)',
    'resolve_project_thread(uuid, boolean)',
    'project_comments(uuid)',
    'my_project_comments()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

revoke all on function private.project_role(uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_own_comment(uuid) from public, anon, authenticated, service_role;
