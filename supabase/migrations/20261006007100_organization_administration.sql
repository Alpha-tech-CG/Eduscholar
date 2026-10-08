-- =============================================================================
-- D-01, D-04 : les organisations s'administrent sous la session de l'appelant
-- =============================================================================
-- Jusqu'ici, créer, vérifier ou suspendre une organisation passait par le rôle
-- serveur, qui écrivait dans `organizations` et `organization_members` après un
-- contrôle fait par l'application. Le rôle serveur perd ces écritures : plus
-- aucun chemin n'y écrit hors des fonctions de cette migration et de la
-- suivante (007200, membres et invitations).
--
-- Cette migration porte le versant « plateforme » (modèle d'autorisation §2.2
-- et matrice §5.5) :
--
--   - appelant `platform_admin` ou `super_admin`, second facteur présenté
--     depuis moins de dix minutes (`private.require_admin`) ;
--   - un administrateur n'agit jamais sur une organisation dont il est membre
--     (`own_organization`) ;
--   - création à l'état `pending` ; transitions pending→verified,
--     verified→suspended, suspended→verified, pending→suspended, rien d'autre ;
--   - suspension motivée ; le motif est rangé dans une table interne, jamais au
--     journal d'audit (même règle que pour la suspension d'un compte) ;
--   - désignation du PREMIER `org_admin` seulement (matrice §5.5) : une
--     organisation qui a déjà un administrateur gère elle-même ses rôles, et un
--     administrateur de plateforme ne peut pas s'y ouvrir la liste des membres
--     en y plaçant quelqu'un. Jamais lui-même ; le compte désigné doit être
--     confirmé, non suspendu, au profil complété, et avoir un second facteur
--     vérifié — sans quoi son rôle resterait sans effet (`has_org_role`) ;
--   - renommage (nom, slug) : une organisation vérifiée repasse à `pending` et
--     doit être vérifiée de nouveau (D-04). Une organisation suspendue reste
--     suspendue : renommer ne rend aucun droit ;
--   - chaque refus de droit est capturé, consigné par
--     `private.refuse_admin_operation` et rendu en « 403 » sans lever, comme
--     pour les autres fonctions `admin_*` (D-31).
--
-- Dissolution (D-04) — décision :
--   - elle efface l'organisation, ses appartenances et ses invitations ;
--   - elle n'est possible que depuis l'état `suspended` : l'opération est
--     irréversible, la suspension d'abord retire tous les droits et laisse le
--     temps de se raviser ;
--   - elle est REFUSÉE tant qu'une ressource, quel que soit son statut, est
--     rattachée à l'organisation (`organization_has_resources`). Une ressource
--     doit garder sa provenance : la détacher ou la supprimer en silence la lui
--     ferait perdre, et une ressource réservée (`visibility = organization`)
--     ne peut pas exister sans organisation. Tant qu'il en reste, la voie est
--     la suspension, qui cesse déjà de servir les ressources réservées. La clé
--     étrangère `resources.organization_id` (RESTRICT) reste le filet ;
--   - le motif est gardé dans la table interne, qui survit à l'organisation.
--
-- Deux gardes existantes s'ouvrent pour ces seules fonctions, par un marqueur
-- de transaction (même procédé que `eduscholar.scheduled_purge`) :
--   - le slug ne change que pendant `admin_rename_organization` ;
--   - le dernier `org_admin` ne part que pendant `admin_dissolve_organization`.
-- Le marqueur n'est pas une frontière de sécurité : aucun rôle de l'API n'a de
-- droit d'écriture sur ces tables. Il évite qu'une autre écriture, y compris
-- de maintenance, contourne la règle par mégarde. Hors de ces deux fonctions,
-- le comportement est inchangé, suppression de compte comprise.
--
-- Réversibilité : supprimer les fonctions `admin_*organization*` et
-- `admin_designate_org_admin` ; rétablir `refuse_admin_operation` (006900),
-- `protect_last_org_admin` (000200) et le déclencheur
-- `organizations_prevent_key_change` (000100) ; supprimer la table
-- `private.organization_decisions` ; rendre insert, update et delete sur les
-- deux tables à service_role. Une dissolution, elle, ne se défait pas.
-- =============================================================================

revoke insert, update, delete on public.organizations from service_role;
revoke insert, update, delete on public.organization_members from service_role;

-- -----------------------------------------------------------------------------
-- Motifs des décisions : table interne, hors journal d'audit
-- -----------------------------------------------------------------------------
create table private.organization_decisions (
  id bigint generated always as identity primary key,
  -- Sans clé étrangère : la ligne survit à la dissolution de l'organisation.
  organization_id uuid not null,
  decision text not null
    constraint organization_decisions_decision_check
      check (decision in ('suspended', 'reinstated', 'dissolved')),
  reason text
    constraint organization_decisions_reason_check
      check (reason is null or private.is_clean_long_text(reason, 500)),
  -- Simple identifiant, sans clé étrangère : mis à vide si le compte disparaît.
  decided_by uuid,
  decided_at timestamptz not null default now()
);
comment on table private.organization_decisions is
  'Suspensions, rétablissements et dissolutions d''organisations, avec leur motif. Lue par l''administration seulement ; conservée trois ans.';
create index organization_decisions_organization_idx
  on private.organization_decisions (organization_id, decided_at desc);

alter table private.organization_decisions enable row level security;
alter table private.organization_decisions force row level security;
revoke all on private.organization_decisions from public, anon, authenticated, service_role;

-- La suppression d'un compte n'est jamais bloquée par ces lignes : elles
-- perdent seulement l'identifiant de leur auteur.
create function private.anonymize_departed_org_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.organization_decisions d set decided_by = null where d.decided_by = old.id;
  return old;
end
$$;
revoke all on function private.anonymize_departed_org_actor() from public, anon, authenticated, service_role;

create trigger users_anonymize_departed_org_actor
  before delete on auth.users
  for each row execute function private.anonymize_departed_org_actor();

-- -----------------------------------------------------------------------------
-- Gardes existantes : ouvertes aux seules fonctions de renommage et de dissolution
-- -----------------------------------------------------------------------------
create function private.prevent_organization_key_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'La colonne id de public.organizations ne peut pas être modifiée.'
      using errcode = '42501';
  end if;
  if new.slug is distinct from old.slug
     and coalesce(current_setting('eduscholar.organization_rename', true), '') <> old.id::text then
    raise exception 'La colonne slug de public.organizations ne peut pas être modifiée.'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function private.prevent_organization_key_change() from public, anon, authenticated, service_role;

drop trigger organizations_prevent_key_change on public.organizations;
create trigger organizations_prevent_key_change
  before update on public.organizations
  for each row execute function private.prevent_organization_key_change();

create or replace function private.protect_last_org_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'org_admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'org_admin' then
    return new;
  end if;
  -- Dissolution : l'organisation entière part, son dernier administrateur avec.
  if tg_op = 'DELETE'
     and coalesce(current_setting('eduscholar.organization_dissolution', true), '') = old.organization_id::text then
    return old;
  end if;

  perform 1 from public.organizations o
    where o.id = old.organization_id
    for no key update;

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

-- -----------------------------------------------------------------------------
-- Refus consignés : opérations et codes de ce lot ajoutés aux listes fermées
-- -----------------------------------------------------------------------------
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
                         'create_organization', 'set_organization_status', 'designate_org_admin',
                         'rename_organization', 'dissolve_organization', 'list_organizations')
      then p_operation
    else 'unknown'
  end;
  v_code text := case
    when p_message in ('forbidden', 'recent_second_factor_required', 'own_account',
                       'account_suspended', 'second_factor_missing',
                       'own_organization', 'account_unconfirmed', 'profile_incomplete') then p_message
    else 'forbidden'
  end;
begin
  perform private.write_admin_refusal(v_operation, v_code, 'database');
  perform set_config('response.status', '403', true);
  return jsonb_build_object('code', '42501', 'message', v_code);
end
$$;

-- -----------------------------------------------------------------------------
-- Appuis
-- -----------------------------------------------------------------------------
-- Nom d'organisation : deux à deux cents caractères, sans caractère de contrôle
-- ni de format, sans espace en bordure.
create function private.is_valid_organization_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null
    and char_length(p_name) between 2 and 200
    and p_name = btrim(p_name)
    and p_name !~ '[[:cntrl:]]'
    and private.is_clean_long_text(p_name, 200);
$$;

create function private.is_valid_organization_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug is not null
    and char_length(p_slug) between 2 and 80
    and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

-- Verrouille l'organisation et la rend. Refuse l'administrateur qui en est
-- membre : il ne la vérifie ni ne l'administre (§2.2).
create function private.lock_foreign_organization(p_organization_id uuid)
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
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
  ) then
    perform private.fail('own_organization', '42501');
  end if;
  return v_organization;
end
$$;

revoke all on function private.is_valid_organization_name(text) from public, anon, authenticated, service_role;
revoke all on function private.is_valid_organization_slug(text) from public, anon, authenticated, service_role;
revoke all on function private.lock_foreign_organization(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Plateforme : créer, vérifier, suspendre, désigner, renommer, dissoudre, lister
-- -----------------------------------------------------------------------------
create function private.admin_create_organization(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_slug text;
  v_country text;
  v_id uuid;
begin
  perform private.require_admin();
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_name := btrim(coalesce(p ->> 'name', ''));
  v_slug := coalesce(p ->> 'slug', '');
  v_country := nullif(p ->> 'country_code', '');
  if not private.is_valid_organization_name(v_name)
     or not private.is_valid_organization_slug(v_slug)
     or (v_country is not null and (
       v_country !~ '^[A-Z]{2}$'
       or not exists (select 1 from public.countries c where c.code = v_country)
     )) then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Vingt créations par jour et par administrateur.
  perform private.consume_user_quota('org-create', 20, 86400);

  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    perform private.fail('slug_taken');
  end if;
  begin
    insert into public.organizations (slug, name, country_code, status)
    values (v_slug, v_name, v_country, 'pending')
    returning id into v_id;
  exception when unique_violation then
    perform private.fail('slug_taken');
  end;
  return v_id;
end
$$;

create function private.admin_set_organization_status(
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
  if p_status = 'suspended' and v_reason is null then
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
  elsif v_organization.status = 'suspended' then
    insert into private.organization_decisions (organization_id, decision, reason, decided_by)
    values (p_organization_id, 'reinstated', null, v_uid);
  end if;
end
$$;

create function private.admin_designate_org_admin(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_organization public.organizations;
  v_confirmed boolean;
begin
  perform private.require_admin();
  if p_organization_id is null or p_user_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p_user_id = v_uid then
    perform private.fail('own_account', '42501');
  end if;
  v_organization := private.lock_foreign_organization(p_organization_id);
  if v_organization.status = 'suspended' then
    perform private.fail('invalid_transition', '22023');
  end if;
  -- Le premier administrateur seulement : ensuite, l'organisation gère ses rôles.
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.role = 'org_admin'
  ) then
    perform private.fail('org_admin_exists');
  end if;

  select u.email_confirmed_at is not null into v_confirmed
  from auth.users u where u.id = p_user_id for share;
  if not found then
    perform private.fail('not_found');
  end if;
  if not v_confirmed then
    perform private.fail('account_unconfirmed', '42501');
  end if;
  if exists (select 1 from private.account_status s where s.user_id = p_user_id and s.status = 'suspended') then
    perform private.fail('account_suspended', '42501');
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = p_user_id and p.onboarded_at is not null
  ) then
    perform private.fail('profile_incomplete', '42501');
  end if;
  -- Sans second facteur vérifié, le rôle resterait sans effet.
  if not exists (
    select 1 from auth.mfa_factors f where f.user_id = p_user_id and f.status = 'verified'
  ) then
    perform private.fail('second_factor_missing', '42501');
  end if;

  perform private.consume_user_quota('org-designate', 30, 3600);

  -- Déjà membre : son rôle devient `org_admin` ; sinon l'appartenance est créée.
  insert into public.organization_members as m (organization_id, user_id, role, invited_by)
  values (p_organization_id, p_user_id, 'org_admin', v_uid)
  on conflict (organization_id, user_id) do update set role = 'org_admin';
end
$$;

create function private.admin_rename_organization(p_organization_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization public.organizations;
  v_name text;
  v_slug text;
begin
  perform private.require_admin();
  if p_organization_id is null or jsonb_typeof(p) is distinct from 'object'
     or not (p ? 'name' or p ? 'slug') then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_organization := private.lock_foreign_organization(p_organization_id);

  v_name := case when p ? 'name' then btrim(coalesce(p ->> 'name', '')) else v_organization.name end;
  v_slug := case when p ? 'slug' then coalesce(p ->> 'slug', '') else v_organization.slug end;
  if not private.is_valid_organization_name(v_name) or not private.is_valid_organization_slug(v_slug)
     -- Rien ne change : pas de nouvelle vérification imposée pour rien.
     or (v_name = v_organization.name and v_slug = v_organization.slug) then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Trente renommages par heure et par administrateur.
  perform private.consume_user_quota('org-rename', 30, 3600);

  if exists (select 1 from public.organizations o where o.slug = v_slug and o.id <> p_organization_id) then
    perform private.fail('slug_taken');
  end if;

  perform set_config('eduscholar.organization_rename', p_organization_id::text, true);
  begin
    update public.organizations o
    set name = v_name,
        slug = v_slug,
        -- Vérifiée : à vérifier de nouveau. Suspendue : le reste.
        status = case when o.status = 'verified' then 'pending' else o.status end
    where o.id = p_organization_id;
  exception when unique_violation then
    perform private.fail('slug_taken');
  end;
  perform set_config('eduscholar.organization_rename', '', true);
end
$$;

create function private.admin_dissolve_organization(p_organization_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_organization public.organizations;
begin
  perform private.require_admin();
  if p_organization_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_organization := private.lock_foreign_organization(p_organization_id);
  if v_reason is null then
    perform private.fail('reason_required', '22023');
  end if;
  if not private.is_clean_long_text(v_reason, 500) then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Irréversible : seulement après une suspension.
  if v_organization.status <> 'suspended' then
    perform private.fail('invalid_transition', '22023');
  end if;
  -- Une ressource ne perd pas sa provenance : tant qu'il en reste, on ne dissout pas.
  if exists (select 1 from public.resources r where r.organization_id = p_organization_id) then
    perform private.fail('organization_has_resources');
  end if;

  -- Dix dissolutions par jour et par administrateur.
  perform private.consume_user_quota('org-dissolve', 10, 86400);

  insert into private.organization_decisions (organization_id, decision, reason, decided_by)
  values (p_organization_id, 'dissolved', v_reason, v_uid);

  perform set_config('eduscholar.organization_dissolution', p_organization_id::text, true);
  begin
    delete from public.organization_members m where m.organization_id = p_organization_id;
    delete from public.organizations o where o.id = p_organization_id;
  exception when foreign_key_violation then
    perform private.fail('organization_has_resources');
  end;
  perform set_config('eduscholar.organization_dissolution', '', true);
end
$$;

-- Liste des organisations : des nombres pour les membres, jamais leur liste
-- (matrice §5.5). Cent lignes au plus par appel.
create function private.admin_list_organizations(p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, slug text, name text, status text, country_code text,
  member_count bigint, admin_count bigint, suspension_reason text, created_at timestamptz
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
           order by d.decided_at desc, d.id desc limit 1
         ) end,
         o.created_at
  from public.organizations o
  order by o.slug, o.id
  limit p_limit offset p_offset;
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes : le refus de droit est capturé, consigné, rendu en « 403 »
-- -----------------------------------------------------------------------------
-- Les écritures rendent `null` si l'opération a eu lieu (la création : l'objet
-- { id }), et un objet { code, message } si elle a été refusée.
create function public.admin_create_organization(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return jsonb_build_object('id', private.admin_create_organization(payload));
exception when insufficient_privilege then
  return private.refuse_admin_operation('create_organization', sqlerrm);
end
$$;

create function public.admin_set_organization_status(organization_id uuid, status text, reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_set_organization_status(organization_id, status, reason);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('set_organization_status', sqlerrm);
end
$$;

create function public.admin_designate_org_admin(organization_id uuid, user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_designate_org_admin(organization_id, user_id);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('designate_org_admin', sqlerrm);
end
$$;

create function public.admin_rename_organization(organization_id uuid, payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_rename_organization(organization_id, payload);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('rename_organization', sqlerrm);
end
$$;

create function public.admin_dissolve_organization(organization_id uuid, reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_dissolve_organization(organization_id, reason);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('dissolve_organization', sqlerrm);
end
$$;

-- Lecture refusée : aucune ligne, et la réponse « 403 » le dit. Aucun refus de
-- droit n'est levé après qu'une ligne a été rendue.
create function public.admin_list_organizations(page_limit integer default 50, page_offset integer default 0)
returns table (
  id uuid, slug text, name text, status text, country_code text,
  member_count bigint, admin_count bigint, suspension_reason text, created_at timestamptz
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

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'admin_create_organization(jsonb)',
    'admin_set_organization_status(uuid, text, text)',
    'admin_designate_org_admin(uuid, uuid)',
    'admin_rename_organization(uuid, jsonb)',
    'admin_dissolve_organization(uuid, text)',
    'admin_list_organizations(integer, integer)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
