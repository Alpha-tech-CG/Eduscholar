-- =============================================================================
-- D-01, D-04 : la reprise d'une organisation, définie par des faits durables
-- =============================================================================
-- Seconde relecture de sécurité. Le scénario d'origine (un seul administrateur
-- de plateforme suspend, invite, rétablit) est fermé depuis 007400 ; deux
-- chemins restaient.
--
-- C-1. La reprise se définit par l'ÉTAT, pas par le nombre d'administrateurs.
--      Un administrateur de plateforme pouvait suspendre, attendre le départ du
--      dernier `org_admin` (permis depuis 007400), puis inviter « un premier
--      administrateur ». Désormais :
--        - premier administrateur (ouvert à `platform_admin`) : organisation
--          NON suspendue et SANS AUCUN membre ;
--        - organisation suspendue, quels que soient ses membres : c'est une
--          reprise — `super_admin` seulement, jamais l'auteur de la suspension
--          en cours ;
--        - organisation non suspendue qui a un `org_admin` : `org_admin_exists` ;
--        - organisation non suspendue, des membres, aucun `org_admin` : il faut
--          d'abord la suspendre, pour qu'un motif soit posé
--          (`invalid_transition`).
--
-- C-2. L'interdit de rétablir ne s'éteint plus avec le temps. Le rétablissement
--      est refusé à qui a émis une invitation de plateforme sur l'organisation
--      depuis sa dernière suspension — fait gardé dans
--      `private.organization_decisions` (`recovery_invited`), qui survit à la
--      purge des invitations — et à qui figure comme `invited_by` d'un
--      `org_admin` de l'organisation. Le journal dit si le rétablissement suit
--      une reprise (`organization.reinstated`, `after_recovery`), et la liste
--      des organisations le montre avant (`recovery_since_suspension`).
--
-- C-2 bis. Période d'observation : pendant trente jours après avoir accepté une
--      invitation de reprise, l'administrateur ainsi placé ne retire ni ne
--      rétrograde un `org_admin` qui l'était avant lui. L'échéance est sur son
--      appartenance (`recovery_until`), écrite par la seule fonction
--      d'acceptation ; aucun rôle de l'API ne lit ni n'écrit cette colonne.
--
-- C-3. Auteur de la suspension : seule vaut la décision gardée. Le repli sur
--      `organizations.updated_by` disparaît (un renommage le réécrit). Si
--      l'auteur est inconnu — décision absente, ou compte supprimé — la reprise
--      reste ouverte à tout `super_admin` : la refuser bloquerait
--      l'organisation pour toujours, et l'auteur inconnu ne peut plus être
--      l'appelant que si aucune décision n'a jamais été gardée, cas antérieur
--      à ces fonctions. La purge ne supprime ni la dernière suspension d'une
--      organisation encore suspendue, ni les invitations de reprise qui l'ont
--      suivie.
--
-- Défense supplémentaire : à l'acceptation, la nature de l'invitation est
-- relue selon l'état de l'organisation. Une invitation « premier
-- administrateur » dont l'organisation est entre-temps devenue une reprise
-- (suspendue, ou dotée de membres) n'est pas acceptée : réponse vide
-- habituelle, invitation révoquée.
--
-- Réversibilité : rétablir les fonctions des migrations 007100 à 007400 ;
-- supprimer la colonne `recovery_until` et la fonction
-- `private.last_suspension_id` ; rétablir la contrainte de 007100 sur
-- `organization_decisions.decision` après avoir supprimé les lignes
-- `recovery_invited`.
-- =============================================================================

alter table private.organization_decisions
  drop constraint organization_decisions_decision_check,
  add constraint organization_decisions_decision_check
    check (decision in ('suspended', 'reinstated', 'dissolved', 'recovery_invited'));

alter table public.organization_members
  add column recovery_until timestamptz;
comment on column public.organization_members.recovery_until is
  'Fin de la période d''observation d''un administrateur entré par une invitation de reprise. Écrite par la seule fonction d''acceptation.';

-- Identifiant de la dernière décision de suspension gardée ; zéro s'il n'y en a pas.
-- L'ordre est celui des identifiants, pas des dates : deux décisions d'une
-- même transaction portent la même date.
create function private.last_suspension_id(p_organization_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(d.id), 0)
  from private.organization_decisions d
  where d.organization_id = p_organization_id and d.decision = 'suspended';
$$;
revoke all on function private.last_suspension_id(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C-1, C-3 : inviter un administrateur
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
  v_members integer;
  v_admins integer;
  v_recovery boolean;
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
  select count(*), count(*) filter (where m.role = 'org_admin')
  into v_members, v_admins
  from public.organization_members m
  where m.organization_id = p_organization_id;

  v_recovery := v_organization.status = 'suspended';
  if not v_recovery then
    if v_admins > 0 then
      perform private.fail('org_admin_exists');
    end if;
    -- Des membres, aucun administrateur : c'est une reprise, qui exige d'abord
    -- une suspension motivée.
    if v_members > 0 then
      perform private.fail('invalid_transition', '22023');
    end if;
  else
    -- Reprise : super-administrateur seulement, et jamais l'auteur de la
    -- suspension en cours, d'après la seule décision gardée. Auteur inconnu
    -- (décision absente, compte supprimé) : tout super-administrateur peut
    -- reprendre, faute de quoi l'organisation resterait bloquée pour toujours.
    if v_rank < 3 then
      perform private.fail('forbidden', '42501');
    end if;
    if exists (
      select 1 from private.organization_decisions d
      where d.id = private.last_suspension_id(p_organization_id) and d.decided_by = v_uid
    ) then
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

  -- Le fait survit à la purge de l'invitation : il interdit à l'émetteur de
  -- rétablir lui-même l'organisation.
  if v_recovery then
    insert into private.organization_decisions (organization_id, decision, reason, decided_by)
    values (p_organization_id, 'recovery_invited', null, v_uid);
  end if;

  perform private.write_audit(
    'organization', 'organization.admin_invited', v_uid, null, p_organization_id,
    'organization_invitations', v_id::text,
    jsonb_build_object('recovery', v_recovery, 'existing_admin_count', v_admins)
  );
  return v_token;
end
$$;

-- -----------------------------------------------------------------------------
-- C-2 : rétablir
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
  v_after_recovery boolean;
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

  -- Qui a fait entrer un administrateur ne rend pas lui-même ses droits à
  -- l'organisation. Deux faits durables, sans borne de temps : une invitation
  -- de reprise émise depuis la dernière suspension ; un administrateur de
  -- l'organisation entré à son invitation.
  if v_reinstating and (
    exists (
      select 1 from private.organization_decisions d
      where d.organization_id = p_organization_id
        and d.decision = 'recovery_invited'
        and d.decided_by = v_uid
        and d.id > private.last_suspension_id(p_organization_id)
    )
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = p_organization_id and m.role = 'org_admin' and m.invited_by = v_uid
    )
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
    v_after_recovery := exists (
      select 1 from private.organization_decisions d
      where d.organization_id = p_organization_id
        and d.decision = 'recovery_invited'
        and d.id > private.last_suspension_id(p_organization_id)
    );
    insert into private.organization_decisions (organization_id, decision, reason, decided_by)
    values (p_organization_id, 'reinstated', v_reason, v_uid);
    perform private.write_audit(
      'organization', 'organization.reinstated', v_uid, null, p_organization_id,
      'organizations', p_organization_id::text,
      jsonb_build_object('after_recovery', v_after_recovery)
    );
  end if;
end
$$;

-- La liste dit si une invitation de reprise a été émise depuis la suspension :
-- le type de retour change, les fonctions sont recréées.
drop function public.admin_list_organizations(integer, integer);
drop function private.admin_list_organizations(integer, integer);

create function private.admin_list_organizations(p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, slug text, name text, status text, country_code text,
  member_count bigint, admin_count bigint, suspension_reason text, created_at timestamptz,
  recovery_since_suspension boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset not between 0 and 100000 then
    perform private.fail('invalid_payload', '22023');
  end if;
  return query
  select o.id, o.slug, o.name, o.status, o.country_code,
         (select count(*) from public.organization_members m where m.organization_id = o.id),
         (select count(*) from public.organization_members m
          where m.organization_id = o.id and m.role = 'org_admin'),
         case when o.status = 'suspended' then (
           select d.reason from private.organization_decisions d
           where d.organization_id = o.id and d.decision = 'suspended'
           order by d.id desc limit 1
         ) end,
         o.created_at,
         o.status = 'suspended' and exists (
           select 1 from private.organization_decisions d
           where d.organization_id = o.id and d.decision = 'recovery_invited'
             and d.id > private.last_suspension_id(o.id)
         )
  from public.organizations o
  order by o.slug, o.id
  limit p_limit offset p_offset;
end
$$;

create function public.admin_list_organizations(page_limit integer default 50, page_offset integer default 0)
returns table (
  id uuid, slug text, name text, status text, country_code text,
  member_count bigint, admin_count bigint, suspension_reason text, created_at timestamptz,
  recovery_since_suspension boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query select * from private.admin_list_organizations(page_limit, page_offset);
exception when insufficient_privilege then
  perform private.refuse_admin_operation('list_organizations', sqlerrm);
end
$$;

revoke all on function private.admin_list_organizations(integer, integer) from public, anon, service_role;
revoke all on function public.admin_list_organizations(integer, integer) from public, anon, service_role;
grant execute on function private.admin_list_organizations(integer, integer) to authenticated;
grant execute on function public.admin_list_organizations(integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Accepter : la nature de l'invitation est relue ; période d'observation
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
  v_status text;
  v_recovery boolean := false;
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

  -- Même ordre de verrous que les fonctions d'administration : la fiche, puis
  -- les appartenances.
  select o.status into v_status
  from public.organizations o where o.id = v_invitation.organization_id
  for share;
  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || v_invitation.organization_id::text, 0));

  if v_invitation.issued_by_platform then
    -- Reprise ou non, selon l'état de l'organisation maintenant.
    v_recovery := v_status = 'suspended' or exists (
      select 1 from public.organization_members m where m.organization_id = v_invitation.organization_id
    );
    -- Émise pour un premier administrateur, devenue une reprise : elle n'a pas
    -- passé les contrôles d'une reprise. Révoquée, même réponse vide.
    if v_recovery and not v_invitation.recovery then
      update public.organization_invitations i set status = 'revoked'
      where i.id = v_invitation.id and i.status = 'pending';
      return null;
    end if;
    v_recovery := v_recovery or v_invitation.recovery;
  end if;

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
    -- administratrice, et son appartenance porte désormais l'émetteur. Entrée
    -- par une reprise, elle est en observation trente jours.
    insert into public.organization_members as m (organization_id, user_id, role, invited_by, recovery_until)
    values (v_invitation.organization_id, v_uid, 'org_admin', v_invitation.created_by,
            case when v_recovery then now() + interval '30 days' end)
    on conflict (organization_id, user_id)
    do update set role = 'org_admin', invited_by = excluded.invited_by,
                  recovery_until = excluded.recovery_until;

    -- Le lien entre l'émetteur et l'acceptant survit à la purge de l'invitation.
    perform private.write_audit(
      'organization', 'organization.admin_invitation_accepted', v_uid, v_uid, v_invitation.organization_id,
      'organization_invitations', v_invitation.id::text,
      jsonb_build_object('issued_by', v_invitation.created_by, 'recovery', v_recovery)
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
-- C-2 bis : l'administrateur de reprise n'évince pas ceux qui l'étaient avant lui
-- -----------------------------------------------------------------------------
-- L'appelant est-il en période d'observation face à cet administrateur ?
create function private.is_recovery_watch_target(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members c
    join public.organization_members t on t.organization_id = c.organization_id
    where c.organization_id = p_organization_id
      and c.user_id = (select auth.uid())
      and c.recovery_until > now()
      and t.user_id = p_user_id
      and t.user_id <> c.user_id
      and t.role = 'org_admin'
      and t.role_granted_at <= c.role_granted_at
  );
$$;
revoke all on function private.is_recovery_watch_target(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.set_org_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
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
  -- En observation, l'administrateur de reprise ne rétrograde pas un
  -- administrateur qui l'était avant lui.
  if private.is_recovery_watch_target(p_organization_id, p_user_id) then
    perform private.fail('forbidden', '42501');
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

create or replace function private.remove_org_member(p_organization_id uuid, p_user_id uuid)
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

  -- En observation, l'administrateur de reprise ne retire pas un
  -- administrateur qui l'était avant lui.
  if private.is_recovery_watch_target(p_organization_id, p_user_id) then
    perform private.fail('forbidden', '42501');
  end if;

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
  -- Une invitation encore en attente à son adresse le ferait revenir : elle est
  -- annulée. Celle de la plateforme n'est pas à la main de l'organisation.
  update public.organization_invitations i set status = 'revoked'
  where i.organization_id = p_organization_id and i.status = 'pending' and not i.issued_by_platform
    and i.email = (select lower(u.email) from auth.users u where u.id = p_user_id);
end
$$;

-- -----------------------------------------------------------------------------
-- C-3 : la purge garde ce qui fonde les règles de reprise
-- -----------------------------------------------------------------------------
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

  -- Trois ans, sauf la dernière suspension d'une organisation encore
  -- suspendue et les invitations de reprise qui l'ont suivie.
  delete from private.organization_decisions d
  where d.decided_at < now() - interval '3 years'
    and not (
      d.decision in ('suspended', 'recovery_invited')
      and d.id >= private.last_suspension_id(d.organization_id)
      and exists (
        select 1 from public.organizations o
        where o.id = d.organization_id and o.status = 'suspended'
      )
    );
  delete from private.organization_departures d where d.left_at < now() - interval '90 days';
  return v_count;
end
$$;
