-- =============================================================================
-- B-17 : favoris et collections privées
-- =============================================================================
-- Trois tables, privées à leur titulaire : personne d'autre ne les lit, pas
-- même la modération ou l'administration de la plateforme.
--
-- Lecture par RLS (ses propres lignes). Écriture par fonctions nommées
-- seulement : elles vérifient que la ressource ajoutée est publiée et visible,
-- avec la même réponse « introuvable » qu'elle soit inexistante ou non publiée —
-- un ajout direct par clé étrangère aurait révélé l'existence d'une fiche
-- cachée. Elles tiennent aussi les plafonds.
--
-- Une fiche suspendue ou retirée reste dans la collection, mais n'est plus
-- lisible : l'application indique qu'elle n'est plus disponible, et le
-- titulaire peut toujours l'enlever.
--
-- Réversibilité : supprimer les fonctions, puis collection_items, collections
-- et resource_favorites.
-- =============================================================================

create table public.resource_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);
comment on table public.resource_favorites is
  'Favoris d''un utilisateur. Privés : lisibles de leur seul titulaire.';
create index resource_favorites_resource_idx on public.resource_favorites (resource_id);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint collections_name_check check (private.is_clean_text_array(array[name], 1, 120)),
  description text
    constraint collections_description_check
      check (description is null
             or (char_length(description) <= 1000
                 and description !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.collections is
  'Collections de ressources d''un utilisateur. Privées : lisibles de leur seul titulaire.';
-- Un nom ne sert qu'une fois par titulaire.
create unique index collections_owner_name_idx on public.collections (owner_id, lower(name));

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, resource_id)
);
comment on table public.collection_items is
  'Ressources rangées dans une collection.';
create index collection_items_resource_idx on public.collection_items (resource_id);

create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function private.set_updated_at();
create trigger collections_prevent_key_change
  before update on public.collections
  for each row execute function private.prevent_key_change('id', 'owner_id');

-- -----------------------------------------------------------------------------
-- Droits et RLS : lecture de ses propres lignes, aucune écriture directe
-- -----------------------------------------------------------------------------
alter table public.resource_favorites enable row level security;
alter table public.resource_favorites force row level security;
alter table public.collections enable row level security;
alter table public.collections force row level security;
alter table public.collection_items enable row level security;
alter table public.collection_items force row level security;

revoke all on public.resource_favorites, public.collections, public.collection_items
  from public, anon, authenticated, service_role;
grant select on public.resource_favorites, public.collections, public.collection_items to authenticated;

-- Collections de l'appelant, pour la politique des éléments.
create function private.my_collection_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.collections c
  where c.owner_id = (select auth.uid())
    and private.is_account_active();
$$;
revoke all on function private.my_collection_ids() from public, anon, authenticated, service_role;
grant execute on function private.my_collection_ids() to authenticated;

create policy resource_favorites_select on public.resource_favorites
  for select to authenticated
  using ((select private.is_account_active()) and user_id = (select auth.uid()));

create policy collections_select on public.collections
  for select to authenticated
  using ((select private.is_account_active()) and owner_id = (select auth.uid()));

create policy collection_items_select on public.collection_items
  for select to authenticated
  using (
    (select private.is_account_active())
    and collection_id in (select private.my_collection_ids())
  );

-- -----------------------------------------------------------------------------
-- Fonctions
-- -----------------------------------------------------------------------------
-- Vrai si la fiche est publiée et publique. Les fiches réservées à une
-- organisation viendront avec les catalogues institutionnels.
create function private.is_saveable_resource(p_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_resource_id
      and r.editorial_status = 'published'
      and r.visibility = 'public'
  );
$$;
revoke all on function private.is_saveable_resource(uuid) from public, anon, authenticated, service_role;

create function private.require_library_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  return v_uid;
end
$$;
revoke all on function private.require_library_user() from public, anon, authenticated, service_role;

-- Ajoute ou retire un favori. Le retrait ne dépend pas de la visibilité de la
-- fiche : on peut toujours enlever ce qu'on a gardé.
create function private.set_favorite(p_resource_id uuid, p_favorite boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if p_resource_id is null or p_favorite is null then
    perform private.fail('invalid_payload', '22023');
  end if;

  if not p_favorite then
    delete from public.resource_favorites f
    where f.user_id = v_uid and f.resource_id = p_resource_id;
    return;
  end if;

  if not private.is_saveable_resource(p_resource_id) then
    perform private.fail('not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('library:' || v_uid::text, 0));
  if (select count(*) from public.resource_favorites f where f.user_id = v_uid) >= 2000 then
    perform private.fail('limit_reached');
  end if;

  insert into public.resource_favorites (user_id, resource_id)
  values (v_uid, p_resource_id)
  on conflict do nothing;
end
$$;

create function private.create_collection(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('library:' || v_uid::text, 0));
  if (select count(*) from public.collections c where c.owner_id = v_uid) >= 50 then
    perform private.fail('limit_reached');
  end if;
  if exists (
    select 1 from public.collections c where c.owner_id = v_uid and lower(c.name) = lower(v_name)
  ) then
    perform private.fail('duplicate_name', '23505');
  end if;

  insert into public.collections (owner_id, name, description)
  values (v_uid, v_name, nullif(btrim(coalesce(p_description, '')), ''))
  returning id into v_id;
  return v_id;
end
$$;

create function private.update_collection(p_collection_id uuid, p_name text, p_description text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if exists (
    select 1 from public.collections c
    where c.owner_id = v_uid and lower(c.name) = lower(v_name) and c.id <> p_collection_id
  ) then
    perform private.fail('duplicate_name', '23505');
  end if;

  update public.collections c
    set name = v_name, description = nullif(btrim(coalesce(p_description, '')), '')
  where c.id = p_collection_id and c.owner_id = v_uid;
  -- « Introuvable » et « pas à vous » donnent la même réponse.
  if not found then
    perform private.fail('not_found');
  end if;
end
$$;

create function private.delete_collection(p_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  delete from public.collections c where c.id = p_collection_id and c.owner_id = v_uid;
  if not found then
    perform private.fail('not_found');
  end if;
end
$$;

create function private.set_collection_item(p_collection_id uuid, p_resource_id uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if p_resource_id is null or p_present is null then
    perform private.fail('invalid_payload', '22023');
  end if;

  perform 1 from public.collections c
  where c.id = p_collection_id and c.owner_id = v_uid
  for update;
  if not found then
    perform private.fail('not_found');
  end if;

  if not p_present then
    delete from public.collection_items i
    where i.collection_id = p_collection_id and i.resource_id = p_resource_id;
    return;
  end if;

  if not private.is_saveable_resource(p_resource_id) then
    perform private.fail('not_found');
  end if;
  if (select count(*) from public.collection_items i where i.collection_id = p_collection_id) >= 500 then
    perform private.fail('limit_reached');
  end if;

  insert into public.collection_items (collection_id, resource_id)
  values (p_collection_id, p_resource_id)
  on conflict do nothing;
end
$$;

-- Enveloppes exposées par l'API.
create function public.set_favorite(resource_id uuid, favorite boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.set_favorite(resource_id, favorite); $$;

create function public.create_collection(name text, description text default null) returns uuid
language sql security invoker set search_path = ''
as $$ select private.create_collection(name, description); $$;

create function public.update_collection(collection_id uuid, name text, description text default null) returns void
language sql security invoker set search_path = ''
as $$ select private.update_collection(collection_id, name, description); $$;

create function public.delete_collection(collection_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_collection(collection_id); $$;

create function public.set_collection_item(collection_id uuid, resource_id uuid, present boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.set_collection_item(collection_id, resource_id, present); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'set_favorite(uuid, boolean)',
    'create_collection(text, text)',
    'update_collection(uuid, text, text)',
    'delete_collection(uuid)',
    'set_collection_item(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
