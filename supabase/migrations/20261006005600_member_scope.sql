-- =============================================================================
-- E-06 (1/2) : portée d'un membre limitée à certaines sections
-- =============================================================================
-- Le propriétaire peut n'ouvrir à un membre que quelques sections de son
-- projet (modèle §5.3 : « Limité »). Un membre limité lit la fiche du projet et
-- ces sections-là, avec leurs commentaires ; un encadreur limité les commente.
-- Il ne lit ni les autres sections — pas même leur titre —, ni les sources et
-- citations, ni les versions soumises, ni les tâches : tout ce qui ne porte
-- pas de section reste réservé à l'accès complet.
--
-- La portée se fixe à l'invitation, ou plus tard sur un membre. Elle est lue
-- en base à chaque appel : la restreindre prend effet à la requête suivante.
--
-- Réversibilité : rétablir les fonctions des migrations 004500 à 005500, puis
-- supprimer la table et la colonne ajoutées.
-- =============================================================================

create table public.research_project_member_sections (
  project_id uuid not null,
  user_id uuid not null,
  section_id uuid not null references public.thesis_sections (id) on delete cascade,
  primary key (project_id, user_id, section_id),
  foreign key (project_id, user_id)
    references public.research_project_members (project_id, user_id) on delete cascade
);
comment on table public.research_project_member_sections is
  'Sections ouvertes à un membre dont l''accès n''est pas complet. Lues et écrites par fonctions seulement.';
create index research_project_member_sections_section_id_idx
  on public.research_project_member_sections (section_id);

alter table public.research_project_member_sections enable row level security;
alter table public.research_project_member_sections force row level security;
revoke all on public.research_project_member_sections from public, anon, authenticated, service_role;

-- Sections proposées par une invitation à portée limitée.
alter table public.project_invitations
  add column section_ids uuid[]
    constraint project_invitations_section_ids_check
      check (section_ids is null or (not full_access and cardinality(section_ids) between 1 and 60));

-- -----------------------------------------------------------------------------
-- Appuis : la place de l'appelant dans un projet, dans une section
-- -----------------------------------------------------------------------------
-- Propriétaire, ou membre quel que soit son accès. Projet inexistant, supprimé
-- ou fermé à l'appelant : même refus.
create function private.project_access(p_project_id uuid, out o_role text, out o_full boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select case when r.owner_id = v_uid then 'owner' else m.role end,
         r.owner_id = v_uid or coalesce(m.full_access, false)
  into o_role, o_full
  from public.research_projects r
  left join public.research_project_members m on m.project_id = r.id and m.user_id = v_uid
  where r.id = p_project_id and r.deleted_at is null
    and (r.owner_id = v_uid or m.user_id is not null);
  if o_role is null then
    perform private.fail('not_found');
  end if;
end
$$;

-- La place de l'appelant vis-à-vis d'une section : celle qu'il tient dans le
-- projet, si la section lui est ouverte. Section inconnue, d'un projet fermé,
-- ou hors de sa portée : même refus.
create function private.section_access(p_section_id uuid, out o_project uuid, out o_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full boolean;
begin
  select s.project_id into o_project from public.thesis_sections s where s.id = p_section_id;
  if o_project is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  select a.o_role, a.o_full into o_role, v_full from private.project_access(o_project) a;
  if not v_full and not exists (
    select 1 from public.research_project_member_sections x
    where x.project_id = o_project and x.user_id = (select auth.uid()) and x.section_id = p_section_id
  ) then
    perform private.fail('not_found');
  end if;
end
$$;

revoke all on function private.project_access(uuid) from public, anon, authenticated, service_role;
revoke all on function private.section_access(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Propriétaire : fixer la portée d'un membre ; inviter avec une portée
-- -----------------------------------------------------------------------------
-- Les identifiants de section d'une charge utile : jusqu'à soixante, tous du projet.
create function private.scope_sections(p_project_id uuid, p_value jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value) not between 1 and 60 then
    perform private.fail('invalid_payload', '22023');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value) e
    where jsonb_typeof(e) <> 'string'
       or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    perform private.fail('invalid_payload', '22023');
  end if;
  select array_agg(distinct (e #>> '{}')::uuid) into v_ids from jsonb_array_elements(p_value) e;
  -- Une section d'un autre projet, ou inconnue : la demande entière est refusée.
  if (select count(*) from public.thesis_sections s
      where s.project_id = p_project_id and s.id = any (v_ids)) <> cardinality(v_ids) then
    perform private.fail('invalid_payload', '22023');
  end if;
  return v_ids;
end
$$;

revoke all on function private.scope_sections(uuid, jsonb) from public, anon, authenticated, service_role;

create function private.set_member_scope(p_project_id uuid, p_user_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full boolean;
  v_ids uuid[];
begin
  perform private.require_own_project(p_project_id);
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p -> 'full_access') is distinct from 'boolean' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_full := (p ->> 'full_access')::boolean;
  if not v_full then
    v_ids := private.scope_sections(p_project_id, p -> 'section_ids');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || p_project_id::text, 0));
  update public.research_project_members m
  set full_access = v_full
  where m.project_id = p_project_id and m.user_id = p_user_id;
  if not found then
    perform private.fail('not_found');
  end if;
  delete from public.research_project_member_sections x
  where x.project_id = p_project_id and x.user_id = p_user_id;
  if not v_full then
    insert into public.research_project_member_sections (project_id, user_id, section_id)
    select p_project_id, p_user_id, unnest(v_ids);
  end if;
  perform private.write_audit(
    'security', 'project.scope_changed', (select auth.uid()), (select auth.uid()), null,
    'research_projects', p_project_id::text,
    jsonb_build_object('member_id', p_user_id, 'full_access', v_full)
  );
end
$$;

create or replace function private.invite_project_member(p_project_id uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
  v_token text;
  v_hits integer;
  v_ids uuid[];
begin
  perform private.require_own_project(p_project_id);
  v_uid := (select auth.uid());
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_email := lower(btrim(coalesce(p ->> 'email', '')));
  v_role := coalesce(p ->> 'role', '');
  if char_length(v_email) not between 6 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or v_role not in ('supervisor', 'viewer') then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Portée limitée : les sections ouvertes sont nommées dès l'invitation.
  if p ? 'section_ids' and jsonb_typeof(p -> 'section_ids') <> 'null' then
    v_ids := private.scope_sections(p_project_id, p -> 'section_ids');
  end if;
  -- On ne s'invite pas soi-même.
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    perform private.fail('own_account', '42501');
  end if;

  -- Vingt invitations par jour et par compte ; dix en attente et dix membres par projet.
  perform private.consume_user_quota('project-invite', 20, 86400);

  -- Trois invitations par jour vers une même adresse, tous expéditeurs
  -- confondus. La clé est une empreinte : la table ne retient pas l'adresse.
  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (
    'project-invite:to:' || left(encode(sha256(convert_to('project-invite:' || v_email, 'UTF8')), 'hex'), 40),
    date_trunc('day', now(), 'UTC'), 1
  )
  on conflict (bucket_key, window_start) do update set hits = b.hits + 1
  returning b.hits into v_hits;
  if v_hits > 3 then
    perform private.fail('rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || p_project_id::text, 0));

  -- Une nouvelle invitation à la même adresse remplace la précédente.
  update public.project_invitations i set status = 'revoked'
  where i.project_id = p_project_id and i.email = v_email and i.status = 'pending';

  if (select count(*) from public.project_invitations i
      where i.project_id = p_project_id and i.status = 'pending' and i.expires_at > now()) >= 10
     or (select count(*) from public.research_project_members m where m.project_id = p_project_id) >= 10 then
    perform private.fail('limit_reached');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.project_invitations
    (project_id, email, role, full_access, section_ids, token_hash, expires_at, created_by)
  values
    (p_project_id, v_email, v_role, v_ids is null, v_ids, private.invitation_token_hash(v_token),
     now() + interval '7 days', v_uid);

  -- La réponse est la même que l'adresse ait un compte ou non, qu'elle soit
  -- déjà membre ou non : rien n'est révélé sur elle.
  return v_token;
end
$$;

create or replace function private.accept_project_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invitation public.project_invitations;
  v_owner uuid;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  -- Trente essais par quart d'heure : un refus est compté, puisqu'il ne lève rien.
  perform private.consume_user_quota('invitation-accept', 30, 900);

  select * into v_invitation from private.matching_invitation(p_token);
  if v_invitation.id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || v_invitation.project_id::text, 0));
  -- Le jeton ne sert qu'une fois : relu sous le verrou.
  update public.project_invitations i
  set status = 'accepted', accepted_by = v_uid
  where i.id = v_invitation.id and i.status = 'pending';
  if not found then
    return null;
  end if;
  if (select count(*) from public.research_project_members m
      where m.project_id = v_invitation.project_id and m.user_id <> v_uid) >= 10 then
    perform private.fail('limit_reached');
  end if;

  insert into public.research_project_members (project_id, user_id, role, full_access, invited_by)
  values (v_invitation.project_id, v_uid, v_invitation.role, v_invitation.full_access, v_invitation.created_by)
  on conflict (project_id, user_id) do update set role = excluded.role, full_access = excluded.full_access;

  -- La portée de l'invitation remplace toute portée antérieure ; une section
  -- supprimée entre-temps n'y entre pas.
  delete from public.research_project_member_sections x
  where x.project_id = v_invitation.project_id and x.user_id = v_uid;
  if not v_invitation.full_access then
    insert into public.research_project_member_sections (project_id, user_id, section_id)
    select v_invitation.project_id, v_uid, s.id
    from public.thesis_sections s
    where s.project_id = v_invitation.project_id and s.id = any (v_invitation.section_ids);
  end if;

  -- L'événement est inscrit au compte du propriétaire : c'est son projet qui s'ouvre.
  select r.owner_id into v_owner from public.research_projects r where r.id = v_invitation.project_id;
  perform private.write_audit(
    'security', 'project.shared', v_uid, v_owner, null,
    'research_projects', v_invitation.project_id::text,
    jsonb_build_object('role', v_invitation.role, 'full_access', v_invitation.full_access)
  );
  return v_invitation.project_id;
end
$$;

create or replace function private.invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'project_title', r.title, 'role', i.role, 'owner_email', o.email, 'full_access', i.full_access
  )
  from private.matching_invitation(p_token) i
  join public.research_projects r on r.id = i.project_id
  join auth.users o on o.id = r.owner_id
  where i.id is not null;
$$;

-- -----------------------------------------------------------------------------
-- Membre : lire selon sa portée
-- -----------------------------------------------------------------------------
create or replace function private.shared_project_document(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_full boolean;
begin
  select a.o_role, a.o_full into v_role, v_full from private.project_access(p_project_id) a;
  -- Cette lecture est celle d'un membre : le propriétaire a ses propres pages.
  if v_role = 'owner' then
    perform private.fail('not_found');
  end if;
  -- Lecture lourde : cent vingt par quart d'heure et par compte.
  perform private.consume_user_quota('shared-document', 120, 900);

  return (
    select jsonb_build_object(
      'role', v_role,
      'full_access', v_full,
      'project', jsonb_build_object(
        'id', r.id, 'title', r.title, 'status', r.status, 'due_date', r.due_date,
        'supervisor_name', r.supervisor_name, 'problem_statement', r.problem_statement,
        'main_question', r.main_question, 'general_objective', r.general_objective,
        'methodology', r.methodology, 'updated_at', r.updated_at
      ),
      -- Accès limité : les seules sections ouvertes ; ni sources ni citations.
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'level', s.level, 'title', s.title, 'body', s.body
        ) order by s.position)
        from public.thesis_sections s
        where s.project_id = r.id
          and (v_full or exists (
            select 1 from public.research_project_member_sections x
            where x.project_id = r.id and x.user_id = v_uid and x.section_id = s.id
          ))
      ), '[]'::jsonb),
      'sources', case when v_full then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'resource_id', s.resource_id, 'source_type', s.source_type, 'title', s.title,
          'authors', s.authors, 'publication_year', s.publication_year,
          'container_title', s.container_title, 'publisher', s.publisher, 'volume', s.volume,
          'issue', s.issue, 'pages', s.pages, 'doi', s.doi, 'url', s.url, 'accessed_on', s.accessed_on
        ) order by s.title, s.id)
        from public.project_sources s where s.project_id = r.id
      ), '[]'::jsonb) else '[]'::jsonb end,
      'citations', case when v_full then coalesce((
        select jsonb_agg(jsonb_build_object(
          'section_id', c.section_id, 'source_id', c.source_id, 'pages', c.pages
        ) order by c.created_at, c.source_id)
        from public.section_citations c
        join public.thesis_sections s on s.id = c.section_id
        where s.project_id = r.id
      ), '[]'::jsonb) else '[]'::jsonb end
    )
    from public.research_projects r
    where r.id = p_project_id and r.deleted_at is null
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Commentaires : selon la section
-- -----------------------------------------------------------------------------
create or replace function private.add_project_comment(p_section_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_owner uuid;
  v_role text;
  v_parent uuid;
  v_body text;
  v_quote text;
  v_id uuid;
begin
  -- La section doit être ouverte à l'appelant : inconnue, d'un projet fermé ou
  -- hors de sa portée, même refus.
  select a.o_project, a.o_role into v_project, v_role from private.section_access(p_section_id) a;
  if v_role not in ('owner', 'supervisor') or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;

  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_body := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  -- Le passage cité tient sur une ligne.
  v_quote := private.clean_line(regexp_replace(coalesce(p ->> 'quote', ''), '[\r\n]+', ' ', 'g'));
  if v_body is null or not private.is_clean_long_text(v_body, 2000)
     or not private.is_clean_long_text(v_quote, 400) then
    perform private.fail('invalid_payload', '22023');
  end if;

  if p ->> 'parent_id' is not null then
    if (p ->> 'parent_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    -- Une réponse suit un commentaire de premier niveau de la même section,
    -- dans un fil encore ouvert.
    select c.id into v_parent
    from public.project_comments c
    where c.id = (p ->> 'parent_id')::uuid and c.section_id = p_section_id and c.parent_id is null
      and c.resolved_at is null;
    if v_parent is null then
      perform private.fail('not_found');
    end if;
    v_quote := null;
  end if;

  -- Deux cents commentaires par jour et par compte.
  perform private.consume_user_quota('project-comment', 200, 86400);
  perform pg_advisory_xact_lock(hashtextextended('project_comments:' || v_project::text, 0));
  select r.owner_id into v_owner from public.research_projects r where r.id = v_project;
  -- Par projet : trois cents pour le propriétaire ; cent cinquante par membre
  -- et trois cents pour l'ensemble des membres, anciens compris.
  if v_uid = v_owner then
    if (select count(*) from public.project_comments c
        where c.project_id = v_project and c.author_id = v_owner) >= 300 then
      perform private.fail('limit_reached');
    end if;
  elsif (select count(*) from public.project_comments c
         where c.project_id = v_project and c.author_id = v_uid) >= 150
     or (select count(*) from public.project_comments c
         where c.project_id = v_project and c.author_id is distinct from v_owner) >= 300 then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_comments (project_id, section_id, parent_id, author_id, body, quote)
  values (v_project, p_section_id, v_parent, v_uid, v_body, v_quote)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function private.require_own_comment(p_comment_id uuid)
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
  -- Retiré du projet, privé de cette section, ou redevenu simple lecteur, on
  -- ne touche plus à ses anciens commentaires.
  if (select a.o_role from private.section_access(v_comment.section_id) a) not in ('owner', 'supervisor') then
    perform private.fail('forbidden', '42501');
  end if;
  return v_comment;
end
$$;

create or replace function private.resolve_project_thread(p_comment_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section uuid;
begin
  if p_resolved is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  select c.section_id into v_section
  from public.project_comments c where c.id = p_comment_id and c.parent_id is null;
  if v_section is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  if (select a.o_role from private.section_access(v_section) a) not in ('owner', 'supervisor') then
    perform private.fail('forbidden', '42501');
  end if;
  update public.project_comments c
  set resolved_at = case when p_resolved then coalesce(c.resolved_at, now()) end,
      resolved_by = case when p_resolved then coalesce(c.resolved_by, (select auth.uid())) end
  where c.id = p_comment_id;
end
$$;

create or replace function private.project_comments(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_full boolean;
begin
  select a.o_role, a.o_full into v_role, v_full from private.project_access(p_project_id) a;
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
        -- L'adresse d'un membre n'est rendue qu'au propriétaire, qui l'a invité ;
        -- celle du propriétaire, à ses membres, qui la connaissent déjà.
        'author_email', case
          when c.author_id = r.owner_id then u.email
          when m.user_id is not null and v_role = 'owner' then u.email
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
        -- Accès limité : les commentaires des seules sections ouvertes.
        and (v_full or exists (
          select 1 from public.research_project_member_sections x
          where x.project_id = c.project_id and x.user_id = v_uid and x.section_id = c.section_id
        ))
    ), '[]'::jsonb)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Notifications : selon la portée
-- -----------------------------------------------------------------------------
create or replace function private.notify_counterpart(
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
  -- Les encadreurs à accès complet ; et, pour ce qui porte une section, ceux à
  -- qui cette section est ouverte.
  for v_member in
    select m.user_id from public.research_project_members m
    where m.project_id = p_project_id and m.role = 'supervisor'
      and (m.full_access or (p_section_id is not null and exists (
        select 1 from public.research_project_member_sections x
        where x.project_id = m.project_id and x.user_id = m.user_id and x.section_id = p_section_id
      )))
  loop
    perform private.notify(v_member, p_actor, p_kind, p_project_id, p_section_id, p_version_id);
  end loop;
end
$$;

-- Une notification est visible si ce qu'elle désigne est encore ouvert à
-- l'appelant : tout pour le propriétaire et l'accès complet ; pour un accès
-- limité, les seules notifications d'une section ouverte.
create function private.can_see_notification(p_project_id uuid, p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.research_projects r
    left join public.research_project_members m
      on m.project_id = r.id and m.user_id = (select auth.uid())
    where r.id = p_project_id and r.deleted_at is null
      and (
        r.owner_id = (select auth.uid())
        or m.full_access
        or (m.user_id is not null and p_section_id is not null and exists (
          select 1 from public.research_project_member_sections x
          where x.project_id = r.id and x.user_id = m.user_id and x.section_id = p_section_id
        ))
      )
  );
$$;

revoke all on function private.can_see_notification(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.my_notifications()
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
  where private.is_account_active()
    and n.user_id = (select auth.uid())
    and private.can_see_notification(n.project_id, n.section_id)
  order by n.created_at desc, n.id
  limit 50;
$$;

create or replace function private.my_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where private.is_account_active()
    and n.user_id = (select auth.uid())
    and n.read_at is null
    and private.can_see_notification(n.project_id, n.section_id);
$$;

-- -----------------------------------------------------------------------------
-- Enveloppe et droits
-- -----------------------------------------------------------------------------
create function public.set_member_scope(project_id uuid, user_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.set_member_scope(project_id, user_id, payload); $$;

revoke all on function private.set_member_scope(uuid, uuid, jsonb) from public, anon, service_role;
revoke all on function public.set_member_scope(uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function private.set_member_scope(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_member_scope(uuid, uuid, jsonb) to authenticated;
