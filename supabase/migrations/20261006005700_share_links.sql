-- =============================================================================
-- E-06 (2/2) : invitation par lien, confirmée par le propriétaire (modèle §5.4)
-- =============================================================================
-- Le propriétaire peut créer un lien de partage — pour un groupe de travail,
-- ou quand il ne connaît pas l'adresse de la personne. Ce lien ne donne aucun
-- droit, et ne dit rien du projet : qui l'ouvre, une fois connecté, peut
-- seulement demander à le suivre. Le propriétaire voit alors le nom d'affichage
-- et l'adresse du demandeur, et accepte ou refuse. Le rôle n'existe qu'après
-- son accord.
--
-- Une demande faite avec un lien inconnu, expiré ou révoqué reçoit la même
-- réponse qu'une demande valable : rien ne distingue les cas.
--
-- Réversibilité : supprimer les fonctions ajoutées, rétablir `project_sharing`
-- (004500) et `purge_stale_invitations` (004600), la contrainte des
-- notifications (005400), puis supprimer les deux tables.
-- =============================================================================

create table public.project_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  role text not null
    constraint project_share_links_role_check check (role in ('supervisor', 'viewer')),
  token_hash text not null unique
    constraint project_share_links_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.project_share_links is
  'Liens de partage d''un projet. Seule l''empreinte du jeton est conservée ; un lien ne donne aucun droit.';
create index project_share_links_project_id_idx on public.project_share_links (project_id);

create table public.project_access_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    constraint project_access_requests_role_check check (role in ('supervisor', 'viewer')),
  status text not null default 'pending'
    constraint project_access_requests_status_check check (status in ('pending', 'approved', 'refused')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
comment on table public.project_access_requests is
  'Demandes de suivi d''un projet, faites par lien, en attente de l''accord du propriétaire.';
create unique index project_access_requests_pending_idx
  on public.project_access_requests (project_id, user_id) where status = 'pending';
create index project_access_requests_user_id_idx on public.project_access_requests (user_id);

alter table public.project_share_links enable row level security;
alter table public.project_share_links force row level security;
alter table public.project_access_requests enable row level security;
alter table public.project_access_requests force row level security;
revoke all on public.project_share_links from public, anon, authenticated, service_role;
revoke all on public.project_access_requests from public, anon, authenticated, service_role;

-- Le propriétaire est averti d'une demande.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment', 'reply', 'version_submitted', 'version_decided', 'task_added', 'access_requested'));

-- -----------------------------------------------------------------------------
-- Propriétaire : créer et révoquer le lien
-- -----------------------------------------------------------------------------
-- Un seul lien actif par projet : en créer un révoque le précédent.
create function private.create_project_link(p_project_id uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_token text;
begin
  perform private.require_own_project(p_project_id);
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_role := coalesce(p ->> 'role', '');
  if v_role not in ('supervisor', 'viewer') then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Dix liens par jour et par compte.
  perform private.consume_user_quota('project-link', 10, 86400);
  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || p_project_id::text, 0));

  update public.project_share_links l set revoked_at = now()
  where l.project_id = p_project_id and l.revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.project_share_links (project_id, role, token_hash, expires_at)
  values (p_project_id, v_role, private.invitation_token_hash(v_token), now() + interval '7 days');
  return v_token;
end
$$;

create function private.revoke_project_link(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_project(p_project_id);
  update public.project_share_links l set revoked_at = now()
  where l.project_id = p_project_id and l.revoked_at is null;
end
$$;

-- -----------------------------------------------------------------------------
-- Demandeur : demander à suivre le projet que désigne un lien
-- -----------------------------------------------------------------------------
-- Ne rend rien et ne lève rien selon le lien : valable ou non, la réponse est
-- la même. Sans effet pour le propriétaire, pour qui est déjà membre, pour qui
-- a déjà une demande en attente, ou quand vingt demandes attendent déjà.
create function private.request_project_access(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.project_share_links;
  v_owner uuid;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  -- Dix demandes par jour et par compte ; une demande sans suite est comptée aussi.
  perform private.consume_user_quota('project-access-request', 10, 86400);
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select l.* into v_link
  from public.project_share_links l
  join public.research_projects r on r.id = l.project_id
  where l.token_hash = private.invitation_token_hash(p_token)
    and l.revoked_at is null and l.expires_at > now() and r.deleted_at is null;
  if v_link.id is null then
    return;
  end if;
  select r.owner_id into v_owner from public.research_projects r where r.id = v_link.project_id;
  if v_owner = v_uid
     or exists (select 1 from public.research_project_members m
                where m.project_id = v_link.project_id and m.user_id = v_uid) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || v_link.project_id::text, 0));
  if (select count(*) from public.project_access_requests q
      where q.project_id = v_link.project_id and q.status = 'pending') >= 20 then
    return;
  end if;
  insert into public.project_access_requests (project_id, user_id, role)
  values (v_link.project_id, v_uid, v_link.role)
  on conflict (project_id, user_id) where status = 'pending' do nothing;
  if found then
    perform private.notify(v_owner, v_uid, 'access_requested', v_link.project_id);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Propriétaire : accepter ou refuser une demande
-- -----------------------------------------------------------------------------
create function private.decide_access_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.project_access_requests;
begin
  if p_approve is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select q.* into v_request
  from public.project_access_requests q
  join public.research_projects r on r.id = q.project_id
  where q.id = p_request_id and q.status = 'pending'
    and r.owner_id = (select auth.uid()) and r.deleted_at is null;
  if v_request.id is null then
    perform private.fail('not_found');
  end if;
  perform private.require_own_project(v_request.project_id);
  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || v_request.project_id::text, 0));

  update public.project_access_requests q
  set status = case when p_approve then 'approved' else 'refused' end, decided_at = now()
  where q.id = v_request.id and q.status = 'pending';
  if not found then
    perform private.fail('not_found');
  end if;
  if not p_approve then
    return;
  end if;

  if (select count(*) from public.research_project_members m
      where m.project_id = v_request.project_id) >= 10 then
    perform private.fail('limit_reached');
  end if;
  insert into public.research_project_members (project_id, user_id, role, full_access, invited_by)
  values (v_request.project_id, v_request.user_id, v_request.role, true, (select auth.uid()))
  on conflict (project_id, user_id) do nothing;
  perform private.write_audit(
    'security', 'project.shared', (select auth.uid()), (select auth.uid()), null,
    'research_projects', v_request.project_id::text,
    jsonb_build_object('role', v_request.role, 'full_access', true, 'by', 'link')
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Ce que le propriétaire voit du partage : membres et leur portée, invitations,
-- lien actif, demandes en attente
-- -----------------------------------------------------------------------------
create or replace function private.project_sharing(p_project_id uuid)
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
        'user_id', m.user_id, 'email', u.email, 'role', m.role, 'joined_at', m.created_at,
        'full_access', m.full_access,
        'section_ids', coalesce((
          select jsonb_agg(x.section_id)
          from public.research_project_member_sections x
          where x.project_id = m.project_id and x.user_id = m.user_id
        ), '[]'::jsonb)
      ) order by m.created_at, m.user_id)
      from public.research_project_members m
      join auth.users u on u.id = m.user_id
      where m.project_id = p_project_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'expires_at', i.expires_at,
        'created_at', i.created_at, 'full_access', i.full_access
      ) order by i.created_at, i.id)
      from public.project_invitations i
      where i.project_id = p_project_id and i.status = 'pending' and i.expires_at > now()
    ), '[]'::jsonb),
    -- Le lien actif : son rôle et son terme. Son jeton n'est rendu qu'à sa création.
    'link', (
      select jsonb_build_object('role', l.role, 'expires_at', l.expires_at)
      from public.project_share_links l
      where l.project_id = p_project_id and l.revoked_at is null and l.expires_at > now()
      order by l.created_at desc
      limit 1
    ),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'email', u.email, 'display_name', pp.display_name, 'role', q.role,
        'created_at', q.created_at
      ) order by q.created_at, q.id)
      from public.project_access_requests q
      join auth.users u on u.id = q.user_id
      left join public.profile_public pp on pp.user_id = q.user_id
      where q.project_id = p_project_id and q.status = 'pending'
    ), '[]'::jsonb)
  );
end
$$;

-- Les demandes que l'appelant a faites et qui attendent encore : pour qu'il
-- sache qu'elles sont parties, sans rien apprendre du projet.
create function private.my_pending_access_requests()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.project_access_requests q
  where private.is_account_active() and q.user_id = (select auth.uid()) and q.status = 'pending';
$$;

-- -----------------------------------------------------------------------------
-- Purge : liens expirés ou révoqués, demandes closes, depuis trente jours
-- -----------------------------------------------------------------------------
create or replace function private.purge_stale_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_more integer;
begin
  if session_user <> 'postgres' then
    perform private.fail('forbidden', '42501');
  end if;
  delete from public.project_invitations i
  where greatest(i.created_at, least(i.expires_at, now())) < now() - interval '30 days'
    and (i.status <> 'pending' or i.expires_at < now() - interval '30 days');
  get diagnostics v_count = row_count;

  delete from public.project_share_links l
  where coalesce(l.revoked_at, l.expires_at) < now() - interval '30 days';
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;

  -- Une demande restée sans réponse quatre-vingt-dix jours est effacée elle aussi.
  delete from public.project_access_requests q
  where q.decided_at < now() - interval '30 days' or q.created_at < now() - interval '90 days';
  get diagnostics v_more = row_count;
  return v_count + v_more;
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées et droits
-- -----------------------------------------------------------------------------
create function public.create_project_link(project_id uuid, payload jsonb) returns text
language sql security invoker set search_path = ''
as $$ select private.create_project_link(project_id, payload); $$;

create function public.revoke_project_link(project_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.revoke_project_link(project_id); $$;

create function public.request_project_access(token text) returns void
language sql security invoker set search_path = ''
as $$ select private.request_project_access(token); $$;

create function public.decide_access_request(request_id uuid, approve boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.decide_access_request(request_id, approve); $$;

create function public.my_pending_access_requests() returns integer
language sql stable security invoker set search_path = ''
as $$ select private.my_pending_access_requests(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'create_project_link(uuid, jsonb)', 'revoke_project_link(uuid)', 'request_project_access(text)',
    'decide_access_request(uuid, boolean)', 'my_pending_access_requests()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

-- Le changement de portée d'un membre figure parmi les événements rendus au titulaire.
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
      'project.version_erased'
    )
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;
