-- =============================================================================
-- B-09 — Durcissement du schéma de fondation
--
-- Corrections issues de la revue de sécurité de la migration
-- 20261006000100_foundation.sql. Aucune donnée n'est supprimée.
--
--  1. service_role fermé par défaut, comme anon et authenticated.
--  2. Lecture par colonne : les identifiants des administrateurs ne sont plus
--     lisibles (created_by, updated_by, granted_by, invited_by).
--  3. Plus aucune écriture directe sur organizations : le renommage passera par
--     une fonction nommée, qui pourra exiger une nouvelle vérification.
--  4. Journal d'audit : acteur toujours renseigné, lecture resserrée,
--     politiques évaluées une fois par requête et non par ligne.
--  5. Compte anonyme refusé par is_account_active().
--  6. Déclencheurs : colonne inexistante refusée ; verrou moins bloquant.
--
-- Réversibilité : recréer les politiques et les droits de la migration
-- précédente ; la colonne organizations.updated_by peut être supprimée.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fermeture par défaut étendue à service_role
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from service_role;

-- -----------------------------------------------------------------------------
-- 2. Acteur des modifications d'organisation
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column updated_by uuid references auth.users (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. Droits : lecture par colonne, aucune écriture directe sur organizations
-- -----------------------------------------------------------------------------
drop policy organizations_update_by_org_admin on public.organizations;
revoke update (name) on public.organizations from authenticated;

revoke select on public.organizations from authenticated;
grant select (id, slug, name, country_code, status, created_at, updated_at)
  on public.organizations to authenticated;

revoke select on public.platform_roles from authenticated;
grant select (user_id, role, granted_at) on public.platform_roles to authenticated;

revoke select on public.organization_members from authenticated;
grant select (organization_id, user_id, role, created_at)
  on public.organization_members to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Fonctions d'appui
-- -----------------------------------------------------------------------------

-- Un compte anonyme n'est jamais un compte actif, même si les connexions
-- anonymes étaient activées par erreur.
create or replace function private.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and not exists (
      select 1
      from private.account_status s
      where s.user_id = (select auth.uid())
        and s.status = 'suspended'
    );
$$;

-- Organisations où l'appelant détient l'un des rôles. Renvoie un ensemble, pour
-- que les politiques l'évaluent une fois par requête et non une fois par ligne.
create function private.my_org_ids(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.role = any (p_roles)
    and o.status <> 'suspended'
    and (m.role <> 'org_admin' or private.is_session_aal2())
    and private.is_account_active();
$$;
revoke all on function private.my_org_ids(text[]) from public, anon;
grant execute on function private.my_org_ids(text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Politiques
-- -----------------------------------------------------------------------------
drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      status = 'verified'
      or id in (
        select private.my_org_ids(array['org_admin', 'librarian', 'teacher', 'member'])
      )
      or (select private.has_platform_role(array['platform_admin', 'super_admin']))
    )
  );

drop policy organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      user_id = (select auth.uid())
      or organization_id in (select private.my_org_ids(array['org_admin']))
    )
  );

-- Un utilisateur ne lit que ses événements de sécurité. Les changements de rôle
-- et de statut le concernant ne lui sont pas exposés : ils porteraient
-- l'identifiant de l'administrateur qui a agi.
drop policy audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      (category = 'security'
        and (actor_id = (select auth.uid()) or subject_user_id = (select auth.uid())))
      or (category = 'moderation'
        and (select private.has_platform_role(array['moderator'])))
      or (category = 'organization'
        and organization_id in (select private.my_org_ids(array['org_admin'])))
      or (select private.has_platform_role(array['platform_admin', 'super_admin']))
    )
  );

-- -----------------------------------------------------------------------------
-- 6. Déclencheurs
-- -----------------------------------------------------------------------------

-- Une faute de frappe dans le nom d'une colonne protégée doit échouer, pas
-- laisser la protection inopérante.
create or replace function private.prevent_key_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if not (to_jsonb(new) ? v_column) then
      raise exception 'Colonne % absente de %.%.', v_column, tg_table_schema, tg_table_name;
    end if;
    if to_jsonb(new) -> v_column is distinct from to_jsonb(old) -> v_column then
      raise exception 'La colonne % de %.% ne peut pas être modifiée.',
        v_column, tg_table_schema, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end
$$;

-- FOR NO KEY UPDATE : sérialise les retraits d'administrateurs sans bloquer
-- l'ajout de membres. Ce verrou suppose le niveau d'isolation READ COMMITTED.
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

-- Une opération serveur (service_role) doit dire qui agit : le jeton de service
-- ne porte pas d'identité. Une session directe sur la base (migration,
-- amorçage du premier super_admin) n'a pas de jeton et n'est pas concernée.
create function private.require_actor_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (to_jsonb(new) ? tg_argv[0]) then
    raise exception 'Colonne % absente de %.%.', tg_argv[0], tg_table_schema, tg_table_name;
  end if;
  if ((select auth.jwt()) ->> 'role') is not null
     and (to_jsonb(new) ->> tg_argv[0]) is null then
    raise exception 'La colonne % est obligatoire pour cette opération.', tg_argv[0]
      using errcode = '23502';
  end if;
  return new;
end
$$;

create trigger platform_roles_require_actor
  before insert or update on public.platform_roles
  for each row execute function private.require_actor_column('granted_by');
create trigger account_status_require_actor
  before insert or update on private.account_status
  for each row execute function private.require_actor_column('changed_by');

-- Sous la session d'un utilisateur, l'acteur est son identité, non celle qu'il déclare.
create function private.set_organization_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    new.updated_by := v_uid;
    if tg_op = 'INSERT' then
      new.created_by := v_uid;
    end if;
  elsif ((select auth.jwt()) ->> 'role') is not null then
    if tg_op = 'INSERT' then
      if new.created_by is null then
        raise exception 'created_by est obligatoire pour cette opération.'
          using errcode = '23502';
      end if;
      new.updated_by := coalesce(new.updated_by, new.created_by);
    elsif new.updated_by is null then
      raise exception 'updated_by est obligatoire pour cette opération.'
        using errcode = '23502';
    end if;
  end if;
  return new;
end
$$;

create trigger organizations_set_actor
  before insert or update on public.organizations
  for each row execute function private.set_organization_actor();

-- Journal d'audit : l'acteur vient de la session, sinon de la ligne.
drop trigger platform_roles_audit on public.platform_roles;
drop trigger account_status_audit on private.account_status;
drop trigger organizations_audit on public.organizations;
drop trigger organization_members_audit on public.organization_members;
drop function private.audit_row_change();
drop function private.write_audit(text, text, uuid, uuid, text, text, jsonb);

create function private.write_audit(
  p_category text,
  p_action text,
  p_actor_id uuid default null,
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
    p_category, p_action, coalesce((select auth.uid()), p_actor_id),
    p_subject_user_id, p_organization_id,
    p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb)
  );
$$;
revoke all on function private.write_audit(text, text, uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

-- Arguments : catégorie, puis colonnes à consigner. Les colonnes d'acteur ne sont
-- pas consignées dans les métadonnées : elles alimentent actor_id.
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
    if not (v_row ? v_column) then
      raise exception 'Colonne % absente de %.%.', v_column, tg_table_schema, tg_table_name;
    end if;
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
    coalesce(
      v_row ->> 'granted_by', v_row ->> 'changed_by', v_row ->> 'invited_by',
      v_row ->> 'updated_by', v_row ->> 'created_by'
    )::uuid,
    (v_row ->> 'user_id')::uuid,
    coalesce(
      v_row ->> 'organization_id',
      case
        when tg_table_schema = 'public' and tg_table_name = 'organizations' then v_row ->> 'id'
      end
    )::uuid,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    v_metadata
  );

  return coalesce(new, old);
end
$$;

create trigger platform_roles_audit
  after insert or update or delete on public.platform_roles
  for each row execute function private.audit_row_change('platform', 'role');
create trigger account_status_audit
  after insert or update or delete on private.account_status
  for each row execute function private.audit_row_change('platform', 'status');
create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function private.audit_row_change('organization', 'status', 'name', 'slug');
create trigger organization_members_audit
  after insert or update or delete on public.organization_members
  for each row execute function private.audit_row_change('organization', 'role');
