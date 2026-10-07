-- =============================================================================
-- E-01 : partager un projet avec un encadreur (cahier §6.11, modèle §5.3-5.4)
-- =============================================================================
-- Un projet reste privé tant que son propriétaire n'a invité personne.
-- L'invitation se fait par adresse : un jeton aléatoire, à usage unique, qui
-- expire, et dont la base ne garde que l'empreinte. Accepter exige d'être
-- connecté sous l'adresse invitée, confirmée. Un jeton seul ne donne rien.
--
-- Les tables d'origine du projet ne changent pas : leurs politiques restent
-- celles du propriétaire. Un membre lit le projet par des fonctions nommées,
-- qui vérifient son appartenance à chaque appel — le retrait d'un membre prend
-- donc effet à la requête suivante. Un membre ne modifie jamais rien.
--
-- Cette tranche ne connaît que l'accès complet. La portée limitée à certaines
-- sections et l'invitation par lien viendront avec les commentaires.
--
-- Réversibilité : supprimer les fonctions, puis les deux tables.
-- =============================================================================

create table public.research_project_members (
  project_id uuid not null references public.research_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    constraint research_project_members_role_check check (role in ('supervisor', 'viewer')),
  full_access boolean not null default true,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
comment on table public.research_project_members is
  'Membres invités d''un projet. Le propriétaire n''y figure jamais : il est porté par research_projects.owner_id.';
create index research_project_members_user_id_idx on public.research_project_members (user_id);

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  email text not null
    constraint project_invitations_email_check
      check (email = lower(email) and char_length(email) between 6 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role text not null
    constraint project_invitations_role_check check (role in ('supervisor', 'viewer')),
  full_access boolean not null default true,
  token_hash text not null unique
    constraint project_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  status text not null default 'pending'
    constraint project_invitations_status_check check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.project_invitations is
  'Invitations à un projet. Seule l''empreinte du jeton est conservée.';
create index project_invitations_project_id_idx on public.project_invitations (project_id, status);

alter table public.research_project_members enable row level security;
alter table public.research_project_members force row level security;
alter table public.project_invitations enable row level security;
alter table public.project_invitations force row level security;
-- Aucune lecture ni écriture directe : tout passe par les fonctions ci-dessous.
revoke all on public.research_project_members from public, anon, authenticated, service_role;
revoke all on public.project_invitations from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Appuis
-- -----------------------------------------------------------------------------
create function private.invitation_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex'); $$;

-- Le projet dont l'appelant est membre, ou une erreur — la même pour un projet
-- inexistant, supprimé, ou dont il n'est pas membre.
create function private.require_project_membership(p_project_id uuid)
returns public.research_project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.research_project_members;
begin
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select m.* into v_member
  from public.research_project_members m
  join public.research_projects r on r.id = m.project_id
  where m.project_id = p_project_id and m.user_id = (select auth.uid()) and r.deleted_at is null;
  if not found then
    perform private.fail('not_found');
  end if;
  return v_member;
end
$$;

-- -----------------------------------------------------------------------------
-- Propriétaire : inviter, voir, révoquer, retirer
-- -----------------------------------------------------------------------------
create function private.invite_project_member(p_project_id uuid, p jsonb)
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
  -- On ne s'invite pas soi-même.
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    perform private.fail('own_account', '42501');
  end if;

  -- Vingt invitations par jour et par compte ; dix en attente et dix membres par projet.
  perform private.consume_user_quota('project-invite', 20, 86400);
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
  insert into public.project_invitations (project_id, email, role, token_hash, expires_at, created_by)
  values (p_project_id, v_email, v_role, private.invitation_token_hash(v_token), now() + interval '7 days', v_uid);

  -- La réponse est la même que l'adresse ait un compte ou non, qu'elle soit
  -- déjà membre ou non : rien n'est révélé sur elle.
  return v_token;
end
$$;

create function private.revoke_project_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  perform 1
  from public.project_invitations i
  join public.research_projects r on r.id = i.project_id
  where i.id = p_invitation_id and r.owner_id = (select auth.uid()) and r.deleted_at is null
    and i.status = 'pending';
  if not found then
    perform private.fail('not_found');
  end if;
  update public.project_invitations i set status = 'revoked' where i.id = p_invitation_id;
end
$$;

create function private.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_project(p_project_id);
  delete from public.research_project_members m
  where m.project_id = p_project_id and m.user_id = p_user_id;
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.write_audit(
    'security', 'project.unshared', (select auth.uid()), (select auth.uid()), null,
    'research_projects', p_project_id::text, '{}'::jsonb
  );
end
$$;

-- Ce que le propriétaire voit du partage de son projet : membres et invitations
-- en attente. L'adresse d'un membre est celle de son compte.
create function private.project_sharing(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_project(p_project_id);
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'email', u.email, 'role', m.role, 'joined_at', m.created_at
      ) order by m.created_at, m.user_id)
      from public.research_project_members m
      join auth.users u on u.id = m.user_id
      where m.project_id = p_project_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'expires_at', i.expires_at, 'created_at', i.created_at
      ) order by i.created_at, i.id)
      from public.project_invitations i
      where i.project_id = p_project_id and i.status = 'pending' and i.expires_at > now()
    ), '[]'::jsonb)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Personne invitée : voir l'invitation, l'accepter, quitter
-- -----------------------------------------------------------------------------
-- L'invitation que désigne un jeton, si elle est en attente, non expirée, et
-- adressée à l'adresse confirmée de l'appelant. Sinon rien : aucune différence
-- entre un jeton inconnu, expiré, révoqué ou destiné à quelqu'un d'autre.
create function private.matching_invitation(p_token text)
returns public.project_invitations
language sql
stable
security definer
set search_path = ''
as $$
  select i.*
  from public.project_invitations i
  join public.research_projects r on r.id = i.project_id
  join auth.users u on u.id = (select auth.uid())
  where private.is_account_active()
    and p_token ~ '^[0-9a-f]{64}$'
    and i.token_hash = private.invitation_token_hash(p_token)
    and i.status = 'pending'
    and i.expires_at > now()
    and r.deleted_at is null
    and r.owner_id <> u.id
    and u.email_confirmed_at is not null
    and lower(u.email) = i.email;
$$;

create function private.invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('project_title', r.title, 'role', i.role, 'owner_email', o.email)
  from private.matching_invitation(p_token) i
  join public.research_projects r on r.id = i.project_id
  join auth.users o on o.id = r.owner_id
  where i.id is not null;
$$;

-- Rend l'identifiant du projet, ou rien si le jeton ne convient pas : un refus
-- ne lève pas d'erreur, pour ne pas distinguer les cas.
create function private.accept_project_invitation(p_token text)
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

  -- L'événement est inscrit au compte du propriétaire : c'est son projet qui s'ouvre.
  select r.owner_id into v_owner from public.research_projects r where r.id = v_invitation.project_id;
  perform private.write_audit(
    'security', 'project.shared', v_uid, v_owner, null,
    'research_projects', v_invitation.project_id::text, jsonb_build_object('role', v_invitation.role)
  );
  return v_invitation.project_id;
end
$$;

create function private.leave_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform private.require_project_membership(p_project_id);
  delete from public.research_project_members m
  where m.project_id = p_project_id and m.user_id = (select auth.uid());
  select r.owner_id into v_owner from public.research_projects r where r.id = p_project_id;
  perform private.write_audit(
    'security', 'project.unshared', (select auth.uid()), v_owner, null,
    'research_projects', p_project_id::text, '{}'::jsonb
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Membre : lire
-- -----------------------------------------------------------------------------
create function private.shared_projects()
returns table (
  id uuid, title text, status text, due_date date, role text, owner_email text, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title, r.status, r.due_date, m.role, o.email::text, r.updated_at
  from public.research_project_members m
  join public.research_projects r on r.id = m.project_id
  join auth.users o on o.id = r.owner_id
  where private.is_account_active()
    and m.user_id = (select auth.uid())
    and r.deleted_at is null
  order by r.updated_at desc, r.id
  limit 100;
$$;

-- Le projet entier, pour un membre à accès complet : fiche, sections, sources
-- et citations. Colonnes nommées : une colonne ajoutée plus tard n'y entre pas
-- d'elle-même. Les fiches de lecture, notes de travail de l'étudiant, n'y
-- figurent pas.
create function private.shared_project_document(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.research_project_members := private.require_project_membership(p_project_id);
begin
  if not v_member.full_access then
    perform private.fail('not_found');
  end if;
  return (
    select jsonb_build_object(
      'role', v_member.role,
      'project', jsonb_build_object(
        'id', r.id, 'title', r.title, 'status', r.status, 'due_date', r.due_date,
        'supervisor_name', r.supervisor_name, 'problem_statement', r.problem_statement,
        'main_question', r.main_question, 'general_objective', r.general_objective,
        'methodology', r.methodology, 'updated_at', r.updated_at
      ),
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'level', s.level, 'title', s.title, 'body', s.body
        ) order by s.position)
        from public.thesis_sections s where s.project_id = r.id
      ), '[]'::jsonb),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'resource_id', s.resource_id, 'source_type', s.source_type, 'title', s.title,
          'authors', s.authors, 'publication_year', s.publication_year,
          'container_title', s.container_title, 'publisher', s.publisher, 'volume', s.volume,
          'issue', s.issue, 'pages', s.pages, 'doi', s.doi, 'url', s.url, 'accessed_on', s.accessed_on
        ) order by s.title, s.id)
        from public.project_sources s where s.project_id = r.id
      ), '[]'::jsonb),
      'citations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'section_id', c.section_id, 'source_id', c.source_id, 'pages', c.pages
        ) order by c.created_at, c.source_id)
        from public.section_citations c
        join public.thesis_sections s on s.id = c.section_id
        where s.project_id = r.id
      ), '[]'::jsonb)
    )
    from public.research_projects r
    where r.id = p_project_id
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées et droits
-- -----------------------------------------------------------------------------
create function public.invite_project_member(project_id uuid, payload jsonb) returns text
language sql security invoker set search_path = ''
as $$ select private.invite_project_member(project_id, payload); $$;

create function public.revoke_project_invitation(invitation_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.revoke_project_invitation(invitation_id); $$;

create function public.remove_project_member(project_id uuid, user_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.remove_project_member(project_id, user_id); $$;

create function public.project_sharing(project_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.project_sharing(project_id); $$;

create function public.invitation_preview(token text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.invitation_preview(token); $$;

create function public.accept_project_invitation(token text) returns uuid
language sql security invoker set search_path = ''
as $$ select private.accept_project_invitation(token); $$;

create function public.leave_project(project_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.leave_project(project_id); $$;

create function public.shared_projects()
returns table (
  id uuid, title text, status text, due_date date, role text, owner_email text, updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.shared_projects(); $$;

create function public.shared_project_document(project_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.shared_project_document(project_id); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'invite_project_member(uuid, jsonb)',
    'revoke_project_invitation(uuid)',
    'remove_project_member(uuid, uuid)',
    'project_sharing(uuid)',
    'invitation_preview(text)',
    'accept_project_invitation(text)',
    'leave_project(uuid)',
    'shared_projects()',
    'shared_project_document(uuid)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

revoke all on function private.invitation_token_hash(text) from public, anon, authenticated, service_role;
revoke all on function private.require_project_membership(uuid) from public, anon, authenticated, service_role;
revoke all on function private.matching_invitation(text) from public, anon, authenticated, service_role;

-- Le titulaire retrouve dans sa copie de données l'ouverture et la fermeture
-- du partage de ses projets.
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
      'project.unshared'
    )
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;
