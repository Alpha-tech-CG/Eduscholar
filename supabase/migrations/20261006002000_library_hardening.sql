-- =============================================================================
-- B-17 : corrections de la revue de sécurité de la bibliothèque
-- =============================================================================
-- 1. Description : mêmes refus que le nom (caractères de format invisibles,
--    caractères de contrôle C1).
-- 2. Nom : forme Unicode normalisée (NFC), pour que deux écritures du même nom
--    soient reconnues ; au moins un caractère visible.
-- 3. Renommage : même verrou que la création ; une violation de l'index
--    d'unicité donne « duplicate_name », jamais le message brut de la base.
--
-- Réversibilité : rétablir les définitions de la migration 001900 et supprimer
-- les deux contraintes.
-- =============================================================================

alter table public.collections
  add constraint collections_description_no_format_characters
    check (description is null
           or description !~ '[\u0080-\u009F​-‏‪-‮⁦-⁩]'),
  add constraint collections_name_visible_check
    check (name ~ '[^\s   -   　]');

create or replace function private.create_collection(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_name text := btrim(normalize(coalesce(p_name, ''), NFC));
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('library:' || v_uid::text, 0));
  if (select count(*) from public.collections c where c.owner_id = v_uid) >= 50 then
    perform private.fail('limit_reached');
  end if;

  begin
    insert into public.collections (owner_id, name, description)
    values (v_uid, v_name, nullif(btrim(normalize(coalesce(p_description, ''), NFC)), ''))
    returning id into v_id;
  exception when unique_violation then
    perform private.fail('duplicate_name', '23505');
  end;
  return v_id;
end
$$;

create or replace function private.update_collection(p_collection_id uuid, p_name text, p_description text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_library_user();
  v_name text := btrim(normalize(coalesce(p_name, ''), NFC));
begin
  perform pg_advisory_xact_lock(hashtextextended('library:' || v_uid::text, 0));

  begin
    update public.collections c
      set name = v_name,
          description = nullif(btrim(normalize(coalesce(p_description, ''), NFC)), '')
    where c.id = p_collection_id and c.owner_id = v_uid;
    -- « Introuvable » et « pas à vous » donnent la même réponse.
    if not found then
      perform private.fail('not_found');
    end if;
  exception when unique_violation then
    perform private.fail('duplicate_name', '23505');
  end;
end
$$;
