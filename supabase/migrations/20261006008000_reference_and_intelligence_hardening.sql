-- =============================================================================
-- F-03, Phase 6 : corrections de la relecture de sécurité
-- =============================================================================
-- RÉFÉRENTIELS
--   A-1a. Plancher par filière : la dernière matière active, ou la dernière
--         spécialité active, d'une filière ACTIVE ne se désactive pas
--         (`last_active`). Le plancher global par table reste.
--   A-1b. Codes câblés hors de la base : le connecteur d'import
--         (apps/web/src/lib/connectors/crossref-normalize.ts) écrit en dur les
--         types `article`, `book` et `thesis`, et rien d'autre côté
--         référentiels inscriptibles — la langue vient de la source ou du
--         formulaire du modérateur, sans repli câblé ; la filière vient du
--         formulaire. Il écrit aussi la licence `unknown` et les licences
--         Creative Commons reconnues, hors d'atteinte puisque les licences ne
--         s'écrivent pas. Liste des codes protégés (`protected_reference`) :
--         types `thesis`, `article`, `book` ; langues d'interface.
--   A-2.  Parent inactif : `reference_data()` ne rend plus les filières d'un
--         domaine désactivé, ni les spécialités et matières d'une filière qui
--         n'est pas rendue (désactivée, ou d'un domaine désactivé). Sa forme ne
--         change pas. Les deux déclencheurs de validation refusent d'AJOUTER
--         une matière ou une spécialité dont la filière est désactivée ; ce
--         qui est déjà porté reste.
--   A-3.  Libellés : refusés s'ils commencent par `=`, `+`, `-` ou `@`
--         (formule dans un export tableur), ou s'ils ne contiennent aucune
--         lettre. Caractères invisibles et bidirectionnels refusés, par leur
--         code :
--           U+0080–U+009F  contrôles C1
--           U+00AD         trait d'union conditionnel
--           U+061C         marque arabe de direction
--           U+115F, U+1160 remplissages hangul
--           U+180E         séparateur de voyelles mongol
--           U+200B–U+200F  espaces sans chasse, marques de direction
--           U+2028–U+202E  séparateurs de ligne, plongements et forçages
--           U+2060–U+2069  liant, opérateurs invisibles, isolats
--           U+3164, U+FFA0 remplissages hangul
--           U+FEFF         marque d'ordre des octets
--           U+E0000–U+E007F balises
--         en plus des caractères de commande C0 (`[[:cntrl:]]`).
--   A-5.  `usage_count` est calculé en un passage par table (agrégat puis
--         jointure), non plus par sous-requête pour chaque ligne.
--   A-6.  `usage_count` d'une filière ne compte plus les projets de recherche,
--         que seul leur propriétaire lit : profils et fiches seulement.
--
-- ASSISTANCE DOCUMENTAIRE
--   B-1.  `project_coherence_report` : règle retenue — un membre à accès
--         complet ne reçoit que les constats tirés de ce qu'il lit déjà par
--         `shared_project_document` (fiche du projet, sections, sources,
--         citations) et `project_tasks` (tâches, échéances). Le seul constat
--         tiré d'ailleurs, `cited_source_without_note`, vient des fiches de
--         lecture, privées au propriétaire : il n'est rendu qu'à lui. Les
--         quatorze autres ont été vérifiés un par un : chacun ne s'appuie que
--         sur les champs que ces deux lectures rendent déjà au membre.
--   B-2.  `private.fold_text` et `private.normalize_url` servent d'expression
--         d'index. APRÈS UNE MONTÉE DE VERSION DE POSTGRESQL OU DE L'EXTENSION
--         `unaccent`, réindexer `resources_title_trgm_idx` et
--         `resources_normalized_url_idx` : leurs valeurs pourraient avoir
--         changé. Le test 32 fige quelques valeurs pour le détecter.
--   B-3.  `similar_resources` : `same_url` n'a la confiance `high` que si les
--         deux liens d'origine sont égaux au protocole et à la casse de l'hôte
--         près ; s'ils ne coïncident qu'une fois normalisés (chemin mis en
--         minuscules, « www. », barre finale, ancre), la confiance est
--         `medium`. `normalize_url`, dont dépend un index, ne change pas.
--
-- Réversibilité : rétablir les fonctions des migrations 007000, 007600, 007700
-- et 007800 ; supprimer `private.url_exact_form`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A-3 : libellés
-- -----------------------------------------------------------------------------
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
       or v_value ~ '[<>]'
       -- Caractères invisibles et bidirectionnels : voir l'en-tête.
       or v_value ~ '[\u0080-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\u3164\uFFA0\uFEFF\U000E0000-\U000E007F]'
       -- Formule dans un export tableur.
       or v_value ~ '^[=+@-]'
       -- Au moins une lettre.
       or v_value !~ '[[:alpha:]]' then
      perform private.fail('invalid_payload', '22023');
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;
  return v_result;
end
$$;

-- -----------------------------------------------------------------------------
-- A-5, A-6 : lire, avec les usages comptés en un passage par table
-- -----------------------------------------------------------------------------
create or replace function private.admin_reference_items(p_kind text)
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
  -- Chaque table utilisatrice est agrégée une fois, puis jointe.
  case p_kind
    when 'countries' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'usage_count', coalesce(u.n, 0)
      ) order by x.code) into v_result
      from public.countries x
      left join (
        select q.code, sum(q.n)::bigint as n from (
          select p.country_code as code, count(*) as n from public.profiles p
          where p.country_code is not null group by p.country_code
          union all
          select r.country_code, count(*) from public.resources r
          where r.country_code is not null group by r.country_code
        ) q group by q.code
      ) u on u.code = x.code;
    when 'languages' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'is_interface', x.is_interface,
        'usage_count', coalesce(u.n, 0)
      ) order by x.code) into v_result
      from public.languages x
      left join (
        select r.language_code as code, count(*) as n from public.resources r group by r.language_code
      ) u on u.code = x.code;
    when 'licenses' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'position', x.position,
        'can_host', x.can_host, 'can_redistribute', x.can_redistribute,
        'allows_commercial_use', x.allows_commercial_use, 'requires_attribution', x.requires_attribution,
        'read_only', true,
        'usage_count', coalesce(u.n, 0)
      ) order by x.position, x.code) into v_result
      from public.licenses x
      left join (
        select r.license_code as code, count(*) as n from public.resources r group by r.license_code
      ) u on u.code = x.code;
    when 'resource_types' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'position', x.position,
        'usage_count', coalesce(u.n, 0)
      ) order by x.position, x.code) into v_result
      from public.resource_types x
      left join (
        select r.type_code as code, count(*) as n from public.resources r group by r.type_code
      ) u on u.code = x.code;
    when 'education_levels' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active, 'position', x.position,
        'isced_level', x.isced_level,
        'usage_count', coalesce(u.n, 0)
      ) order by x.position, x.code) into v_result
      from public.education_levels x
      left join (
        select q.code, sum(q.n)::bigint as n from (
          select p.level_code as code, count(*) as n from public.profiles p
          where p.level_code is not null group by p.level_code
          union all
          select l.code, count(*) from public.resources r cross join lateral unnest(r.level_codes) as l (code)
          group by l.code
        ) q group by q.code
      ) u on u.code = x.code;
    when 'academic_domains' then
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'usage_count', coalesce(u.n, 0)
      ) order by x.code) into v_result
      from public.academic_domains x
      left join (
        select a.domain_code as code, count(*) as n from public.academic_programs a group by a.domain_code
      ) u on u.code = x.code;
    when 'academic_programs' then
      -- Profils et fiches seulement : les projets de recherche ne se comptent pas.
      select jsonb_agg(jsonb_build_object(
        'code', x.code, 'domain_code', x.domain_code, 'labels', x.labels, 'is_active', x.is_active,
        'usage_count', coalesce(u.n, 0)
      ) order by x.code) into v_result
      from public.academic_programs x
      left join (
        select q.code, sum(q.n)::bigint as n from (
          select p.program_code as code, count(*) as n from public.profiles p
          where p.program_code is not null group by p.program_code
          union all
          select r.program_code, count(*) from public.resources r group by r.program_code
        ) q group by q.code
      ) u on u.code = x.code;
    when 'program_specialties' then
      select jsonb_agg(jsonb_build_object(
        'program_code', x.program_code, 'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'position', x.position,
        'usage_count', coalesce(u.n, 0)
      ) order by x.program_code, x.position, x.code) into v_result
      from public.program_specialties x
      left join (
        select p.program_code, p.specialty_code as code, count(*) as n from public.profiles p
        where p.specialty_code is not null group by p.program_code, p.specialty_code
      ) u on u.program_code = x.program_code and u.code = x.code;
    else
      select jsonb_agg(jsonb_build_object(
        'program_code', x.program_code, 'code', x.code, 'labels', x.labels, 'is_active', x.is_active,
        'position', x.position,
        'usage_count', coalesce(u.n, 0)
      ) order by x.program_code, x.position, x.code) into v_result
      from public.subjects x
      left join (
        select q.program_code, q.code, sum(q.n)::bigint as n from (
          select p.program_code, s.code, count(*) as n
          from public.profiles p cross join lateral unnest(p.subject_codes) as s (code)
          where p.program_code is not null group by p.program_code, s.code
          union all
          select r.program_code, s.code, count(*)
          from public.resources r cross join lateral unnest(r.subject_codes) as s (code)
          group by r.program_code, s.code
        ) q group by q.program_code, q.code
      ) u on u.program_code = x.program_code and u.code = x.code;
  end case;
  return coalesce(v_result, '[]'::jsonb);
end
$$;

-- -----------------------------------------------------------------------------
-- A-2 : `reference_data()` ne rend rien sous un parent désactivé
-- -----------------------------------------------------------------------------
create or replace function private.reference_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.is_account_active() then null else jsonb_build_object(
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                  from public.countries x where x.is_active),
    'languages', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                  from public.languages x where x.is_active),
    'licenses', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels, 'can_host', x.can_host) order by x.position, x.code), '[]'::jsonb)
                 from public.licenses x where x.is_active),
    'resource_types', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                       from public.resource_types x where x.is_active),
    'education_levels', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                         from public.education_levels x where x.is_active),
    'academic_domains', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                         from public.academic_domains x where x.is_active),
    -- Une filière n'est rendue que si son domaine est actif.
    'academic_programs', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'domain_code', x.domain_code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                          from public.academic_programs x
                          join public.academic_domains d on d.code = x.domain_code and d.is_active
                          where x.is_active),
    -- Spécialités et matières : seulement celles d'une filière elle-même rendue.
    'program_specialties', (select coalesce(jsonb_agg(jsonb_build_object('program_code', x.program_code, 'code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                            from public.program_specialties x
                            join public.academic_programs a on a.code = x.program_code and a.is_active
                            join public.academic_domains d on d.code = a.domain_code and d.is_active
                            where x.is_active),
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object('program_code', x.program_code, 'code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                 from public.subjects x
                 join public.academic_programs a on a.code = x.program_code and a.is_active
                 join public.academic_domains d on d.code = a.domain_code and d.is_active
                 where x.is_active)
  ) end;
$$;

-- -----------------------------------------------------------------------------
-- A-1a, A-1b : désactiver
-- -----------------------------------------------------------------------------
create or replace function private.admin_set_reference_active(
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
    if (p_kind = 'resource_types' and p_code in ('thesis', 'article', 'book'))
       or (p_kind = 'languages' and exists (
             select 1 from public.languages l where l.code = p_code and l.is_interface
           )) then
      perform private.fail('protected_reference');
    end if;
    execute format('select count(*) from public.%I t where t.is_active', v_kind.table_name) into v_count;
    if v_count <= 1 then
      perform private.fail('last_active');
    end if;
    -- Plancher par filière : une filière active garde au moins une matière et
    -- une spécialité actives, si elle en a.
    if v_kind.parent_is_key and exists (
      select 1 from public.academic_programs a where a.code = p_parent_code and a.is_active
    ) then
      execute format('select count(*) from public.%I t where t.is_active and t.program_code = $1', v_kind.table_name)
        into v_count using p_parent_code;
      if v_count <= 1 then
        perform private.fail('last_active');
      end if;
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
-- A-2 : rien ne s'ajoute sous une filière désactivée
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
         -- Filière désactivée : plus aucune spécialité ne s'y choisit.
         and exists (select 1 from public.academic_programs a where a.code = s.program_code and a.is_active)
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
          -- Filière désactivée : plus aucune matière ne s'y ajoute.
          and exists (select 1 from public.academic_programs a where a.code = s.program_code and a.is_active)
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
          -- Filière désactivée : plus aucune matière ne s'y ajoute.
          and exists (select 1 from public.academic_programs a where a.code = s.program_code and a.is_active)
      )
  ) then
    raise exception 'invalid_subject' using errcode = '23514';
  end if;

  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- B-3 : un lien identique « certain », un lien identique une fois normalisé
-- -----------------------------------------------------------------------------
-- Lien d'origine au protocole et à la casse de l'hôte près : rien d'autre n'est
-- touché, ni le chemin, ni « www. », ni la barre finale, ni l'ancre.
create function private.url_exact_form(p_url text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_url is null then null else
    lower(substring(regexp_replace(p_url, '^[A-Za-z][A-Za-z0-9+.-]*://', '') from '^[^/?#]*'))
    || substring(regexp_replace(p_url, '^[A-Za-z][A-Za-z0-9+.-]*://', '') from '^[^/?#]*(.*)$')
  end;
$$;
revoke all on function private.url_exact_form(text) from public, anon, authenticated, service_role;

-- Le seuil de similarité est posé sur la fonction (`set pg_trgm.…`). Ce réglage
-- n'est accepté à la création que si la bibliothèque de l'extension est déjà
-- chargée dans la session : un appel à l'une de ses fonctions la charge.
select extensions.similarity('a', 'a');

create or replace function private.similar_resources(p_resource_id uuid)
returns table (id uuid, title text, editorial_status text, reason text, score numeric, confidence text)
language plpgsql
security definer
set search_path = ''
set pg_trgm.similarity_threshold = 0.6
as $$
declare
  v_row public.resources;
  v_title text;
  v_url text;
  v_doi text;
  v_url_exact text;
  v_authors text[];
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;
  select * into v_row from public.resources r where r.id = p_resource_id and r.visibility = 'public';
  if not found then
    perform private.fail('not_found');
  end if;
  -- Cent vingt recherches par cinq minutes et par compte.
  perform private.consume_user_quota('similar-resources', 120, 300);

  v_title := private.fold_text(v_row.title);
  v_url := private.normalize_url(v_row.official_url);
  v_doi := lower(v_row.doi);
  v_url_exact := private.url_exact_form(v_row.official_url);
  v_authors := array(select private.fold_text(a.name) from unnest(v_row.authors) as a (name));

  return query
  with candidates as (
    select r.id, r.title, r.editorial_status,
           (v_doi is not null and lower(r.doi) = v_doi) as same_doi,
           (v_url is not null and r.official_url is not null
              and private.normalize_url(r.official_url) = v_url) as same_url,
           (v_url_exact is not null and private.url_exact_form(r.official_url) = v_url_exact) as exact_url,
           extensions.similarity(private.fold_text(r.title), v_title) as sim,
           (r.publication_year is not null and r.publication_year = v_row.publication_year) as same_year,
           exists (
             select 1 from unnest(r.authors) as a (name) where private.fold_text(a.name) = any (v_authors)
           ) as common_author
    from public.resources r
    where r.visibility = 'public'
      and r.id <> p_resource_id
      and ((v_doi is not null and r.doi is not null and lower(r.doi) = v_doi)
        or (v_url is not null and r.official_url is not null
              and private.normalize_url(r.official_url) = v_url)
        -- Un titre trop court ne dit rien : huit caractères au moins.
        or (char_length(v_title) >= 8
              and private.fold_text(r.title) operator(extensions.%) v_title))
  )
  select c.id, c.title, c.editorial_status,
         case when c.same_doi then 'same_doi' when c.same_url then 'same_url' else 'similar_title' end,
         case when c.same_doi or c.same_url then 1.00 else round(c.sim::numeric, 2) end,
         case
           when c.same_doi then 'high'
           when c.same_url then case when c.exact_url then 'high' else 'medium' end
           when c.sim >= 0.9 and c.same_year and c.common_author then 'high'
           when c.sim >= 0.8 or (c.same_year and c.common_author) then 'medium'
           else 'low'
         end
  from candidates c
  where c.same_doi or c.same_url or (c.sim >= 0.6 and (c.same_year or c.common_author))
  order by case when c.same_doi then 0 when c.same_url then 1 else 2 end, c.sim desc, c.id
  limit 20;
end
$$;

-- -----------------------------------------------------------------------------
-- B-1 : le rapport de cohérence, selon qui le lit
-- -----------------------------------------------------------------------------
create or replace function private.project_coherence_report(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.project_role(p_project_id);
  v_project public.research_projects;
  v_findings jsonb := '[]'::jsonb;
  v_items jsonb;
  v_fields text[];
  v_median numeric;
  v_written integer;
  v_year integer := extract(year from current_date)::integer;
  v_with_year integer;
  v_recent integer;
  v_old integer;
  v_newest integer;
  v_days integer;
begin
  -- Soixante rapports par cinq minutes et par compte.
  perform private.consume_user_quota('project-coherence', 60, 300);
  select * into v_project from public.research_projects r where r.id = p_project_id;

  -- Fiche du projet incomplète.
  v_fields := array_remove(array[
    case when nullif(btrim(coalesce(v_project.problem_statement, '')), '') is null then 'problem_statement' end,
    case when nullif(btrim(coalesce(v_project.main_question, '')), '') is null then 'main_question' end,
    case when nullif(btrim(coalesce(v_project.general_objective, '')), '') is null then 'general_objective' end,
    case when nullif(btrim(coalesce(v_project.methodology, '')), '') is null then 'methodology' end
  ], null);
  if cardinality(v_fields) > 0 then
    v_findings := v_findings || jsonb_build_object(
      'code', 'project_incomplete', 'severity', 'warning', 'count', cardinality(v_fields), 'fields', to_jsonb(v_fields));
  end if;

  -- Échéance du projet, tant qu'il n'est ni terminé ni archivé.
  if v_project.due_date is not null and v_project.status in ('draft', 'in_progress') then
    v_days := v_project.due_date - current_date;
    if v_days < 0 then
      v_findings := v_findings || jsonb_build_object(
        'code', 'project_overdue', 'severity', 'warning', 'count', 1, 'days_late', -v_days);
    elsif v_days <= 30 then
      v_findings := v_findings || jsonb_build_object(
        'code', 'project_due_soon', 'severity', 'info', 'count', 1, 'days_left', v_days);
    end if;
  end if;

  -- Tâches en retard.
  select jsonb_agg(t.id order by t.due_date, t.id) into v_items
  from public.project_tasks t
  where t.project_id = p_project_id and t.done_at is null and t.due_date < current_date;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'task_overdue', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'task_ids', v_items);
  end if;

  -- Sections sans texte.
  select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) = 0;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'section_empty', 'severity', 'info', 'count', jsonb_array_length(v_items), 'sections', v_items);
  end if;

  -- Sections rédigées sans aucune citation.
  select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) >= 300
    and not exists (select 1 from public.section_citations c where c.section_id = s.id);
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'section_without_citation', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'sections', v_items);
  end if;

  -- Sections rédigées qui ne s'appuient que sur une seule source.
  select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) >= 300
    and (select count(*) from public.section_citations c where c.section_id = s.id) = 1;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'section_single_source', 'severity', 'info', 'count', jsonb_array_length(v_items), 'sections', v_items);
  end if;

  -- Sections très courtes par rapport aux autres.
  select count(*), percentile_cont(0.5) within group (order by char_length(btrim(s.body)))
  into v_written, v_median
  from public.thesis_sections s
  where s.project_id = p_project_id and char_length(btrim(coalesce(s.body, ''))) > 0;
  if v_written >= 3 and v_median >= 400 then
    select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.position) into v_items
    from public.thesis_sections s
    where s.project_id = p_project_id
      and char_length(btrim(coalesce(s.body, ''))) > 0
      and char_length(btrim(s.body)) < v_median / 4;
    if v_items is not null then
      v_findings := v_findings || jsonb_build_object(
        'code', 'section_short', 'severity', 'info', 'count', jsonb_array_length(v_items), 'sections', v_items);
    end if;
  end if;

  -- Sources jamais citées.
  select jsonb_agg(s.id order by s.created_at, s.id) into v_items
  from public.project_sources s
  where s.project_id = p_project_id
    and not exists (select 1 from public.section_citations c where c.source_id = s.id);
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'source_never_cited', 'severity', 'info', 'count', jsonb_array_length(v_items), 'source_ids', v_items);
  end if;

  -- Citations sans page, là où la source a des pages.
  select jsonb_agg(jsonb_build_object('section_id', c.section_id, 'source_id', c.source_id)
                   order by t.position, c.source_id) into v_items
  from public.section_citations c
  join public.thesis_sections t on t.id = c.section_id
  join public.project_sources s on s.id = c.source_id
  where t.project_id = p_project_id
    and nullif(btrim(coalesce(c.pages, '')), '') is null
    and nullif(btrim(coalesce(s.pages, '')), '') is not null;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'citation_without_pages', 'severity', 'info', 'count', jsonb_array_length(v_items), 'citations', v_items);
  end if;

  -- Sources incomplètes pour la bibliographie : auteur, année ou titre manquant.
  select jsonb_agg(jsonb_build_object('id', q.id, 'missing', to_jsonb(q.missing)) order by q.created_at, q.id) into v_items
  from (
    select s.id, s.created_at, array_remove(array[
      case when cardinality(s.authors) = 0 then 'authors' end,
      case when s.publication_year is null then 'publication_year' end,
      case when nullif(btrim(coalesce(s.title, '')), '') is null then 'title' end
    ], null) as missing
    from public.project_sources s
    where s.project_id = p_project_id
  ) q
  where cardinality(q.missing) > 0;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'source_incomplete', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'sources', v_items);
  end if;

  -- Sources en double dans le projet : même DOI, ou même titre normalisé.
  select jsonb_agg(g.ids order by g.ids::text) into v_items
  from (
    select distinct q.ids
    from (
      select to_jsonb(array_agg(s.id order by s.id)) as ids
      from public.project_sources s
      where s.project_id = p_project_id and s.doi is not null
      group by lower(s.doi) having count(*) > 1
      union all
      select to_jsonb(array_agg(s.id order by s.id))
      from public.project_sources s
      where s.project_id = p_project_id and private.fold_text(s.title) <> ''
      group by private.fold_text(s.title) having count(*) > 1
    ) q
  ) g;
  if v_items is not null then
    v_findings := v_findings || jsonb_build_object(
      'code', 'source_duplicate', 'severity', 'warning', 'count', jsonb_array_length(v_items), 'groups', v_items);
  end if;

  -- Lacunes de la littérature, d'après l'année des sources qui en ont une.
  select count(*), count(*) filter (where s.publication_year >= v_year - 5),
         count(*) filter (where s.publication_year < v_year - 10), max(s.publication_year)
  into v_with_year, v_recent, v_old, v_newest
  from public.project_sources s
  where s.project_id = p_project_id and s.publication_year is not null;
  if v_with_year > 0 and v_recent = 0 then
    v_findings := v_findings || jsonb_build_object(
      'code', 'literature_none_recent', 'severity', 'warning', 'count', v_with_year, 'newest_year', v_newest);
  end if;
  if v_with_year >= 4 and v_old * 4 > v_with_year * 3 then
    v_findings := v_findings || jsonb_build_object(
      'code', 'literature_mostly_old', 'severity', 'info', 'count', v_old, 'sources_with_year', v_with_year);
  end if;

  -- Les fiches de lecture sont privées au propriétaire : un membre, même à
  -- accès complet, ne les lit nulle part. Ce constat n'est rendu qu'à lui.
  if v_role = 'owner' then
    -- Sources citées sans fiche de lecture.
    select jsonb_agg(s.id order by s.created_at, s.id) into v_items
    from public.project_sources s
    where s.project_id = p_project_id
      and exists (select 1 from public.section_citations c where c.source_id = s.id)
      and not exists (
        select 1 from public.literature_notes n
        where n.source_id = s.id
          and btrim(concat(n.problem, n.concepts, n.method, n.population_field, n.results, n.limits,
                           n.useful_quote, n.project_link)) <> ''
      );
    if v_items is not null then
      v_findings := v_findings || jsonb_build_object(
        'code', 'cited_source_without_note', 'severity', 'info', 'count', jsonb_array_length(v_items), 'source_ids', v_items);
    end if;
  end if;

  return jsonb_build_object(
    'project_id', p_project_id,
    'role', v_role,
    'totals', jsonb_build_object(
      'sections', (select count(*) from public.thesis_sections s where s.project_id = p_project_id),
      'sources', (select count(*) from public.project_sources s where s.project_id = p_project_id),
      'citations', (select count(*) from public.section_citations c
                    join public.thesis_sections t on t.id = c.section_id where t.project_id = p_project_id),
      'tasks', (select count(*) from public.project_tasks t where t.project_id = p_project_id)
    ),
    'findings', v_findings
  );
end
$$;
