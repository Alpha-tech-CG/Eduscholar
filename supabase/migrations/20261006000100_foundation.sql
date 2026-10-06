-- =============================================================================
-- B-09 — Schéma de fondation
--
-- Références : docs/security/authorization-model.md (sections 2, 5.2, 5.5, 5.6, 7),
--              docs/security/threat-model.md (M-05, M-07, M-11, M-12, M-14, M-38,
--              M-47 à M-50), ADR-0001, ADR-0007.
--
-- Contenu : fermeture par défaut, profils, organisations et membres, rôles de
-- plateforme, état des comptes, journal d'audit, fonctions d'appui des
-- politiques, RLS.
--
-- Réversibilité : cette migration ne modifie aucune donnée existante. Pour
-- l'annuler sur une base sans données : supprimer le déclencheur
-- on_auth_user_created, les tables public.audit_logs, organization_members,
-- organizations, platform_roles, profile_public, profiles, puis le schéma
-- private en cascade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Fermeture par défaut (authorization-model §7.6, M-50)
-- -----------------------------------------------------------------------------

-- Schéma interne : jamais exposé par l'API (voir supabase/config.toml, [api].schemas).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Tout objet créé ensuite par les migrations est fermé tant qu'un GRANT explicite
-- ne l'ouvre pas.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- L'API GraphQL n'est pas utilisée : elle exposerait le schéma par introspection.
do $$
begin
  drop extension if exists pg_graphql;
exception when others then
  raise notice 'pg_graphql non supprimée (%). Elle reste hors des schémas exposés.', sqlerrm;
end
$$;

-- Délai d'exécution par rôle : borne les requêtes coûteuses même en appel direct (M-34).
do $$
begin
  alter role anon set statement_timeout = '3s';
  alter role authenticated set statement_timeout = '8s';
exception when others then
  raise notice 'Délais d''exécution par rôle non modifiés (%).', sqlerrm;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- Profil privé. Les champs académiques arrivent avec les référentiels (B-11, B-12).
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferred_locale text not null default 'fr'
    constraint profiles_preferred_locale_check check (preferred_locale in ('fr', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is
  'Profil privé d''un utilisateur. Lisible et modifiable par son titulaire uniquement.';

-- Partie publiable du profil, séparée parce que la RLS filtre des lignes et non
-- des colonnes (authorization-model §4). Rien n'est public par défaut.
create table public.profile_public (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  display_name text
    constraint profile_public_display_name_check
      check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.profile_public is
  'Nom d''affichage et visibilité choisis par le titulaire. is_public vaut false par défaut.';

-- Rôles de plateforme. Aucune écriture par un utilisateur (authorization-model §2.1).
create table public.platform_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    constraint platform_roles_role_check
      check (role in ('moderator', 'platform_admin', 'super_admin')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role),
  constraint platform_roles_no_self_grant check (granted_by is null or granted_by <> user_id)
);
comment on table public.platform_roles is
  'Rôles de plateforme. Écrits uniquement par une opération serveur auditée.';

-- État des comptes : schéma interne, aucun accès utilisateur.
create table private.account_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null
    constraint account_status_status_check check (status in ('active', 'suspended')),
  reason text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint account_status_no_self_change check (changed_by is null or changed_by <> user_id)
);
comment on table private.account_status is
  'Suspension des comptes. Absence de ligne : compte actif.';

-- Organisations : unité d'isolation (tenant).
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null
    constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null
    constraint organizations_name_check check (char_length(btrim(name)) between 2 and 200),
  country_code text
    constraint organizations_country_code_check
      check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  status text not null default 'pending'
    constraint organizations_status_check
      check (status in ('pending', 'verified', 'suspended')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_slug_length check (char_length(slug) between 2 and 80)
);
comment on table public.organizations is
  'Établissements et institutions. Créées, vérifiées et suspendues par la plateforme.';

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member'
    constraint organization_members_role_check
      check (role in ('org_admin', 'librarian', 'teacher', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
comment on table public.organization_members is
  'Appartenance à une organisation. Ne donne aucun accès aux travaux des autres membres.';

create index organization_members_user_id_idx on public.organization_members (user_id);

-- Journal d'audit : ajout seul. Pas de clé étrangère vers les comptes, pour que la
-- suppression d'un compte n'efface aucune ligne.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  category text not null
    constraint audit_logs_category_check
      check (category in ('security', 'moderation', 'organization', 'platform')),
  action text not null
    constraint audit_logs_action_check check (char_length(action) between 1 and 120),
  actor_id uuid,
  subject_user_id uuid,
  organization_id uuid,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb
    constraint audit_logs_metadata_size check (pg_column_size(metadata) <= 8192)
);
comment on table public.audit_logs is
  'Journal des actions sensibles. Ne contient jamais de contenu privé, de jeton ni de mot de passe.';
comment on column public.audit_logs.subject_user_id is
  'Utilisateur concerné par l''action, lorsqu''il diffère de l''acteur.';

create index audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_subject_user_id_idx
  on public.audit_logs (subject_user_id, occurred_at desc);
create index audit_logs_organization_id_idx
  on public.audit_logs (organization_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- 2. Fonctions d'appui des politiques (authorization-model §7.4)
--
-- security definer, search_path vide, aucun paramètre d'identité : elles lisent
-- auth.uid(). Jamais les métadonnées du jeton modifiables par l'utilisateur (M-05).
-- -----------------------------------------------------------------------------

create function private.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not exists (
      select 1
      from private.account_status s
      where s.user_id = (select auth.uid())
        and s.status = 'suspended'
    );
$$;

-- Second facteur vérifié pour la session en cours (M-48).
create function private.is_session_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;

create function private.has_platform_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active()
    and private.is_session_aal2()
    and exists (
      select 1
      from public.platform_roles r
      where r.user_id = (select auth.uid())
        and r.role = any (p_roles)
    );
$$;

-- Un org_admin sans second facteur n'a aucun droit d'organisation.
create function private.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active()
    and exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and m.role = any (p_roles)
        and o.status <> 'suspended'
        and (m.role <> 'org_admin' or private.is_session_aal2())
    );
$$;

revoke all on function private.is_account_active() from public, anon;
revoke all on function private.is_session_aal2() from public, anon;
revoke all on function private.has_platform_role(text[]) from public, anon;
revoke all on function private.has_org_role(uuid, text[]) from public, anon;
grant execute on function private.is_account_active() to authenticated;
grant execute on function private.is_session_aal2() to authenticated;
grant execute on function private.has_platform_role(text[]) to authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Déclencheurs
-- -----------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger profile_public_set_updated_at
  before update on public.profile_public
  for each row execute function private.set_updated_at();
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- Création du profil à l'inscription. Rien n'est recopié depuis les métadonnées
-- fournies par l'utilisateur.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.profile_public (user_id) values (new.id);
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Immutabilité des colonnes de propriété (M-11). Un WITH CHECK ne compare pas
-- l'ancienne et la nouvelle valeur ; ce déclencheur vaut pour tous les rôles.
create function private.prevent_key_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if to_jsonb(new) -> v_column is distinct from to_jsonb(old) -> v_column then
      raise exception 'La colonne % de %.% ne peut pas être modifiée.',
        v_column, tg_table_schema, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end
$$;

create trigger profiles_prevent_key_change
  before update on public.profiles
  for each row execute function private.prevent_key_change('user_id');
create trigger profile_public_prevent_key_change
  before update on public.profile_public
  for each row execute function private.prevent_key_change('user_id');
create trigger platform_roles_prevent_key_change
  before update on public.platform_roles
  for each row execute function private.prevent_key_change('user_id', 'role');
create trigger organizations_prevent_key_change
  before update on public.organizations
  for each row execute function private.prevent_key_change('id', 'slug');
create trigger organization_members_prevent_key_change
  before update on public.organization_members
  for each row execute function private.prevent_key_change('organization_id', 'user_id');

-- Une organisation garde toujours au moins un org_admin (authorization-model §2.2).
create function private.protect_last_org_admin()
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

  -- Verrou sur l'organisation : deux retraits simultanés ne passent pas tous les deux.
  perform 1 from public.organizations o where o.id = old.organization_id for update;

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

create trigger organization_members_protect_last_admin
  before update or delete on public.organization_members
  for each row execute function private.protect_last_org_admin();

-- Journal d'audit : écriture par la base uniquement, dans la transaction de
-- l'action (M-38, M-47).
create function private.write_audit(
  p_category text,
  p_action text,
  p_subject_user_id uuid default null,
  p_organization_id uuid default null,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    category, action, actor_id, subject_user_id, organization_id,
    target_type, target_id, metadata
  )
  values (
    p_category, p_action, (select auth.uid()), p_subject_user_id, p_organization_id,
    p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb)
  );
$$;
revoke all on function private.write_audit(text, text, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

-- Déclencheur générique pour les tables d'administration.
-- Arguments : catégorie, puis liste des colonnes à consigner (jamais de contenu privé).
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_metadata jsonb := '{}'::jsonb;
  v_column text;
  v_index integer;
begin
  for v_index in 1 .. tg_nargs - 1 loop
    v_column := tg_argv[v_index];
    if tg_op = 'UPDATE' then
      if v_new -> v_column is distinct from v_old -> v_column then
        v_metadata := v_metadata || jsonb_build_object(
          v_column, jsonb_build_object('old', v_old -> v_column, 'new', v_new -> v_column)
        );
      end if;
    else
      v_metadata := v_metadata || jsonb_build_object(v_column, v_row -> v_column);
    end if;
  end loop;

  -- Une mise à jour qui ne touche aucune colonne suivie n'est pas consignée.
  if tg_op = 'UPDATE' and v_metadata = '{}'::jsonb then
    return new;
  end if;

  perform private.write_audit(
    tg_argv[0],
    tg_table_name || '.' || lower(tg_op),
    (v_row ->> 'user_id')::uuid,
    coalesce(v_row ->> 'organization_id',
             case when tg_table_name = 'organizations' then v_row ->> 'id' end)::uuid,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    v_metadata
  );

  return coalesce(new, old);
end
$$;

create trigger platform_roles_audit
  after insert or update or delete on public.platform_roles
  for each row execute function private.audit_row_change('platform', 'role', 'granted_by');
create trigger account_status_audit
  after insert or update or delete on private.account_status
  for each row execute function private.audit_row_change('platform', 'status', 'changed_by');
create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function private.audit_row_change('organization', 'status', 'name', 'slug');
create trigger organization_members_audit
  after insert or update or delete on public.organization_members
  for each row execute function private.audit_row_change('organization', 'role');

-- Le journal ne se modifie pas et ne se vide pas, quel que soit le rôle.
create function private.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Le journal d''audit est en ajout seul.' using errcode = '42501';
end
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.reject_audit_change();
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.reject_audit_change();

-- -----------------------------------------------------------------------------
-- 4. Droits (aucun droit pour anon ; aucun INSERT ni DELETE direct pour authenticated)
-- -----------------------------------------------------------------------------

grant select on public.profiles to authenticated;
grant update (preferred_locale) on public.profiles to authenticated;

grant select on public.profile_public to authenticated;
grant update (display_name, is_public) on public.profile_public to authenticated;

grant select on public.platform_roles to authenticated;

grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

grant select on public.organization_members to authenticated;

grant select on public.audit_logs to authenticated;

-- Opérations privilégiées côté serveur (authorization-model §7.5).
grant select on public.profiles, public.profile_public, public.audit_logs to service_role;
grant select, insert, update, delete
  on public.platform_roles, public.organizations, public.organization_members
  to service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS : activée et forcée, une politique par opération et par rôle
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.profile_public enable row level security;
alter table public.profile_public force row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_roles force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
alter table private.account_status enable row level security;
alter table private.account_status force row level security;

-- profiles : le titulaire uniquement (authorization-model §5.2).
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_account_active()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_account_active()))
  with check (user_id = (select auth.uid()));

-- profile_public : le titulaire, et tout utilisateur connecté si le titulaire l'a publié.
create policy profile_public_select on public.profile_public
  for select to authenticated
  using (
    (select private.is_account_active())
    and (is_public or user_id = (select auth.uid()))
  );

create policy profile_public_update_own on public.profile_public
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_account_active()))
  with check (user_id = (select auth.uid()));

-- platform_roles : chacun lit ses propres rôles (authorization-model §5.6).
create policy platform_roles_select_own on public.platform_roles
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_account_active()));

-- organizations : fiche publique des organisations vérifiées, sa propre
-- organisation pour un membre, toutes pour l'administration de la plateforme.
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      status = 'verified'
      or (select private.has_org_role(id, array['org_admin', 'librarian', 'teacher', 'member']))
      or (select private.has_platform_role(array['platform_admin', 'super_admin']))
    )
  );

create policy organizations_update_by_org_admin on public.organizations
  for update to authenticated
  using ((select private.has_org_role(id, array['org_admin'])))
  with check ((select private.has_org_role(id, array['org_admin'])));

-- organization_members : sa propre appartenance ; la liste pour l'org_admin.
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      user_id = (select auth.uid())
      or (select private.has_org_role(organization_id, array['org_admin']))
    )
  );

-- audit_logs : lecture restreinte (authorization-model §5.6). Aucune écriture.
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      subject_user_id = (select auth.uid())
      or (category = 'security' and actor_id = (select auth.uid()))
      or (category = 'moderation'
          and (select private.has_platform_role(array['moderator'])))
      or (category = 'organization'
          and organization_id is not null
          and (select private.has_org_role(organization_id, array['org_admin'])))
      or (select private.has_platform_role(array['platform_admin', 'super_admin']))
    )
  );
