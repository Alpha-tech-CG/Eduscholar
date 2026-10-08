-- =============================================================================
-- F-03 : deux corrections de forme sur l'administration des référentiels
-- =============================================================================
-- Relevées par le contrôle statique après l'application de la migration 007600 ;
-- aucune règle ne change.
--
--   - `private.clean_reference_labels` était déclarée `stable` alors qu'elle
--     lève une erreur par `private.fail`, fonction volatile : elle devient
--     volatile. Elle n'est appelée que depuis une fonction d'écriture ;
--   - dans `private.admin_save_reference_item`, la liste des champs modifiés
--     était initialisée par un littéral de texte : elle l'est par un tableau
--     typé.
--
-- Réversibilité : rétablir les deux fonctions de la migration 007600.
-- =============================================================================

create or replace function private.clean_reference_labels(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value text;
  v_result jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or not (p ? 'fr') or not (p ? 'en')
     or (select count(*) from jsonb_object_keys(p)) > 20 then
    perform private.fail('invalid_payload', '22023');
  end if;
  for v_key in select k from jsonb_object_keys(p) as k order by k loop
    if v_key !~ '^[a-z]{2,3}$'
       or jsonb_typeof(p -> v_key) is distinct from 'string'
       or not exists (select 1 from public.languages l where l.code = v_key) then
      perform private.fail('invalid_payload', '22023');
    end if;
    v_value := private.clean_line(p ->> v_key);
    if v_value is null
       or char_length(v_value) > 120
       or not private.is_clean_long_text(v_value, 120)
       or v_value ~ '[[:cntrl:]]'
       or v_value ~ '[<>]' then
      perform private.fail('invalid_payload', '22023');
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;
  return v_result;
end
$$;

create or replace function private.admin_save_reference_item(p_kind text, p jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind record;
  v_allowed text[];
  v_code text;
  v_parent text;
  v_position integer;
  v_isced smallint;
  v_labels jsonb;
  v_old jsonb;
  v_where text;
  v_count bigint;
  v_fields text[] := array[]::text[];
  v_target text;
begin
  perform private.require_admin();
  select * into v_kind from private.reference_kind(p_kind);
  if not found or jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if not v_kind.writable then
    perform private.fail('read_only_reference');
  end if;

  -- Champs admis, et aucun autre : ni `is_active`, ni `is_interface`.
  v_allowed := array['code', 'labels']
    || case when v_kind.parent_column is not null then array[v_kind.parent_column] else '{}'::text[] end
    || case when v_kind.has_position then array['position'] else '{}'::text[] end
    || case when p_kind = 'education_levels' then array['isced_level'] else '{}'::text[] end;
  if exists (select 1 from jsonb_object_keys(p) as k where k <> all (v_allowed)) then
    perform private.fail('invalid_payload', '22023');
  end if;

  v_code := p ->> 'code';
  if jsonb_typeof(p -> 'code') is distinct from 'string'
     or char_length(v_code) > 50 or v_code !~ v_kind.code_pattern then
    perform private.fail('invalid_payload', '22023');
  end if;
  if v_kind.parent_column is not null and p ? v_kind.parent_column then
    v_parent := p ->> v_kind.parent_column;
    if jsonb_typeof(p -> v_kind.parent_column) is distinct from 'string'
       or v_parent !~ '^[a-z][a-z0-9_]{1,49}$' then
      perform private.fail('invalid_payload', '22023');
    end if;
  end if;
  if v_kind.parent_is_key and v_parent is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'position' then
    if jsonb_typeof(p -> 'position') is distinct from 'number' or (p ->> 'position') !~ '^[0-9]{1,5}$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    v_position := (p ->> 'position')::integer;
  end if;
  if p ? 'isced_level' and jsonb_typeof(p -> 'isced_level') <> 'null' then
    if jsonb_typeof(p -> 'isced_level') <> 'number' or (p ->> 'isced_level') !~ '^[0-8]$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    v_isced := (p ->> 'isced_level')::smallint;
  end if;
  if p ? 'labels' then
    v_labels := private.clean_reference_labels(p -> 'labels');
  end if;

  -- Cent vingt écritures par heure et par administrateur.
  perform private.consume_user_quota('reference-write', 120, 3600);
  perform pg_advisory_xact_lock(hashtextextended('reference:' || p_kind, 0));

  v_where := 't.code = $1' || case when v_kind.parent_is_key then ' and t.program_code = $2' else '' end;
  v_target := case when v_kind.parent_is_key then v_parent || '/' || v_code else v_code end;
  if v_kind.parent_is_key then
    execute format('select to_jsonb(t) from public.%I t where %s', v_kind.table_name, v_where)
      into v_old using v_code, v_parent;
  else
    execute format('select to_jsonb(t) from public.%I t where %s', v_kind.table_name, v_where)
      into v_old using v_code;
  end if;

  -- Rattachement donné : il doit exister.
  if v_parent is not null and (v_old is null or v_parent is distinct from v_old ->> v_kind.parent_column) then
    execute format('select count(*) from public.%I t where t.code = $1', v_kind.parent_table)
      into v_count using v_parent;
    if v_count = 0 then
      perform private.fail('invalid_payload', '22023');
    end if;
  end if;

  if v_old is null then
    -- Création.
    if not v_kind.can_create then
      perform private.fail('not_found');
    end if;
    if v_labels is null or (v_kind.parent_column is not null and v_parent is null) then
      perform private.fail('invalid_payload', '22023');
    end if;
    execute format('select count(*) from public.%I', v_kind.table_name) into v_count;
    if v_count >= 2000 then
      perform private.fail('limit_reached');
    end if;

    -- Naît inactive ; `is_interface` reste faux.
    execute format(
      'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
      v_kind.table_name, v_kind.table_name
    ) using jsonb_build_object('code', v_code, 'labels', v_labels, 'is_active', false)
        || case when v_kind.parent_column is not null
                then jsonb_build_object(v_kind.parent_column, v_parent) else '{}'::jsonb end
        || case when v_kind.has_position
                then jsonb_build_object('position', coalesce(v_position, 0)) else '{}'::jsonb end
        || case when p_kind = 'education_levels'
                then jsonb_build_object('isced_level', v_isced) else '{}'::jsonb end
        || case when p_kind = 'languages'
                then jsonb_build_object('is_interface', false) else '{}'::jsonb end;

    perform private.write_audit(
      'platform', 'reference.created', v_uid, null, null, p_kind, v_target,
      jsonb_build_object('fields', (
        select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p) as k where k <> 'code'
      ))
    );
    return true;
  end if;

  -- Modification : seuls les champs donnés, et seulement s'ils changent.
  if v_labels is not null and v_labels <> v_old -> 'labels' then
    if v_kind.parent_is_key then
      execute format('update public.%I t set labels = $3 where %s', v_kind.table_name, v_where)
        using v_code, v_parent, v_labels;
    else
      execute format('update public.%I t set labels = $2 where %s', v_kind.table_name, v_where)
        using v_code, v_labels;
    end if;
    v_fields := array_append(v_fields, 'labels');
  end if;
  if v_position is not null and v_position <> (v_old ->> 'position')::integer then
    if v_kind.parent_is_key then
      execute format('update public.%I t set position = $3 where %s', v_kind.table_name, v_where)
        using v_code, v_parent, v_position;
    else
      execute format('update public.%I t set position = $2 where %s', v_kind.table_name, v_where)
        using v_code, v_position;
    end if;
    v_fields := array_append(v_fields, 'position');
  end if;
  if p_kind = 'education_levels' and p ? 'isced_level'
     and v_isced is distinct from (v_old ->> 'isced_level')::smallint then
    update public.education_levels t set isced_level = v_isced where t.code = v_code;
    v_fields := array_append(v_fields, 'isced_level');
  end if;
  -- Le domaine d'une filière est un simple rattachement : il peut changer.
  if p_kind = 'academic_programs' and v_parent is not null and v_parent <> v_old ->> 'domain_code' then
    update public.academic_programs t set domain_code = v_parent where t.code = v_code;
    v_fields := array_append(v_fields, 'domain_code');
  end if;

  if cardinality(v_fields) > 0 then
    perform private.write_audit(
      'platform', 'reference.updated', v_uid, null, null, p_kind, v_target,
      jsonb_build_object('fields', to_jsonb(v_fields))
    );
  end if;
  return false;
end
$$;
