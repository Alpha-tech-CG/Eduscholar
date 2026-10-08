-- =============================================================================
-- F-03 : les référentiels s'administrent sous la session de l'administrateur
-- =============================================================================
-- Les neuf tables de référence n'étaient modifiables par personne à travers
-- l'API. La matrice du modèle d'autorisation (§5.1, « Modifier un
-- référentiel ») réserve leur modification à l'administration de la
-- plateforme : elle passe désormais par trois fonctions.
--
--   - appelant `platform_admin` ou `super_admin`, second facteur présenté
--     depuis moins de dix minutes (`private.require_admin`) ; le refus de droit
--     est capturé, consigné et rendu en « 403 » sans lever, comme pour les
--     autres fonctions `admin_*` ;
--   - huit référentiels s'écrivent : pays, langues, types de ressource,
--     niveaux, domaines, filières, spécialités, matières. Les LICENCES se
--     lisent seulement (`read_only_reference`) : leurs indicateurs juridiques
--     (hébergement, redistribution, usage commercial, attribution) ne se
--     changent pas par un écran ;
--   - le code d'une ligne ne change jamais (clé citée ailleurs ; les
--     déclencheurs `*_prevent_key_change` le garantissent déjà), pas plus que
--     la filière d'une spécialité ou d'une matière, qui fait partie de leur
--     clé. Le domaine d'une filière, simple rattachement, peut changer ;
--   - les pays ne se créent pas : les codes ISO sont tous présents ;
--   - `languages.is_interface` ne s'écrit pas : c'est le code de l'application
--     qui décide des langues d'interface ;
--   - libellés : un objet par langue, `fr` et `en` obligatoires, autres langues
--     admises si elles figurent dans `languages` ; chaque libellé est
--     normalisé, borné à 120 caractères, sans caractère de commande ni de
--     format, sans `<` ni `>` ;
--   - une ligne créée naît INACTIVE : elle n'est proposée à personne tant
--     qu'un administrateur ne l'a pas activée ;
--   - jamais de suppression : une ligne se désactive. La dernière ligne active
--     d'une table ne se désactive pas (`last_active`), ni les codes câblés dans
--     la base (`protected_reference`) :
--       * le type de ressource `thesis` (contrainte
--         `resources_thesis_degree_only_for_thesis`, reprise d'une fiche dans
--         un projet) ;
--       * les langues d'interface (`is_interface`, aujourd'hui `fr` et `en`,
--         seules valeurs admises de `profiles.preferred_locale`).
--     Les licences `unknown` (valeur par défaut d'une fiche) et
--     `author-permission` (règle de modération) sont câblées aussi : elles
--     sont hors d'atteinte, les licences ne s'écrivant pas ;
--   - deux mille lignes au plus par table ; cent vingt écritures par heure et
--     par administrateur ;
--   - journal d'audit : `reference.created|updated|activated|deactivated`,
--     table et code en cible, et les seuls NOMS des champs modifiés. Jamais un
--     libellé.
--
-- Désactiver ne casse rien. Les déclencheurs de validation ne contrôlaient déjà
-- un code simple (pays, niveau du profil, filière, type, langue…) que
-- lorsqu'il change : un profil ou une fiche qui porte un code désactivé reste
-- modifiable sur ses autres champs, et le code ne peut plus être nouvellement
-- choisi. Les LISTES faisaient exception, ce que cette migration corrige :
--   - `resources.level_codes` et `resources.subject_codes` étaient revalidées
--     à CHAQUE écriture : désactiver un niveau ou une matière aurait bloqué
--     toute modification des fiches qui le portent, décisions de modération
--     comprises ;
--   - `profiles.subject_codes` était revalidée en entier dès qu'elle changeait :
--     impossible d'ajouter une matière sans retirer d'abord celle qui avait été
--     désactivée, que l'écran ne montre plus.
-- Règle unique désormais : une liste n'est contrôlée que si elle change, et
-- seuls les codes AJOUTÉS doivent être actifs ; un code déjà porté est gardé.
-- À la création d'une fiche, ou quand la filière change, tous doivent l'être.
--
-- `reference_data()` n'est pas modifiée : elle ne rend que les lignes actives,
-- avec tous leurs libellés, sans filtre ni troncature (vérifié par les tests).
--
-- Réversibilité : supprimer les fonctions `admin_*reference*` et leurs appuis ;
-- rétablir `refuse_admin_operation` (007300), `validate_profile_references`
-- (000700) et `validate_resource_references` (001000).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Refus consignés : opérations de ce lot ajoutées à la liste fermée
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
                         'create_organization', 'set_organization_status', 'invite_org_admin',
                         'rename_organization', 'dissolve_organization', 'list_organizations',
                         'reference_items', 'save_reference_item', 'set_reference_active')
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
-- Appuis
-- -----------------------------------------------------------------------------
-- Liste fermée des référentiels. Le nom de table n'en sort jamais autrement.
create function private.reference_kind(p_kind text)
returns table (
  table_name text, code_pattern text, parent_column text, parent_table text,
  parent_is_key boolean, has_position boolean, can_create boolean, writable boolean
)
language sql
immutable
set search_path = ''
as $$
  select k.table_name, k.code_pattern, k.parent_column, k.parent_table,
         k.parent_is_key, k.has_position, k.can_create, k.writable
  from (values
    ('countries', '^[A-Z]{2}$', null, null, false, false, false, true),
    ('languages', '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$', null, null, false, false, true, true),
    ('licenses', '^[a-z0-9][a-z0-9.-]{1,49}$', null, null, false, true, false, false),
    ('resource_types', '^[a-z][a-z0-9_]{1,49}$', null, null, false, true, true, true),
    ('education_levels', '^[a-z][a-z0-9_]{1,49}$', null, null, false, true, true, true),
    ('academic_domains', '^[a-z][a-z0-9_]{1,49}$', null, null, false, false, true, true),
    ('academic_programs', '^[a-z][a-z0-9_]{1,49}$', 'domain_code', 'academic_domains', false, false, true, true),
    ('program_specialties', '^[a-z][a-z0-9_]{1,49}$', 'program_code', 'academic_programs', true, true, true, true),
    ('subjects', '^[a-z][a-z0-9_]{1,49}$', 'program_code', 'academic_programs', true, true, true, true)
  ) as k (table_name, code_pattern, parent_column, parent_table, parent_is_key, has_position, can_create, writable)
  where k.table_name = p_kind;
$$;

-- Libellés nettoyés, ou une erreur : `fr` et `en` obligatoires, autres langues
-- connues admises, 120 caractères, ni balise ni caractère de commande.
create function private.clean_reference_labels(p jsonb)
returns jsonb
language plpgsql
stable
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

revoke all on function private.reference_kind(text) from public, anon, authenticated, service_role;
revoke all on function private.clean_reference_labels(jsonb) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lire : lignes actives et inactives, avec leur nombre d'usages
-- -----------------------------------------------------------------------------
create function private.admin_reference_items(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_admin();
  if p_kind is null or not exists (select 1 from private.reference_kind(p_kind)) then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Soixante lectures par minute et par administrateur.
  perform private.consume_user_quota('reference-admin-read', 60, 60);

  -- Les usages sont des nombres : jamais la liste des comptes ou des fiches.
  case p_kind
    when 'countries' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'usage_count', (select count(*) from public.profiles p where p.country_code = x.code)
                     + (select count(*) from public.resources r where r.country_code = x.code)
      ) order by x.code) into v_result
      from public.countries x;
    when 'languages' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'is_interface', x.is_interface,
        'usage_count', (select count(*) from public.resources r where r.language_code = x.code)
      ) order by x.code) into v_result
      from public.languages x;
    when 'licenses' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'position', x.position,
        'can_host', x.can_host, 'can_redistribute', x.can_redistribute,
        'allows_commercial_use', x.allows_commercial_use, 'requires_attribution', x.requires_attribution,
        'read_only', true,
        'usage_count', (select count(*) from public.resources r where r.license_code = x.code)
      ) order by x.position, x.code) into v_result
      from public.licenses x;
    when 'resource_types' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'position', x.position,
        'usage_count', (select count(*) from public.resources r where r.type_code = x.code)
      ) order by x.position, x.code) into v_result
      from public.resource_types x;
    when 'education_levels' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'position', x.position,
        'isced_level', x.isced_level,
        'usage_count', (select count(*) from public.profiles p where p.level_code = x.code)
                     + (select count(*) from public.resources r where x.code = any (r.level_codes))
      ) order by x.position, x.code) into v_result
      from public.education_levels x;
    when 'academic_domains' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'usage_count', (select count(*) from public.academic_programs a where a.domain_code = x.code)
      ) order by x.code) into v_result
      from public.academic_domains x;
    when 'academic_programs' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'domain_code', x.domain_code, 'labels', x.labels, 'is_active', x.is_active,
        'usage_count', (select count(*) from public.profiles p where p.program_code = x.code)
                     + (select count(*) from public.resources r where r.program_code = x.code)
                     + (select count(*) from public.research_projects j where j.program_code = x.code)
      ) order by x.code) into v_result
      from public.academic_programs x;
    when 'program_specialties' then
      select jsonb_agg(jsonb_build_object(
        'program_code', x.program_code, 'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'position', x.position,
        'usage_count', (select count(*) from public.profiles p
                        where p.program_code = x.program_code and p.specialty_code = x.code)
      ) order by x.program_code, x.position, x.code) into v_result
      from public.program_specialties x;
    else
      select jsonb_agg(jsonb_build_object(
        'program_code', x.program_code, 'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'position', x.position,
        'usage_count', (select count(*) from public.profiles p
                        where p.program_code = x.program_code and x.code = any (p.subject_codes))
                     + (select count(*) from public.resources r
                        where r.program_code = x.program_code and x.code = any (r.subject_codes))
      ) order by x.program_code, x.position, x.code) into v_result
      from public.subjects x;
  end case;
  return coalesce(v_result, '[]'::jsonb);
end
$$;

-- -----------------------------------------------------------------------------
-- Créer ou modifier une ligne. Rend vrai si la ligne a été créée.
-- -----------------------------------------------------------------------------
create function private.admin_save_reference_item(p_kind text, p jsonb)
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
  v_fields text[] := '{}';
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

-- -----------------------------------------------------------------------------
-- Activer, désactiver. Jamais de suppression.
-- -----------------------------------------------------------------------------
create function private.admin_set_reference_active(
  p_kind text, p_code text, p_active boolean, p_parent_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind record;
  v_where text;
  v_current boolean;
  v_count bigint;
begin
  perform private.require_admin();
  select * into v_kind from private.reference_kind(p_kind);
  if not found or p_code is null or p_active is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  if not v_kind.writable then
    perform private.fail('read_only_reference');
  end if;
  if char_length(p_code) > 50 or p_code !~ v_kind.code_pattern
     or (v_kind.parent_is_key and (p_parent_code is null or p_parent_code !~ '^[a-z][a-z0-9_]{1,49}$'))
     or (not v_kind.parent_is_key and p_parent_code is not null) then
    perform private.fail('invalid_payload', '22023');
  end if;

  perform private.consume_user_quota('reference-write', 120, 3600);
  perform pg_advisory_xact_lock(hashtextextended('reference:' || p_kind, 0));

  v_where := 't.code = $1' || case when v_kind.parent_is_key then ' and t.program_code = $2' else '' end;
  if v_kind.parent_is_key then
    execute format('select t.is_active from public.%I t where %s', v_kind.table_name, v_where)
      into v_current using p_code, p_parent_code;
  else
    execute format('select t.is_active from public.%I t where %s', v_kind.table_name, v_where)
      into v_current using p_code;
  end if;
  if v_current is null then
    perform private.fail('not_found');
  end if;
  if v_current = p_active then
    perform private.fail('invalid_transition', '22023');
  end if;

  if not p_active then
    -- Codes dont la base elle-même a besoin.
    if (p_kind = 'resource_types' and p_code = 'thesis')
       or (p_kind = 'languages' and exists (
             select 1 from public.languages l where l.code = p_code and l.is_interface
           )) then
      perform private.fail('protected_reference');
    end if;
    execute format('select count(*) from public.%I t where t.is_active', v_kind.table_name) into v_count;
    if v_count <= 1 then
      perform private.fail('last_active');
    end if;
  end if;

  if v_kind.parent_is_key then
    execute format('update public.%I t set is_active = $3 where %s', v_kind.table_name, v_where)
      using p_code, p_parent_code, p_active;
  else
    execute format('update public.%I t set is_active = $2 where %s', v_kind.table_name, v_where)
      using p_code, p_active;
  end if;

  perform private.write_audit(
    'platform', case when p_active then 'reference.activated' else 'reference.deactivated' end,
    v_uid, null, null, p_kind,
    case when v_kind.parent_is_key then p_parent_code || '/' || p_code else p_code end,
    '{}'::jsonb
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes : le refus de droit est capturé, consigné, rendu en « 403 »
-- -----------------------------------------------------------------------------
create function public.admin_reference_items(kind text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.admin_reference_items(kind);
exception when insufficient_privilege then
  return private.refuse_admin_operation('reference_items', sqlerrm);
end
$$;

create function public.admin_save_reference_item(kind text, payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return jsonb_build_object('created', private.admin_save_reference_item(kind, payload));
exception when insufficient_privilege then
  return private.refuse_admin_operation('save_reference_item', sqlerrm);
end
$$;

create function public.admin_set_reference_active(kind text, code text, active boolean, parent_code text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_set_reference_active(kind, code, active, parent_code);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('set_reference_active', sqlerrm);
end
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'admin_reference_items(text)',
    'admin_save_reference_item(text, jsonb)',
    'admin_set_reference_active(text, text, boolean, text)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Désactiver ne casse rien : une liste n'est contrôlée que sur ses ajouts
-- -----------------------------------------------------------------------------
create or replace function private.validate_profile_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invalid text;
begin
  if new.country_code is not null
     and new.country_code is distinct from old.country_code
     and not exists (
       select 1 from public.countries c where c.code = new.country_code and c.is_active
     ) then
    raise exception 'Pays inconnu ou inactif.' using errcode = '23514';
  end if;

  if new.level_code is not null
     and new.level_code is distinct from old.level_code
     and not exists (
       select 1 from public.education_levels l where l.code = new.level_code and l.is_active
     ) then
    raise exception 'Niveau inconnu ou inactif.' using errcode = '23514';
  end if;

  if new.program_code is not null
     and new.program_code is distinct from old.program_code
     and not exists (
       select 1 from public.academic_programs p where p.code = new.program_code and p.is_active
     ) then
    raise exception 'Filière inconnue ou inactive.' using errcode = '23514';
  end if;

  if new.specialty_code is not null
     and (new.specialty_code is distinct from old.specialty_code
          or new.program_code is distinct from old.program_code)
     and not exists (
       select 1
       from public.program_specialties s
       where s.program_code = new.program_code
         and s.code = new.specialty_code
         and s.is_active
     ) then
    raise exception 'Spécialité inconnue pour cette filière.' using errcode = '23514';
  end if;

  if new.subject_codes is distinct from old.subject_codes
     or new.program_code is distinct from old.program_code then
    if cardinality(new.subject_codes) <> (
      select count(distinct code) from unnest(new.subject_codes) as u (code)
    ) then
      raise exception 'Une matière ne peut figurer qu''une fois.' using errcode = '23514';
    end if;

    -- Une matière déjà portée, désactivée depuis, se garde ; une matière
    -- ajoutée, ou toute matière si la filière change, doit être active.
    select u.code into v_invalid
    from unnest(new.subject_codes) as u (code)
    where (new.program_code is distinct from old.program_code
           or u.code <> all (coalesce(old.subject_codes, '{}'::text[])))
      and not exists (
        select 1
        from public.subjects s
        where s.program_code = new.program_code and s.code = u.code and s.is_active
      )
    limit 1;

    if v_invalid is not null then
      raise exception 'Matière inconnue pour cette filière.' using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create or replace function private.validate_resource_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_levels text[] := '{}';
  v_old_subjects text[] := '{}';
  v_program_changed boolean := true;
begin
  if (tg_op = 'INSERT' or new.type_code is distinct from old.type_code)
     and not exists (
       select 1 from public.resource_types t where t.code = new.type_code and t.is_active
     ) then
    raise exception 'invalid_type' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.license_code is distinct from old.license_code)
     and not exists (
       select 1 from public.licenses l where l.code = new.license_code and l.is_active
     ) then
    raise exception 'invalid_license' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.language_code is distinct from old.language_code)
     and not exists (
       select 1 from public.languages l where l.code = new.language_code and l.is_active
     ) then
    raise exception 'invalid_language' using errcode = '23514';
  end if;

  if new.country_code is not null
     and (tg_op = 'INSERT' or new.country_code is distinct from old.country_code)
     and not exists (
       select 1 from public.countries c where c.code = new.country_code and c.is_active
     ) then
    raise exception 'invalid_country' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.program_code is distinct from old.program_code)
     and not exists (
       select 1 from public.academic_programs p where p.code = new.program_code and p.is_active
     ) then
    raise exception 'invalid_program' using errcode = '23514';
  end if;

  -- Listes : un code déjà porté par la fiche, désactivé depuis, se garde ; un
  -- code ajouté doit être actif. À la création, ou si la filière change pour
  -- les matières, tous doivent l'être.
  if tg_op = 'UPDATE' then
    v_old_levels := coalesce(old.level_codes, '{}'::text[]);
    v_old_subjects := coalesce(old.subject_codes, '{}'::text[]);
    v_program_changed := new.program_code is distinct from old.program_code;
  end if;

  if exists (
    select 1
    from unnest(new.level_codes) as u (code)
    where u.code <> all (v_old_levels)
      and not exists (
        select 1 from public.education_levels l where l.code = u.code and l.is_active
      )
  ) then
    raise exception 'invalid_level' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(new.subject_codes) as u (code)
    where (v_program_changed or u.code <> all (v_old_subjects))
      and not exists (
        select 1
        from public.subjects s
        where s.program_code = new.program_code and s.code = u.code and s.is_active
      )
  ) then
    raise exception 'invalid_subject' using errcode = '23514';
  end if;

  return new;
end
$$;
