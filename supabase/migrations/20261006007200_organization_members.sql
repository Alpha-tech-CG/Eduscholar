-- =============================================================================
-- D-01, D-04 : membres et invitations d'une organisation
-- =============================================================================
-- Versant « organisation » de la migration 007100 (modèle d'autorisation §2.2
-- et matrice §5.5). On ne devient membre que par une invitation acceptée.
--
--   - inviter, révoquer une invitation, changer un rôle, retirer un membre,
--     lire la liste des membres : `org_admin` de CETTE organisation, compte
--     actif au profil complété, organisation non suspendue
--     (`private.has_org_role`, qui exige aussi le second facteur présenté).
--     Toute autre situation — organisation inconnue, autre organisation, autre
--     rôle, organisation suspendue, administrateur de plateforme — reçoit le
--     même refus `forbidden` ;
--   - invitation par adresse, sur le modèle du partage d'un projet (004500,
--     004600) : jeton de 64 caractères hexadécimaux rendu une seule fois, dont
--     la base ne garde que l'empreinte ; sept jours ; trente invitations par
--     jour et par compte ; trois par jour vers une même adresse, tous
--     expéditeurs confondus ; cinquante en attente par organisation. La réponse
--     ne dit pas si l'adresse a un compte, ni si elle est déjà membre ;
--   - accepter : seulement sous l'adresse invitée, confirmée, profil complété.
--     Jeton inconnu, mal formé, expiré, révoqué, déjà utilisé, destiné à une
--     autre adresse, organisation suspendue : même réponse vide, sans erreur.
--     Seule l'invitée légitime à un rôle `org_admin` apprend qu'il lui faut
--     d'abord un second facteur (`second_factor_missing`) : sans lui, le rôle
--     resterait sans effet. Une personne déjà membre garde son rôle : un rôle
--     ne se change que par `set_org_member_role` ;
--   - le dernier `org_admin` n'est ni retiré, ni rétrogradé, ni parti : la
--     règle reste tenue par le déclencheur `protect_last_org_admin`, dont le
--     refus est rendu sous le code `last_org_admin` ;
--   - quitter une organisation reste possible quand elle est suspendue ;
--   - journal d'audit : les appartenances y sont inscrites par le déclencheur
--     existant de la table (rôle seulement) ; l'invitation et sa révocation
--     par une ligne qui ne porte que le rôle. Jamais d'adresse.
--
-- Conservation : les invitations closes ou expirées depuis trente jours sont
-- effacées chaque nuit — elles portent l'adresse de tiers ; les motifs des
-- décisions sur les organisations (007100), après trois ans.
--
-- Suppression d'un compte : ses appartenances partent (cascade existante) ;
-- les invitations qu'il a émises restent, sans son identifiant ; celles qu'il
-- a acceptées, qui portent son adresse, sont effacées. Elle n'est jamais
-- bloquée par ces tables. La règle existante n'est pas changée : le compte du
-- dernier `org_admin` d'une organisation ne se supprime pas tant que
-- l'administration n'a pas été transmise (`account_deletion_check` répond
-- `last_org_admin`, et le déclencheur refuse la suppression).
--
-- Réversibilité : supprimer les fonctions, la tâche planifiée
-- `eduscholar-org-invitations-purge` et la table `organization_invitations` ;
-- rétablir `private.anonymize_departed_org_actor` de la migration 007100.
-- =============================================================================

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null
    constraint organization_invitations_email_check
      check (email = lower(email) and char_length(email) between 6 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role text not null
    constraint organization_invitations_role_check
      check (role in ('org_admin', 'librarian', 'teacher', 'member')),
  token_hash text not null
    constraint organization_invitations_token_hash_key unique
    constraint organization_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  status text not null default 'pending'
    constraint organization_invitations_status_check check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
comment on table public.organization_invitations is
  'Invitations à rejoindre une organisation. Seule l''empreinte du jeton est conservée.';
comment on column public.organization_invitations.created_by is
  'Qui a invité. Simple identifiant, sans clé étrangère : mis à vide si le compte disparaît.';
comment on column public.organization_invitations.accepted_by is
  'Qui a accepté. Simple identifiant, sans clé étrangère.';
create index organization_invitations_organization_idx
  on public.organization_invitations (organization_id, status);
create index organization_invitations_accepted_by_idx
  on public.organization_invitations (accepted_by) where accepted_by is not null;
create index organization_invitations_created_by_idx
  on public.organization_invitations (created_by) where created_by is not null;

alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;
-- Aucune lecture ni écriture directe : tout passe par les fonctions ci-dessous.
revoke all on public.organization_invitations from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Appuis
-- -----------------------------------------------------------------------------
-- Administrateur de cette organisation, ou le même refus pour tout autre cas.
create function private.require_org_admin(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or p_organization_id is null
     or not private.is_account_active()
     or not private.is_onboarded()
     or not private.has_org_role(p_organization_id, array['org_admin']) then
    perform private.fail('forbidden', '42501');
  end if;
end
$$;

-- L'invitation que désigne un jeton, si elle est en attente, non expirée, pour
-- une organisation non suspendue, et adressée à l'adresse confirmée de
-- l'appelant. Sinon rien, sans distinction entre les cas.
create function private.matching_org_invitation(p_token text)
returns public.organization_invitations
language sql
stable
security definer
set search_path = ''
as $$
  select i.*
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  join auth.users u on u.id = (select auth.uid())
  where private.is_account_active()
    and private.is_onboarded()
    and p_token ~ '^[0-9a-f]{64}$'
    and i.token_hash = private.invitation_token_hash(p_token)
    and i.status = 'pending'
    and i.expires_at > now()
    and o.status <> 'suspended'
    and u.email_confirmed_at is not null
    and lower(u.email) = i.email;
$$;

revoke all on function private.require_org_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function private.matching_org_invitation(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- `org_admin` : inviter, révoquer, changer un rôle, retirer, lire
-- -----------------------------------------------------------------------------
create function private.invite_org_member(p_organization_id uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_role text;
  v_token text;
  v_hits integer;
  v_id uuid;
begin
  perform private.require_org_admin(p_organization_id);
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_email := lower(btrim(coalesce(p ->> 'email', '')));
  v_role := coalesce(p ->> 'role', '');
  if char_length(v_email) not between 6 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or v_role not in ('org_admin', 'librarian', 'teacher', 'member') then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- On ne s'invite pas soi-même.
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    perform private.fail('own_account', '42501');
  end if;

  -- Trente invitations par jour et par compte.
  perform private.consume_user_quota('org-invite', 30, 86400);

  -- Trois invitations par jour vers une même adresse, tous expéditeurs
  -- confondus. La clé est une empreinte : la table ne retient pas l'adresse.
  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (
    'org-invite:to:' || left(encode(sha256(convert_to('org-invite:' || v_email, 'UTF8')), 'hex'), 40),
    date_trunc('day', now(), 'UTC'), 1
  )
  on conflict (bucket_key, window_start) do update set hits = b.hits + 1
  returning b.hits into v_hits;
  if v_hits > 3 then
    perform private.fail('rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || p_organization_id::text, 0));

  -- Une nouvelle invitation à la même adresse remplace la précédente.
  update public.organization_invitations i set status = 'revoked'
  where i.organization_id = p_organization_id and i.email = v_email and i.status = 'pending';

  -- Cinquante invitations en attente par organisation.
  if (select count(*) from public.organization_invitations i
      where i.organization_id = p_organization_id and i.status = 'pending' and i.expires_at > now()) >= 50 then
    perform private.fail('limit_reached');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at, created_by)
  values (p_organization_id, v_email, v_role, private.invitation_token_hash(v_token), now() + interval '7 days', v_uid)
  returning id into v_id;

  perform private.write_audit(
    'organization', 'organization.member_invited', v_uid, null, p_organization_id,
    'organization_invitations', v_id::text, jsonb_build_object('role', v_role)
  );

  -- La réponse est la même que l'adresse ait un compte ou non, qu'elle soit
  -- déjà membre ou non : rien n'est révélé sur elle.
  return v_token;
end
$$;

create function private.revoke_org_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization uuid;
begin
  if (select auth.uid()) is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  -- Même réponse pour une invitation inconnue, close, ou d'une organisation
  -- que l'appelant n'administre pas.
  select i.organization_id into v_organization
  from public.organization_invitations i
  where i.id = p_invitation_id and i.status = 'pending'
    and private.has_org_role(i.organization_id, array['org_admin']);
  if not found then
    perform private.fail('not_found');
  end if;
  update public.organization_invitations i set status = 'revoked' where i.id = p_invitation_id;
  perform private.write_audit(
    'organization', 'organization.invitation_revoked', (select auth.uid()), null, v_organization,
    'organization_invitations', p_invitation_id::text, '{}'::jsonb
  );
end
$$;

create function private.set_org_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  perform private.require_org_admin(p_organization_id);
  if p_user_id is null or p_role is null
     or p_role not in ('org_admin', 'librarian', 'teacher', 'member') then
    perform private.fail('invalid_payload', '22023');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || p_organization_id::text, 0));

  select m.role into v_current
  from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_current = p_role then
    return;
  end if;
  -- Sans second facteur vérifié, le rôle d'administrateur resterait sans effet.
  if p_role = 'org_admin' and not exists (
    select 1 from auth.mfa_factors f where f.user_id = p_user_id and f.status = 'verified'
  ) then
    perform private.fail('second_factor_missing', '42501');
  end if;

  -- Cent vingt changements par heure et par compte.
  perform private.consume_user_quota('org-member-role', 120, 3600);

  begin
    update public.organization_members m set role = p_role
    where m.organization_id = p_organization_id and m.user_id = p_user_id;
  exception when check_violation then
    perform private.fail('last_org_admin');
  end;
end
$$;

create function private.remove_org_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  perform private.require_org_admin(p_organization_id);
  if p_user_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || p_organization_id::text, 0));

  begin
    delete from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_user_id;
    v_found := found;
  exception when check_violation then
    perform private.fail('last_org_admin');
  end;
  if not v_found then
    perform private.fail('not_found');
  end if;
  -- Une invitation encore en attente à son adresse le ferait revenir : elle est annulée.
  update public.organization_invitations i set status = 'revoked'
  where i.organization_id = p_organization_id and i.status = 'pending'
    and i.email = (select lower(u.email) from auth.users u where u.id = p_user_id);
end
$$;

-- Ce que l'administrateur voit de son organisation : cinq cents membres et cent
-- invitations en attente au plus. L'adresse d'un membre est celle de son compte.
create function private.org_members(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_org_admin(p_organization_id);
  -- Cent vingt lectures par quart d'heure et par compte.
  perform private.consume_user_quota('org-members-read', 120, 900);

  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', q.user_id, 'email', q.email, 'role', q.role, 'joined_at', q.created_at
      ) order by q.created_at, q.user_id)
      from (
        select m.user_id, u.email, m.role, m.created_at
        from public.organization_members m
        join auth.users u on u.id = m.user_id
        where m.organization_id = p_organization_id
        order by m.created_at, m.user_id
        limit 500
      ) q
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'email', q.email, 'role', q.role, 'expires_at', q.expires_at, 'created_at', q.created_at
      ) order by q.created_at, q.id)
      from (
        select i.id, i.email, i.role, i.expires_at, i.created_at
        from public.organization_invitations i
        where i.organization_id = p_organization_id and i.status = 'pending' and i.expires_at > now()
        order by i.created_at, i.id
        limit 100
      ) q
    ), '[]'::jsonb)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Personne invitée, membre : voir l'invitation, l'accepter, quitter, lire
-- -----------------------------------------------------------------------------
create function private.org_invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organization_name', o.name,
    'role', i.role,
    'requires_second_factor', i.role = 'org_admin' and not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  )
  from private.matching_org_invitation(p_token) i
  join public.organizations o on o.id = i.organization_id
  where i.id is not null;
$$;

-- Rend l'identifiant de l'organisation, ou rien si le jeton ne convient pas :
-- un refus ne lève pas d'erreur, pour ne pas distinguer les cas.
create function private.accept_org_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invitation public.organization_invitations;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  -- Trente essais par quart d'heure : un refus est compté, puisqu'il ne lève rien.
  perform private.consume_user_quota('org-invitation-accept', 30, 900);

  select * into v_invitation from private.matching_org_invitation(p_token);
  if v_invitation.id is null then
    return null;
  end if;
  -- Dit à la seule invitée légitime : sans second facteur, le rôle serait sans effet.
  if v_invitation.role = 'org_admin' and not exists (
    select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified'
  ) then
    perform private.fail('second_factor_missing', '42501');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || v_invitation.organization_id::text, 0));
  -- Le jeton ne sert qu'une fois : relu sous le verrou.
  update public.organization_invitations i
  set status = 'accepted', accepted_by = v_uid
  where i.id = v_invitation.id and i.status = 'pending';
  if not found then
    return null;
  end if;
  -- Mille membres par organisation.
  if (select count(*) from public.organization_members m
      where m.organization_id = v_invitation.organization_id and m.user_id <> v_uid) >= 1000 then
    perform private.fail('limit_reached');
  end if;

  -- Déjà membre : son rôle ne change pas par une invitation.
  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (v_invitation.organization_id, v_uid, v_invitation.role, v_invitation.created_by)
  on conflict (organization_id, user_id) do nothing;

  return v_invitation.organization_id;
end
$$;

-- Quitter une organisation, même suspendue. Le dernier `org_admin` ne part pas.
create function private.leave_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_found boolean;
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  begin
    delete from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = v_uid;
    v_found := found;
  exception when check_violation then
    perform private.fail('last_org_admin');
  end;
  if not v_found then
    perform private.fail('not_found');
  end if;
end
$$;

-- Ses appartenances, organisations suspendues comprises (pour pouvoir en partir).
create function private.my_organizations()
returns table (
  organization_id uuid, slug text, name text, status text, role text, joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, o.name, o.status, m.role, m.created_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where private.is_account_active()
    and m.user_id = (select auth.uid())
  order by o.name, o.id
  limit 200;
$$;

-- Copie des données personnelles : ses appartenances.
create function private.my_organization_memberships()
returns table (organization_id uuid, organization_name text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, m.role, m.created_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where private.is_account_active()
    and m.user_id = (select auth.uid())
  order by m.created_at, o.id
  limit 2000;
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées et droits
-- -----------------------------------------------------------------------------
create function public.invite_org_member(organization_id uuid, payload jsonb) returns text
language sql security invoker set search_path = ''
as $$ select private.invite_org_member(organization_id, payload); $$;

create function public.revoke_org_invitation(invitation_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.revoke_org_invitation(invitation_id); $$;

create function public.set_org_member_role(organization_id uuid, user_id uuid, role text) returns void
language sql security invoker set search_path = ''
as $$ select private.set_org_member_role(organization_id, user_id, role); $$;

create function public.remove_org_member(organization_id uuid, user_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.remove_org_member(organization_id, user_id); $$;

create function public.org_members(organization_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.org_members(organization_id); $$;

create function public.org_invitation_preview(token text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select private.org_invitation_preview(token); $$;

create function public.accept_org_invitation(token text) returns uuid
language sql security invoker set search_path = ''
as $$ select private.accept_org_invitation(token); $$;

create function public.leave_organization(organization_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.leave_organization(organization_id); $$;

create function public.my_organizations()
returns table (
  organization_id uuid, slug text, name text, status text, role text, joined_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_organizations(); $$;

create function public.my_organization_memberships()
returns table (organization_id uuid, organization_name text, role text, joined_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_organization_memberships(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'invite_org_member(uuid, jsonb)',
    'revoke_org_invitation(uuid)',
    'set_org_member_role(uuid, uuid, text)',
    'remove_org_member(uuid, uuid)',
    'org_members(uuid)',
    'org_invitation_preview(text)',
    'accept_org_invitation(text)',
    'leave_organization(uuid)',
    'my_organizations()',
    'my_organization_memberships()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Suppression d'un compte
-- -----------------------------------------------------------------------------
create or replace function private.anonymize_departed_org_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.organization_decisions d set decided_by = null where d.decided_by = old.id;
  -- Les invitations qu'il a acceptées portent son adresse : elles partent.
  delete from public.organization_invitations i where i.accepted_by = old.id;
  -- Celles qu'il a émises restent, sans son identifiant.
  update public.organization_invitations i set created_by = null where i.created_by = old.id;
  return old;
end
$$;

-- -----------------------------------------------------------------------------
-- Conservation
-- -----------------------------------------------------------------------------
-- Invitations closes (acceptées, annulées) ou expirées depuis plus de trente
-- jours, et motifs de décision de plus de trois ans : effacés chaque nuit, par
-- le propriétaire de la base seulement.
create function private.purge_stale_org_invitations()
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
  delete from public.organization_invitations i
  where greatest(i.created_at, least(i.expires_at, now())) < now() - interval '30 days'
    and (i.status <> 'pending' or i.expires_at < now() - interval '30 days');
  get diagnostics v_count = row_count;

  delete from private.organization_decisions d where d.decided_at < now() - interval '3 years';
  return v_count;
end
$$;

revoke all on function private.purge_stale_org_invitations() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-org-invitations-purge';
select cron.schedule('eduscholar-org-invitations-purge', '2 4 * * *', 'select private.purge_stale_org_invitations()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-org-invitations-purge' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-org-invitations-purge doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
