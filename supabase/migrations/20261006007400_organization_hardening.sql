-- =============================================================================
-- D-01, D-04 : corrections de la revue de sécurité du lot organisations
-- =============================================================================
-- Constat élevé (E-1) : « suspendre, inviter un administrateur, rétablir »
-- était à la main d'un seul administrateur de plateforme, qui pouvait ainsi
-- placer un complice dans n'importe quelle organisation. Désormais :
--
--   a. `admin_invite_org_admin` distingue deux cas. PREMIER administrateur
--      (l'organisation n'a aucun `org_admin`) : `platform_admin` ou
--      `super_admin`, comme avant. REPRISE (organisation suspendue qui a déjà
--      un `org_admin`) : `super_admin` seulement, et jamais celui qui a
--      prononcé la suspension en cours ; sinon `forbidden` ;
--   b. rétablir une organisation suspendue exige un motif, gardé comme celui de
--      la suspension, et n'est pas permis à celui qui y a émis une invitation
--      de reprise encore en attente, ou acceptée depuis moins de trente jours.
--      Une reprise demande donc au moins deux personnes ;
--   c. le journal dit si l'invitation est une reprise et combien
--      d'administrateurs étaient en place (`organization.admin_invited`), puis
--      relie l'acceptant à l'émetteur (`organization.admin_invitation_accepted`)
--      — lien qui survit à la purge de l'invitation. Un membre promu par une
--      invitation de plateforme porte l'émetteur dans `invited_by` ;
--   d. `org_members` dit aux administrateurs en place qu'une invitation de
--      plateforme est en attente, sans adresse ni identité ;
--   e. une invitation de plateforme ne va jamais à un compte qui détient un
--      rôle de plateforme : refusée à l'émission et à l'acceptation.
--
-- Constats moyens :
--   M-1. le dernier `org_admin` d'une organisation SUSPENDUE peut la quitter,
--        et supprimer son compte : l'organisation devient « sans
--        administrateur », cas du premier administrateur. Hors suspension, la
--        règle est inchangée. `account_deletion_check` suit la même règle que
--        le déclencheur ;
--   M-2. `own_organization` vaut aussi pour qui a été membre dans les trente
--        derniers jours : les départs sont gardés quatre-vingt-dix jours dans
--        une table interne, alimentée par déclencheur ;
--   M-3. le compteur « trois par jour vers une adresse » des invitations de
--        plateforme a sa propre clé : un `org_admin` ne bloque pas une reprise
--        en saturant celui d'une adresse.
--
-- Constats faibles :
--   F-1. le marqueur de dissolution disparaît de `protect_last_org_admin` : la
--        dissolution n'a lieu que dans une organisation suspendue, où la règle
--        M-1 laisse déjà partir le dernier administrateur. Un marqueur posé à
--        la main n'ouvre donc rien ;
--   F-2. à la suppression d'un compte, les invitations en attente à son adresse
--        sont effacées ;
--   F-3. accepter une invitation au rôle `org_admin` exige une session au
--        second facteur présenté ;
--   F-8. inventaire des clés étrangères vers `public.organizations`, et ce que
--        la dissolution en fait :
--          - `resources.organization_id` (RESTRICT) : dissolution refusée tant
--            qu'il reste une ressource (`organization_has_resources`) ;
--          - `organization_members.organization_id` (RESTRICT) : appartenances
--            supprimées par la fonction, avant l'organisation ;
--          - `organization_invitations.organization_id` (CASCADE) ;
--          - `private.organization_departures.organization_id` (CASCADE),
--            créée ici.
--        `audit_logs.organization_id` et
--        `private.organization_decisions.organization_id` n'ont volontairement
--        pas de clé : ils survivent à l'organisation. Le test 29 tient cette
--        liste fermée : une nouvelle clé oblige à revoir la dissolution.
--
-- Réversibilité : rétablir les fonctions des migrations 007100 à 007300 et
-- `account_deletion_check` (002900) ; supprimer la table
-- `private.organization_departures`, son déclencheur, et les colonnes
-- `recovery` et `accepted_at`.
-- =============================================================================

alter table public.organization_invitations
  add column recovery boolean not null default false,
  add column accepted_at timestamptz,
  add constraint organization_invitations_recovery_check
    check (not recovery or issued_by_platform);
comment on column public.organization_invitations.recovery is
  'Invitation de plateforme émise alors que l''organisation, suspendue, avait déjà un administrateur.';

-- -----------------------------------------------------------------------------
-- M-2 : trace durable des départs
-- -----------------------------------------------------------------------------
create table private.organization_departures (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Sans clé étrangère : effacée par le déclencheur de suppression du compte.
  user_id uuid not null,
  left_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
comment on table private.organization_departures is
  'Dernier départ d''un membre d''une organisation. Sert à refuser l''administration par la plateforme à qui vient d''en être membre ; gardée quatre-vingt-dix jours.';
create index organization_departures_user_idx on private.organization_departures (user_id);

alter table private.organization_departures enable row level security;
alter table private.organization_departures force row level security;
revoke all on private.organization_departures from public, anon, authenticated, service_role;

create function private.record_organization_departure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Compte en cours de suppression : rien à garder de lui.
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    insert into private.organization_departures as d (organization_id, user_id, left_at)
    values (old.organization_id, old.user_id, now())
    on conflict (organization_id, user_id) do update set left_at = excluded.left_at;
  end if;
  return old;
end
$$;
revoke all on function private.record_organization_departure() from public, anon, authenticated, service_role;

create trigger organization_members_record_departure
  after delete on public.organization_members
  for each row execute function private.record_organization_departure();

create or replace function private.lock_foreign_organization(p_organization_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization public.organizations;
begin
  select o.* into v_organization
  from public.organizations o
  where o.id = p_organization_id
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  -- Membre, ou membre il y a moins de trente jours.
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
  ) or exists (
    select 1 from private.organization_departures d
    where d.organization_id = p_organization_id and d.user_id = (select auth.uid())
      and d.left_at > now() - interval '30 days'
  ) then
    perform private.fail('own_organization', '42501');
  end if;
  return v_organization;
end
$$;

-- -----------------------------------------------------------------------------
-- M-1, F-1 : le dernier administrateur
-- -----------------------------------------------------------------------------
create or replace function private.protect_last_org_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if old.role <> 'org_admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'org_admin' then
    return new;
  end if;

  select o.status into v_status
  from public.organizations o
  where o.id = old.organization_id
  for no key update;

  -- Organisation suspendue : plus aucun droit ne s'y exerce, le dernier
  -- administrateur peut partir (départ, suppression de compte, dissolution).
  -- Il ne s'y rétrograde pas pour autant.
  if tg_op = 'DELETE' and v_status = 'suspended' then
    return old;
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.organization_id = old.organization_id
      and m.role = 'org_admin'
      and m.user_id <> old.user_id
  ) then
    raise exception 'Une organisation doit conserver au moins un administrateur.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end
$$;

create or replace function private.account_deletion_check()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_account_active() then
    return 'forbidden';
  end if;

  -- Même règle que le déclencheur : une organisation suspendue ne retient pas
  -- son dernier administrateur.
  if exists (
    select 1
    from public.organization_members m
    join public.organizations g on g.id = m.organization_id
    where m.user_id = v_uid
      and m.role = 'org_admin'
      and g.status <> 'suspended'
      and not exists (
        select 1
        from public.organization_members o
        where o.organization_id = m.organization_id
          and o.role = 'org_admin'
          and o.user_id <> v_uid
      )
  ) then
    return 'last_org_admin';
  end if;

  if exists (select 1 from public.platform_roles r where r.user_id = v_uid and r.role = 'super_admin')
     and private.effective_super_admin_count(v_uid) = 0 then
    return 'last_super_admin';
  end if;

  perform private.write_audit(
    'security', 'account.deletion_requested', v_uid, v_uid, null,
    'profiles', v_uid::text, '{}'::jsonb
  );
  return 'ok';
end
$$;

-- -----------------------------------------------------------------------------
-- E-1 b : rétablir exige un motif, et une autre personne que l'émetteur d'une reprise
-- -----------------------------------------------------------------------------
create or replace function private.admin_set_organization_status(
  p_organization_id uuid, p_status text, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_organization public.organizations;
  v_reinstating boolean;
begin
  perform private.require_admin();
  if p_organization_id is null or p_status is null or p_status not in ('verified', 'suspended') then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_organization := private.lock_foreign_organization(p_organization_id);

  -- pending→verified, verified→suspended, suspended→verified, pending→suspended.
  if v_organization.status = p_status
     or (v_organization.status, p_status) not in (
       ('pending', 'verified'), ('verified', 'suspended'),
       ('suspended', 'verified'), ('pending', 'suspended')
     ) then
    perform private.fail('invalid_transition', '22023');
  end if;
  v_reinstating := v_organization.status = 'suspended';

  -- Celui qui a invité un administrateur de reprise ne rend pas lui-même ses
  -- droits à l'organisation.
  if v_reinstating and exists (
    select 1 from public.organization_invitations i
    where i.organization_id = p_organization_id
      and i.recovery
      and i.created_by = v_uid
      and ((i.status = 'pending' and i.expires_at > now())
           or (i.status = 'accepted' and coalesce(i.accepted_at, i.created_at) > now() - interval '30 days'))
  ) then
    perform private.fail('forbidden', '42501');
  end if;

  if (p_status = 'suspended' or v_reinstating) and v_reason is null then
    perform private.fail('reason_required', '22023');
  end if;
  if v_reason is not null and not private.is_clean_long_text(v_reason, 500) then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Soixante décisions par heure et par administrateur.
  perform private.consume_user_quota('org-status', 60, 3600);

  update public.organizations o set status = p_status where o.id = p_organization_id;

  -- Le motif ne va pas au journal d'audit, qui ne retient que la transition.
  if p_status = 'suspended' then
    insert into private.organization_decisions (organization_id, decision, reason, decided_by)
    values (p_organization_id, 'suspended', v_reason, v_uid);
  elsif v_reinstating then
    insert into private.organization_decisions (organization_id, decision, reason, decided_by)
    values (p_organization_id, 'reinstated', v_reason, v_uid);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- E-1 a, c, e ; M-3 : inviter un administrateur
-- -----------------------------------------------------------------------------
create or replace function private.admin_invite_org_admin(p_organization_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer := private.require_admin();
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_organization public.organizations;
  v_admins integer;
  v_recovery boolean;
  v_suspended_by uuid;
  v_token text;
  v_hits integer;
  v_id uuid;
begin
  if p_organization_id is null
     or char_length(v_email) not between 6 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Jamais soi-même.
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    perform private.fail('own_account', '42501');
  end if;
  -- Jamais un compte qui détient un rôle de plateforme. Ce refus ne dit pas si
  -- une adresse quelconque a un compte : il dit seulement « cette adresse est
  -- celle d'un détenteur de rôle de la plateforme », à un administrateur qui
  -- peut déjà en lire la liste (`admin_list_accounts`). Toute autre adresse,
  -- avec ou sans compte, reçoit la même réponse.
  if exists (
    select 1 from auth.users u
    join public.platform_roles r on r.user_id = u.id
    where lower(u.email) = v_email
  ) then
    perform private.fail('forbidden', '42501');
  end if;

  v_organization := private.lock_foreign_organization(p_organization_id);
  select count(*) into v_admins
  from public.organization_members m
  where m.organization_id = p_organization_id and m.role = 'org_admin';

  if v_admins > 0 and v_organization.status <> 'suspended' then
    perform private.fail('org_admin_exists');
  end if;
  v_recovery := v_admins > 0;

  if v_recovery then
    -- Reprise : super-administrateur seulement, et jamais celui qui a prononcé
    -- la suspension en cours. Sans décision gardée (suspension antérieure à ces
    -- fonctions), l'auteur de la dernière écriture de la fiche en tient lieu.
    if v_rank < 3 then
      perform private.fail('forbidden', '42501');
    end if;
    select d.decided_by into v_suspended_by
    from private.organization_decisions d
    where d.organization_id = p_organization_id and d.decision = 'suspended'
    order by d.decided_at desc, d.id desc
    limit 1;
    if not found then
      v_suspended_by := v_organization.updated_by;
    end if;
    if v_suspended_by = v_uid then
      perform private.fail('forbidden', '42501');
    end if;
  end if;

  -- Trente invitations par heure et par administrateur.
  perform private.consume_user_quota('org-admin-invite', 30, 3600);

  -- Trois invitations de plateforme par jour vers une même adresse. Compteur
  -- distinct de celui des invitations ordinaires, qu'un administrateur
  -- d'organisation pourrait saturer pour empêcher une reprise.
  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (
    'org-admin-invite:to:' || left(encode(sha256(convert_to('org-admin-invite:' || v_email, 'UTF8')), 'hex'), 40),
    date_trunc('day', now(), 'UTC'), 1
  )
  on conflict (bucket_key, window_start) do update set hits = b.hits + 1
  returning b.hits into v_hits;
  if v_hits > 3 then
    perform private.fail('rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || p_organization_id::text, 0));

  -- Une seule invitation de plateforme en attente par organisation.
  update public.organization_invitations i set status = 'revoked'
  where i.organization_id = p_organization_id and i.issued_by_platform and i.status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.organization_invitations
    (organization_id, email, role, token_hash, expires_at, created_by, issued_by_platform, recovery)
  values (p_organization_id, v_email, 'org_admin', private.invitation_token_hash(v_token),
          now() + interval '7 days', v_uid, true, v_recovery)
  returning id into v_id;

  perform private.write_audit(
    'organization', 'organization.admin_invited', v_uid, null, p_organization_id,
    'organization_invitations', v_id::text,
    jsonb_build_object('recovery', v_recovery, 'existing_admin_count', v_admins)
  );
  return v_token;
end
$$;

-- -----------------------------------------------------------------------------
-- E-1 c, e ; F-3 : accepter
-- -----------------------------------------------------------------------------
create or replace function private.accept_org_invitation(p_token text)
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
  -- Les refus qui suivent ne sont dits qu'à l'invitée légitime.
  -- Un détenteur de rôle de plateforme n'entre pas par une invitation de plateforme.
  if v_invitation.issued_by_platform and exists (
    select 1 from public.platform_roles r where r.user_id = v_uid
  ) then
    perform private.fail('forbidden', '42501');
  end if;
  if v_invitation.role = 'org_admin' then
    -- Sans second facteur, le rôle serait sans effet.
    if not exists (
      select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified'
    ) then
      perform private.fail('second_factor_missing', '42501');
    end if;
    -- Et il se présente dans la session qui accepte.
    if not private.is_session_aal2() then
      perform private.fail('forbidden', '42501');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || v_invitation.organization_id::text, 0));
  -- Le jeton ne sert qu'une fois : relu sous le verrou.
  update public.organization_invitations i
  set status = 'accepted', accepted_by = v_uid, accepted_at = now()
  where i.id = v_invitation.id and i.status = 'pending';
  if not found then
    return null;
  end if;
  -- Mille membres par organisation.
  if (select count(*) from public.organization_members m
      where m.organization_id = v_invitation.organization_id and m.user_id <> v_uid) >= 1000 then
    perform private.fail('limit_reached');
  end if;

  if v_invitation.issued_by_platform then
    -- Invitation de plateforme : la personne déjà membre devient
    -- administratrice, et son appartenance porte désormais l'émetteur.
    insert into public.organization_members as m (organization_id, user_id, role, invited_by)
    values (v_invitation.organization_id, v_uid, 'org_admin', v_invitation.created_by)
    on conflict (organization_id, user_id)
    do update set role = 'org_admin', invited_by = excluded.invited_by;

    -- Le lien entre l'émetteur et l'acceptant survit à la purge de l'invitation.
    perform private.write_audit(
      'organization', 'organization.admin_invitation_accepted', v_uid, v_uid, v_invitation.organization_id,
      'organization_invitations', v_invitation.id::text,
      jsonb_build_object('issued_by', v_invitation.created_by, 'recovery', v_invitation.recovery)
    );
  else
    -- Déjà membre : son rôle ne change pas par une invitation ordinaire.
    insert into public.organization_members (organization_id, user_id, role, invited_by)
    values (v_invitation.organization_id, v_uid, v_invitation.role, v_invitation.created_by)
    on conflict (organization_id, user_id) do nothing;
  end if;

  return v_invitation.organization_id;
end
$$;

-- -----------------------------------------------------------------------------
-- E-1 d : les administrateurs en place savent qu'une invitation de plateforme attend
-- -----------------------------------------------------------------------------
create or replace function private.org_members(p_organization_id uuid)
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
          and not i.issued_by_platform
        order by i.created_at, i.id
        limit 100
      ) q
    ), '[]'::jsonb),
    -- Ni adresse ni identité : seulement le fait.
    'platform_invitation_pending', exists (
      select 1 from public.organization_invitations i
      where i.organization_id = p_organization_id and i.issued_by_platform
        and i.status = 'pending' and i.expires_at > now()
    )
  );
end
$$;

-- -----------------------------------------------------------------------------
-- F-2 : suppression d'un compte ; conservation
-- -----------------------------------------------------------------------------
create or replace function private.anonymize_departed_org_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.organization_decisions d set decided_by = null where d.decided_by = old.id;
  delete from private.organization_departures d where d.user_id = old.id;
  -- Les invitations qu'il a acceptées, et celles qui l'attendent encore,
  -- portent son adresse : elles partent.
  delete from public.organization_invitations i
  where i.accepted_by = old.id
     or (i.status = 'pending' and old.email is not null and i.email = lower(old.email));
  -- Celles qu'il a émises restent, sans son identifiant.
  update public.organization_invitations i set created_by = null where i.created_by = old.id;
  return old;
end
$$;

create or replace function private.purge_stale_org_invitations()
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
  delete from private.organization_departures d where d.left_at < now() - interval '90 days';
  return v_count;
end
$$;
