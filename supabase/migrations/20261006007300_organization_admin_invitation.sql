-- =============================================================================
-- D-01, D-04 : la plateforme invite un administrateur, elle ne le désigne plus
-- =============================================================================
-- La migration 007100 laissait la plateforme créer d'office l'appartenance du
-- premier `org_admin`. Deux défauts :
--
--   - on ne devient membre que par une invitation acceptée (modèle §2.2) ; la
--     personne désignée, dernier administrateur, ne pouvait en outre ni partir
--     ni supprimer son compte, sans y avoir jamais consenti ;
--   - une organisation dont l'unique administrateur n'était plus joignable ne
--     pouvait pas être reprise.
--
-- `admin_designate_org_admin` est supprimée. `admin_invite_org_admin` émet une
-- invitation au rôle `org_admin`, par la même mécanique que les autres (jeton
-- de 64 caractères hexadécimaux rendu une seule fois, empreinte seule gardée,
-- sept jours, rien n'est dit de l'adresse). Règles :
--
--   - `platform_admin` ou `super_admin`, second facteur récent, non membre de
--     l'organisation, jamais à sa propre adresse ;
--   - permise dans deux cas seulement : l'organisation n'a aucun `org_admin`,
--     ou elle est `suspended` — la plateforme a alors déjà posé un motif, et la
--     suspension a ôté tout droit à ses membres. Sinon : `org_admin_exists` ;
--   - une seule invitation de plateforme en attente par organisation : la
--     nouvelle révoque la précédente ;
--   - l'invitation porte `issued_by_platform`. C'est la seule qui s'accepte
--     dans une organisation suspendue : c'est le chemin de reprise. Une
--     invitation ordinaire y reste refusée ;
--   - les contrôles sur la personne se font à l'acceptation, comme pour toute
--     invitation : adresse confirmée, compte actif, profil complété, second
--     facteur vérifié pour ce rôle ;
--   - la personne déjà membre qui accepte une invitation de plateforme devient
--     `org_admin` (une invitation ordinaire ne change pas un rôle) ;
--   - personne n'est retiré d'office : l'ancien administrateur le reste ;
--   - une invitation de plateforme n'appartient pas à l'organisation : son
--     administrateur ne la voit pas, ne la révoque pas, et ne la remplace pas
--     en invitant la même adresse ;
--   - journal : `organization.admin_invited`, sans adresse.
--
-- Réversibilité : rétablir les fonctions des migrations 007100 et 007200,
-- supprimer `admin_invite_org_admin` et la colonne `issued_by_platform`.
-- =============================================================================

alter table public.organization_invitations
  add column issued_by_platform boolean not null default false,
  add constraint organization_invitations_platform_role_check
    check (not issued_by_platform or role = 'org_admin');
comment on column public.organization_invitations.issued_by_platform is
  'Invitation émise par la plateforme au rôle org_admin : la seule qui s''accepte dans une organisation suspendue.';
create unique index organization_invitations_platform_pending_idx
  on public.organization_invitations (organization_id)
  where issued_by_platform and status = 'pending';

drop function public.admin_designate_org_admin(uuid, uuid);
drop function private.admin_designate_org_admin(uuid, uuid);

-- Listes fermées : l'opération de désignation laisse la place à l'invitation ;
-- les deux codes qui ne servaient qu'à elle disparaissent.
create or replace function private.refuse_admin_operation(p_operation text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := case
    when p_operation in ('find_user', 'set_role', 'set_account_status', 'account_history',
                         'list_accounts', 'auth_events',
                         'create_organization', 'set_organization_status', 'invite_org_admin',
                         'rename_organization', 'dissolve_organization', 'list_organizations')
      then p_operation
    else 'unknown'
  end;
  v_code text := case
    when p_message in ('forbidden', 'recent_second_factor_required', 'own_account',
                       'account_suspended', 'second_factor_missing', 'own_organization') then p_message
    else 'forbidden'
  end;
begin
  perform private.write_admin_refusal(v_operation, v_code, 'database');
  perform set_config('response.status', '403', true);
  return jsonb_build_object('code', '42501', 'message', v_code);
end
$$;

-- -----------------------------------------------------------------------------
-- Plateforme : inviter un administrateur
-- -----------------------------------------------------------------------------
create function private.admin_invite_org_admin(p_organization_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_organization public.organizations;
  v_token text;
  v_hits integer;
  v_id uuid;
begin
  perform private.require_admin();
  if p_organization_id is null
     or char_length(v_email) not between 6 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Jamais soi-même.
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    perform private.fail('own_account', '42501');
  end if;
  v_organization := private.lock_foreign_organization(p_organization_id);
  -- Premier administrateur, ou reprise d'une organisation suspendue.
  if v_organization.status <> 'suspended' and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.role = 'org_admin'
  ) then
    perform private.fail('org_admin_exists');
  end if;

  -- Trente invitations par heure et par administrateur.
  perform private.consume_user_quota('org-admin-invite', 30, 3600);

  -- Trois invitations par jour vers une même adresse, tous expéditeurs
  -- confondus : le compteur est celui des invitations ordinaires.
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

  -- Une seule invitation de plateforme en attente par organisation.
  update public.organization_invitations i set status = 'revoked'
  where i.organization_id = p_organization_id and i.issued_by_platform and i.status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.organization_invitations
    (organization_id, email, role, token_hash, expires_at, created_by, issued_by_platform)
  values (p_organization_id, v_email, 'org_admin', private.invitation_token_hash(v_token),
          now() + interval '7 days', v_uid, true)
  returning id into v_id;

  perform private.write_audit(
    'organization', 'organization.admin_invited', v_uid, null, p_organization_id,
    'organization_invitations', v_id::text, '{}'::jsonb
  );
  return v_token;
end
$$;

-- Succès : { token }. Refus de droit : { code, message }, statut 403.
create function public.admin_invite_org_admin(organization_id uuid, email text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return jsonb_build_object('token', private.admin_invite_org_admin(organization_id, email));
exception when insufficient_privilege then
  return private.refuse_admin_operation('invite_org_admin', sqlerrm);
end
$$;

revoke all on function private.admin_invite_org_admin(uuid, text) from public, anon, service_role;
revoke all on function public.admin_invite_org_admin(uuid, text) from public, anon, service_role;
grant execute on function private.admin_invite_org_admin(uuid, text) to authenticated;
grant execute on function public.admin_invite_org_admin(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Acceptation : l'invitation de plateforme vaut aussi dans une organisation suspendue
-- -----------------------------------------------------------------------------
create or replace function private.matching_org_invitation(p_token text)
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
    and (o.status <> 'suspended' or i.issued_by_platform)
    and u.email_confirmed_at is not null
    and lower(u.email) = i.email;
$$;

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

  if v_invitation.issued_by_platform then
    -- Invitation de plateforme : la personne déjà membre devient administratrice.
    insert into public.organization_members as m (organization_id, user_id, role, invited_by)
    values (v_invitation.organization_id, v_uid, 'org_admin', v_invitation.created_by)
    on conflict (organization_id, user_id) do update set role = 'org_admin';
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
-- L'invitation de plateforme n'appartient pas à l'organisation
-- -----------------------------------------------------------------------------
create or replace function private.invite_org_member(p_organization_id uuid, p jsonb)
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

  -- Une nouvelle invitation à la même adresse remplace la précédente — pas
  -- celle de la plateforme.
  update public.organization_invitations i set status = 'revoked'
  where i.organization_id = p_organization_id and i.email = v_email and i.status = 'pending'
    and not i.issued_by_platform;

  -- Cinquante invitations en attente par organisation.
  if (select count(*) from public.organization_invitations i
      where i.organization_id = p_organization_id and i.status = 'pending' and i.expires_at > now()
        and not i.issued_by_platform) >= 50 then
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

create or replace function private.revoke_org_invitation(p_invitation_id uuid)
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
  -- Même réponse pour une invitation inconnue, close, émise par la plateforme,
  -- ou d'une organisation que l'appelant n'administre pas.
  select i.organization_id into v_organization
  from public.organization_invitations i
  where i.id = p_invitation_id and i.status = 'pending' and not i.issued_by_platform
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
    ), '[]'::jsonb)
  );
end
$$;
