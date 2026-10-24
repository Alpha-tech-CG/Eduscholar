-- =============================================================================
-- LOT 7 : bibliothèque enrichie (cahier §6.5 et §6.10)
-- =============================================================================
-- 1. Notes privées sur un favori et sur un élément de collection : une colonne
--    `note` (2 000 caractères, texte propre) sur `resource_favorites` et
--    `collection_items`. Écriture par fonction nommée seulement.
-- 2. Tags personnels sur les favoris (`favorite_tags`), distincts de
--    `resources.tags` : 40 caractères, ni virgule ni point-virgule, 10 par
--    favori, 100 tags distincts par compte. Un tag n'existe que tant qu'un
--    favori le porte ; retirer le favori retire ses tags (clé étrangère).
--    Un tag déjà employé garde sa graphie : « Méthode » et « méthode » sont
--    le même tag.
-- 3. Historique de consultation (`resource_views`) : une ligne par fiche et
--    par compte, la date de dernière consultation, rafraîchie au plus une fois
--    par heure ; 1 000 lignes au plus par compte (les plus anciennes partent) ;
--    effacé au bout de douze mois par la tâche `eduscholar-views-purge`. Rien
--    n'est enregistré si l'historique est désactivé (`library_settings`), ni
--    pour une fiche qui n'est pas publiée et publique. Désactiver l'historique
--    efface aussi celui qui existe.
-- 4. Import de références vers les sources d'un projet
--    (`import_project_sources`) : chaque entrée passe par
--    private.add_project_source, avec ses contrôles (propriété du projet,
--    plafond de 300 sources par projet, quota quotidien de 600, contraintes de
--    la table). Une entrée refusée ne fait pas échouer les autres ; le rapport
--    dit lesquelles et pourquoi, par un code. Rien n'est créé au catalogue.
--
-- Accès : chaque table est lisible de son seul titulaire (RLS forcée), par
-- personne d'autre, pas même la modération ou l'administration. Aucune
-- écriture directe : authenticated n'a que SELECT. Suppression du compte : tout
-- part en cascade depuis auth.users (les tags par le favori).
--
-- Réversibilité :
--   select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-views-purge';
--   drop function public.import_project_sources(uuid, jsonb), private.import_project_sources(uuid, jsonb),
--     public.set_history_enabled(boolean), private.set_history_enabled(boolean),
--     public.clear_resource_views(), private.clear_resource_views(),
--     public.delete_resource_view(uuid), private.delete_resource_view(uuid),
--     public.record_resource_view(uuid), private.record_resource_view(uuid),
--     public.my_library_tags(), private.my_library_tags(),
--     public.set_favorite_tag(uuid, text, boolean), private.set_favorite_tag(uuid, text, boolean),
--     public.set_collection_item_note(uuid, uuid, text), private.set_collection_item_note(uuid, uuid, text),
--     public.set_favorite_note(uuid, text), private.set_favorite_note(uuid, text),
--     private.purge_old_resource_views(), private.clean_note(text);
--   drop table public.library_settings, public.resource_views, public.favorite_tags;
--   alter table public.collection_items drop column note, drop column note_updated_at;
--   alter table public.resource_favorites drop column note, drop column note_updated_at;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notes privées
-- -----------------------------------------------------------------------------
alter table public.resource_favorites
  add column note text
    constraint resource_favorites_note_check check (private.is_clean_long_text(note, 2000)),
  add column note_updated_at timestamptz;
comment on column public.resource_favorites.note is
  'Note privée du titulaire sur ce favori. Lisible de lui seul.';

alter table public.collection_items
  add column note text
    constraint collection_items_note_check check (private.is_clean_long_text(note, 2000)),
  add column note_updated_at timestamptz;
comment on column public.collection_items.note is
  'Note privée du titulaire de la collection sur cet élément. Lisible de lui seul.';

-- -----------------------------------------------------------------------------
-- 2. Tags personnels
-- -----------------------------------------------------------------------------
create table public.favorite_tags (
  user_id uuid not null,
  resource_id uuid not null,
  tag text not null
    constraint favorite_tags_tag_check
      check (private.is_clean_text_array(array[tag], 1, 40)
             and tag = btrim(tag)
             and tag !~ '[,;]'
             and tag !~ '\s\s'),
  created_at timestamptz not null default now(),
  primary key (user_id, resource_id, tag),
  -- Le tag suit le favori : retirer le favori, ou supprimer le compte, retire ses tags.
  constraint favorite_tags_favorite_fkey
    foreign key (user_id, resource_id)
    references public.resource_favorites (user_id, resource_id) on delete cascade
);
comment on table public.favorite_tags is
  'Tags personnels posés par un utilisateur sur ses favoris. Privés ; distincts de resources.tags.';
-- Un tag ne figure qu'une fois par favori, sans égard à la casse.
create unique index favorite_tags_unique_ci_idx on public.favorite_tags (user_id, resource_id, lower(tag));
-- Filtre de la bibliothèque par tag.
create index favorite_tags_user_tag_idx on public.favorite_tags (user_id, tag, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. Historique de consultation et réglage
-- -----------------------------------------------------------------------------
create table public.resource_views (
  user_id uuid not null references auth.users (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);
comment on table public.resource_views is
  'Dernière consultation d''une fiche par un utilisateur, à l''heure près. Privé ; effacé au bout de douze mois.';
create index resource_views_user_idx on public.resource_views (user_id, viewed_at desc);
create index resource_views_viewed_idx on public.resource_views (viewed_at);
create index resource_views_resource_idx on public.resource_views (resource_id);

create table public.library_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  history_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.library_settings is
  'Réglages de la bibliothèque d''un utilisateur. Sans ligne : historique activé.';

create trigger library_settings_set_updated_at
  before update on public.library_settings
  for each row execute function private.set_updated_at();
create trigger library_settings_prevent_key_change
  before update on public.library_settings
  for each row execute function private.prevent_key_change('user_id');

-- -----------------------------------------------------------------------------
-- Droits et RLS : lecture de ses propres lignes, aucune écriture directe
-- -----------------------------------------------------------------------------
alter table public.favorite_tags enable row level security;
alter table public.favorite_tags force row level security;
alter table public.resource_views enable row level security;
alter table public.resource_views force row level security;
alter table public.library_settings enable row level security;
alter table public.library_settings force row level security;

revoke all on public.favorite_tags, public.resource_views, public.library_settings
  from public, anon, authenticated, service_role;
grant select on public.favorite_tags, public.resource_views, public.library_settings to authenticated;

create policy favorite_tags_select on public.favorite_tags
  for select to authenticated
  using ((select private.is_account_active()) and user_id = (select auth.uid()));

create policy resource_views_select on public.resource_views
  for select to authenticated
  using ((select private.is_account_active()) and user_id = (select auth.uid()));

create policy library_settings_select on public.library_settings
  for select to authenticated
  using ((select private.is_account_active()) and user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Fonctions
-- -----------------------------------------------------------------------------
-- Note nettoyée : NFC, fins de ligne unifiées, espaces de bord retirés ; vide
-- devient null (la note est effacée).
create function private.clean_note(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(replace(normalize(coalesce(p_value, ''), NFC), E'\r\n', E'\n'), E' \t\r\n'), '');
$$;
revoke all on function private.clean_note(text) from public, anon, authenticated, service_role;

create function private.set_favorite_note(p_resource_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if p_resource_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  update public.resource_favorites f
    set note = private.clean_note(p_note), note_updated_at = now()
  where f.user_id = v_uid and f.resource_id = p_resource_id;
  -- Un favori d'autrui et une fiche non gardée donnent la même réponse.
  if not found then
    perform private.fail('not_found');
  end if;
end
$$;

create function private.set_collection_item_note(p_collection_id uuid, p_resource_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if p_collection_id is null or p_resource_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  update public.collection_items i
    set note = private.clean_note(p_note), note_updated_at = now()
  where i.collection_id = p_collection_id
    and i.resource_id = p_resource_id
    and exists (
      select 1 from public.collections c where c.id = i.collection_id and c.owner_id = v_uid
    );
  if not found then
    perform private.fail('not_found');
  end if;
end
$$;

-- Pose ou retire un tag sur un favori. Le retrait est sans effet si le tag
-- n'y est pas.
create function private.set_favorite_tag(p_resource_id uuid, p_tag text, p_present boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_tag text := regexp_replace(btrim(normalize(coalesce(p_tag, ''), NFC)), '\s+', ' ', 'g');
  v_existing text;
begin
  if p_resource_id is null or p_present is null then
    perform private.fail('invalid_payload', '22023');
  end if;

  if not p_present then
    delete from public.favorite_tags t
    where t.user_id = v_uid and t.resource_id = p_resource_id and lower(t.tag) = lower(v_tag);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('library:' || v_uid::text, 0));
  perform 1 from public.resource_favorites f
  where f.user_id = v_uid and f.resource_id = p_resource_id;
  if not found then
    perform private.fail('not_found');
  end if;

  -- Graphie déjà employée par ce compte.
  select t.tag into v_existing
  from public.favorite_tags t
  where t.user_id = v_uid and lower(t.tag) = lower(v_tag)
  limit 1;
  if v_existing is not null then
    v_tag := v_existing;
    if exists (
      select 1 from public.favorite_tags t
      where t.user_id = v_uid and t.resource_id = p_resource_id and t.tag = v_tag
    ) then
      return;
    end if;
  elsif (
    select count(distinct lower(t.tag)) from public.favorite_tags t where t.user_id = v_uid
  ) >= 100 then
    perform private.fail('limit_reached');
  end if;

  if (
    select count(*) from public.favorite_tags t
    where t.user_id = v_uid and t.resource_id = p_resource_id
  ) >= 10 then
    perform private.fail('limit_reached');
  end if;

  insert into public.favorite_tags (user_id, resource_id, tag)
  values (v_uid, p_resource_id, v_tag);
end
$$;

-- Tags de l'appelant et nombre de favoris qui portent chacun.
create function private.my_library_tags()
returns table (tag text, favorite_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.tag, count(*)::integer
  from public.favorite_tags t
  where private.is_account_active() and t.user_id = (select auth.uid())
  group by t.tag
  order by lower(t.tag), t.tag
  limit 100;
$$;

-- Enregistre la consultation d'une fiche. Silencieux quand il n'y a rien à
-- enregistrer (historique désactivé, fiche non publiée ou inexistante) : la
-- réponse ne renseigne sur rien.
create function private.record_resource_view(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_inserted boolean;
begin
  if p_resource_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if exists (
    select 1 from public.library_settings s where s.user_id = v_uid and not s.history_enabled
  ) then
    return;
  end if;
  if not private.is_saveable_resource(p_resource_id) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('views:' || v_uid::text, 0));
  -- Une consultation de moins d'une heure n'est pas réécrite.
  if exists (
    select 1 from public.resource_views v
    where v.user_id = v_uid and v.resource_id = p_resource_id
      and v.viewed_at > now() - interval '1 hour'
  ) then
    return;
  end if;

  insert into public.resource_views as v (user_id, resource_id, viewed_at)
  values (v_uid, p_resource_id, now())
  on conflict (user_id, resource_id) do update set viewed_at = excluded.viewed_at
  returning (xmax = 0) into v_inserted;

  -- Au-delà de mille fiches, les consultations les plus anciennes partent.
  if v_inserted then
    delete from public.resource_views v
    where v.user_id = v_uid
      and v.resource_id in (
        select o.resource_id from public.resource_views o
        where o.user_id = v_uid
        order by o.viewed_at desc, o.resource_id
        offset 1000
      );
  end if;
end
$$;

create function private.delete_resource_view(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if p_resource_id is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  delete from public.resource_views v where v.user_id = v_uid and v.resource_id = p_resource_id;
end
$$;

create function private.clear_resource_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  delete from public.resource_views v where v.user_id = v_uid;
end
$$;

-- Active ou désactive l'historique. Le désactiver efface celui qui existe.
create function private.set_history_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
begin
  if p_enabled is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  insert into public.library_settings as s (user_id, history_enabled)
  values (v_uid, p_enabled)
  on conflict (user_id) do update set history_enabled = excluded.history_enabled;
  if not p_enabled then
    delete from public.resource_views v where v.user_id = v_uid;
  end if;
end
$$;

-- Import de références vers les sources d'un projet de l'appelant.
-- Entrée : un tableau d'objets au format de add_project_source, 500 au plus.
-- Sortie : { "created": n, "rejected": [ { "index": i, "code": c } ] }, où
-- `index` part de zéro et `code` vaut duplicate, invalid, limit_reached ou
-- rate_limited. Aucun détail interne n'y figure.
create function private.import_project_sources(p_project_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_project(p_project_id);
  v_entry jsonb;
  v_index bigint;
  v_total integer;
  v_created integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_stop text;
  v_code text;
  v_title text;
  v_doi text;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_total := jsonb_array_length(p_entries);
  if v_total = 0 or v_total > 500 then
    perform private.fail('invalid_payload', '22023');
  end if;

  for v_entry, v_index in
    select e.value, e.ordinality - 1 from jsonb_array_elements(p_entries) with ordinality as e
  loop
    -- Plafond ou quota atteint : les entrées suivantes échoueraient de même.
    if v_stop is not null then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', v_stop);
      continue;
    end if;
    if jsonb_typeof(v_entry) is distinct from 'object' then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', 'invalid');
      continue;
    end if;

    -- Doublon d'une source déjà présente : même DOI, ou même titre et même année.
    v_title := private.clean_line(v_entry ->> 'title');
    v_doi := nullif(lower(btrim(coalesce(v_entry ->> 'doi', ''))), '');
    if exists (
      select 1 from public.project_sources s
      where s.project_id = v_project
        and ((v_doi is not null and s.doi = v_doi)
             or (v_title is not null
                 and lower(s.title) = lower(v_title)
                 and s.publication_year is not distinct from
                     (case when coalesce(v_entry ->> 'publication_year', '') ~ '^\d{4}$'
                           then (v_entry ->> 'publication_year')::smallint end)))
    ) then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', 'duplicate');
      continue;
    end if;

    begin
      perform private.add_project_source(v_project, v_entry);
      v_created := v_created + 1;
    exception when others then
      v_code := case
        when sqlerrm in ('limit_reached', 'rate_limited') then sqlerrm
        else 'invalid'
      end;
      if v_code <> 'invalid' then
        v_stop := v_code;
      end if;
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', v_code);
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'rejected', v_rejected);
end
$$;

-- Enveloppes exposées par l'API.
create function public.set_favorite_note(resource_id uuid, note text) returns void
language sql security invoker set search_path = ''
as $$ select private.set_favorite_note(resource_id, note); $$;

create function public.set_collection_item_note(collection_id uuid, resource_id uuid, note text) returns void
language sql security invoker set search_path = ''
as $$ select private.set_collection_item_note(collection_id, resource_id, note); $$;

create function public.set_favorite_tag(resource_id uuid, tag text, present boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.set_favorite_tag(resource_id, tag, present); $$;

create function public.my_library_tags()
returns table (tag text, favorite_count integer)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_library_tags(); $$;

create function public.record_resource_view(resource_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.record_resource_view(resource_id); $$;

create function public.delete_resource_view(resource_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.delete_resource_view(resource_id); $$;

create function public.clear_resource_views() returns void
language sql security invoker set search_path = ''
as $$ select private.clear_resource_views(); $$;

create function public.set_history_enabled(enabled boolean) returns void
language sql security invoker set search_path = ''
as $$ select private.set_history_enabled(enabled); $$;

create function public.import_project_sources(project_id uuid, entries jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.import_project_sources(project_id, entries); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'set_favorite_note(uuid, text)',
    'set_collection_item_note(uuid, uuid, text)',
    'set_favorite_tag(uuid, text, boolean)',
    'my_library_tags()',
    'record_resource_view(uuid)',
    'delete_resource_view(uuid)',
    'clear_resource_views()',
    'set_history_enabled(boolean)',
    'import_project_sources(uuid, jsonb)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Conservation de l'historique : douze mois
-- -----------------------------------------------------------------------------
create function private.purge_old_resource_views()
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
  delete from public.resource_views v where v.viewed_at < now() - interval '12 months';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function private.purge_old_resource_views() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-views-purge';
select cron.schedule('eduscholar-views-purge', '12 4 * * *', 'select private.purge_old_resource_views()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-views-purge' and active and username = 'postgres'
  ) then
    raise exception 'La tâche eduscholar-views-purge n''est pas planifiée sous le rôle postgres';
  end if;
end
$$;
