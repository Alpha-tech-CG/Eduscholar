-- =============================================================================
-- E-03 : corrections de la revue de sécurité des versions soumises
-- =============================================================================
--   - la liste des versions ne touche plus aux instantanés : nombre de sections
--     et taille sont rangés à la soumission ; elle est limitée en débit ;
--   - un instantané est borné (trois mégaoctets), et l'ensemble des versions
--     d'un compte aussi (soixante mégaoctets) ;
--   - la lecture d'une version autorise avant de charger, et ne rend de la
--     version précédente que des empreintes, suffisantes pour dire ce qui a
--     changé ;
--   - l'adresse de l'encadreur n'est rendue au propriétaire que s'il est encore
--     membre du projet ;
--   - versions et décisions sont gardées par un déclencheur : rien ne les
--     modifie, hormis l'effacement voulu ci-dessous et le retrait de
--     l'identifiant d'un compte supprimé ;
--   - le propriétaire peut effacer le contenu d'une version soumise par erreur
--     (droit à l'effacement) : la trace de la soumission et les décisions
--     restent, le document part ;
--   - la copie des données personnelles reçoit les versions soumises (sans leur
--     document, lisible dans l'application) et les décisions rendues.
--
-- Réversibilité : rétablir les fonctions de la migration 005000, supprimer les
-- déclencheurs, les fonctions ajoutées et les trois colonnes.
-- =============================================================================

alter table public.thesis_versions
  add column section_count integer not null default 0,
  add column size_bytes integer not null default 0,
  add column erased_at timestamptz;

update public.thesis_versions v
set section_count = jsonb_array_length(v.snapshot -> 'sections'),
    size_bytes = octet_length(v.snapshot::text);

alter table public.thesis_versions
  add constraint thesis_versions_size_check check (size_bytes between 0 and 3145728);

-- L'heure d'une décision est celle de son écriture, pas celle du début de la
-- transaction : deux décisions gardent toujours leur ordre.
alter table public.version_decisions alter column decided_at set default clock_timestamp();

-- -----------------------------------------------------------------------------
-- Garde : rien ne modifie une version ni une décision
-- -----------------------------------------------------------------------------
create function private.guard_version_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'version_decisions' then
    -- Seul le retrait de l'identifiant d'un compte supprimé est admis.
    if new.decided_by is null
       and (to_jsonb(new) - 'decided_by') = (to_jsonb(old) - 'decided_by') then
      return new;
    end if;
  elsif coalesce(current_setting('eduscholar.version_erase', true), '') = 'on'
        and new.id = old.id and new.project_id = old.project_id and new.number = old.number
        and new.created_at = old.created_at and new.created_by is not distinct from old.created_by then
    -- Effacement du contenu par son propriétaire : la trace reste.
    return new;
  end if;
  raise exception 'Les versions soumises et leurs décisions ne se modifient pas.' using errcode = '42501';
end
$$;

create trigger thesis_versions_guard
  before update on public.thesis_versions
  for each row execute function private.guard_version_history();
create trigger version_decisions_guard
  before update on public.version_decisions
  for each row execute function private.guard_version_history();

revoke all on function private.guard_version_history() from public, anon, authenticated, service_role;
-- Le service d'authentification supprime les comptes : c'est sous son rôle que
-- l'identifiant d'une décision est mis à vide.
grant execute on function private.guard_version_history() to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Soumettre
-- -----------------------------------------------------------------------------
create or replace function private.submit_thesis_version(p_project_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_label text;
  v_note text;
  v_snapshot jsonb;
  v_words integer;
  v_size integer;
  v_number integer;
  v_id uuid;
begin
  perform private.require_own_project(p_project_id);
  v_uid := (select auth.uid());
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_label := private.clean_line(p ->> 'label');
  v_note := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'note', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  if not private.is_clean_long_text(v_label, 120) or not private.is_clean_long_text(v_note, 1000) then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Cinq soumissions par jour et par compte ; trente versions par projet.
  perform private.consume_user_quota('version-submit', 5, 86400);
  -- Les soumissions d'un compte passent une par une : le plafond de taille se compte sous ce verrou.
  perform pg_advisory_xact_lock(hashtextextended('version_quota:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('thesis_versions:' || p_project_id::text, 0));
  if (select count(*) from public.thesis_versions v where v.project_id = p_project_id) >= 30 then
    perform private.fail('limit_reached');
  end if;

  select jsonb_build_object(
      'title', r.title,
      'supervisor_name', r.supervisor_name,
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'level', s.level, 'title', s.title, 'body', s.body
        ) order by s.position)
        from public.thesis_sections s where s.project_id = r.id
      ), '[]'::jsonb),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'resource_id', s.resource_id, 'source_type', s.source_type, 'title', s.title,
          'authors', s.authors, 'publication_year', s.publication_year,
          'container_title', s.container_title, 'publisher', s.publisher, 'volume', s.volume,
          'issue', s.issue, 'pages', s.pages, 'doi', s.doi, 'url', s.url, 'accessed_on', s.accessed_on
        ) order by s.title, s.id)
        from public.project_sources s where s.project_id = r.id
      ), '[]'::jsonb),
      'citations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'section_id', c.section_id, 'source_id', c.source_id, 'pages', c.pages
        ) order by c.created_at, c.source_id)
        from public.section_citations c
        join public.thesis_sections s on s.id = c.section_id
        where s.project_id = r.id
      ), '[]'::jsonb)
    ),
    coalesce((
      select sum(coalesce(array_length(regexp_split_to_array(btrim(s.body), '\s+'), 1), 0))
      from public.thesis_sections s
      where s.project_id = r.id and s.body is not null and btrim(s.body) <> ''
    ), 0)::integer
  into v_snapshot, v_words
  from public.research_projects r
  where r.id = p_project_id;

  -- Une version sans aucune section n'a rien à soumettre.
  if jsonb_array_length(v_snapshot -> 'sections') = 0 then
    perform private.fail('nothing_to_submit', '22023');
  end if;

  -- Trois mégaoctets par version ; soixante pour l'ensemble des versions du
  -- compte, projets supprimés compris.
  v_size := octet_length(v_snapshot::text);
  if v_size > 3145728
     or v_size + coalesce((
       select sum(v.size_bytes)
       from public.thesis_versions v
       join public.research_projects r on r.id = v.project_id
       where r.owner_id = v_uid
     ), 0) > 62914560 then
    perform private.fail('limit_reached');
  end if;

  select coalesce(max(v.number), 0) + 1 into v_number
  from public.thesis_versions v where v.project_id = p_project_id;
  insert into public.thesis_versions
    (project_id, number, label, note, snapshot, word_count, section_count, size_bytes, created_by)
  values
    (p_project_id, v_number, v_label, v_note, v_snapshot, v_words,
     jsonb_array_length(v_snapshot -> 'sections'), v_size, v_uid)
  returning id into v_id;
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Effacer le contenu d'une version (droit à l'effacement)
-- -----------------------------------------------------------------------------
create function private.erase_thesis_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  select v.project_id into v_project
  from public.thesis_versions v where v.id = p_version_id and v.erased_at is null;
  if v_project is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  -- Le propriétaire seul : c'est son texte.
  perform private.require_own_project(v_project);

  perform set_config('eduscholar.version_erase', 'on', true);
  update public.thesis_versions v
  set snapshot = jsonb_build_object('title', '', 'sections', '[]'::jsonb, 'sources', '[]'::jsonb, 'citations', '[]'::jsonb),
      label = null, note = null, word_count = 0, section_count = 0, size_bytes = 0, erased_at = now()
  where v.id = p_version_id;
  perform set_config('eduscholar.version_erase', 'off', true);

  perform private.write_audit(
    'security', 'project.version_erased', (select auth.uid()), (select auth.uid()), null,
    'research_projects', v_project::text, '{}'::jsonb
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Lire
-- -----------------------------------------------------------------------------
create or replace function private.project_versions(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.project_role(p_project_id);
begin
  -- Cent vingt lectures de liste par quart d'heure et par compte.
  perform private.consume_user_quota('version-list', 120, 900);
  return jsonb_build_object(
    'role', v_role,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'number', v.number, 'label', v.label, 'note', v.note,
        'word_count', v.word_count, 'created_at', v.created_at,
        'section_count', v.section_count,
        'erased', v.erased_at is not null,
        'decisions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'decision', d.decision, 'comment', d.comment, 'decided_at', d.decided_at,
            'mine', d.decided_by is not distinct from (select auth.uid()),
            -- L'adresse de l'encadreur n'est rendue qu'au propriétaire, et tant
            -- que cet encadreur est membre du projet.
            'decided_by_email', case when v_role = 'owner' and m.user_id is not null then u.email end
          ) order by d.decided_at, d.id)
          from public.version_decisions d
          left join public.research_project_members m
            on m.project_id = d.project_id and m.user_id = d.decided_by
          left join auth.users u on u.id = d.decided_by
          where d.version_id = v.id
        ), '[]'::jsonb)
      ) order by v.number desc)
      from public.thesis_versions v
      where v.project_id = p_project_id
    ), '[]'::jsonb)
  );
end
$$;

-- Empreintes des sections d'un instantané : de quoi dire ce qui a changé d'une
-- version à l'autre, sans en transporter le texte.
create function private.section_digests(p_sections jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s ->> 'id', 'level', (s ->> 'level')::integer, 'title', s ->> 'title',
    'digest', md5(coalesce(s ->> 'body', ''))
  ) order by ordinality), '[]'::jsonb)
  from jsonb_array_elements(p_sections) with ordinality as t(s, ordinality);
$$;

create or replace function private.project_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_number integer;
  v_role text;
begin
  -- Le projet seul d'abord : rien n'est chargé avant d'avoir autorisé.
  select v.project_id, v.number into v_project, v_number
  from public.thesis_versions v where v.id = p_version_id;
  if v_project is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_project);
  -- Lecture lourde : soixante par quart d'heure et par compte.
  perform private.consume_user_quota('version-read', 60, 900);

  return (
    select jsonb_build_object(
      'role', v_role,
      'project_id', v.project_id,
      'id', v.id,
      'number', v.number,
      'label', v.label,
      'note', v.note,
      'created_at', v.created_at,
      'erased', v.erased_at is not null,
      'snapshot', v.snapshot,
      'digests', private.section_digests(v.snapshot -> 'sections'),
      'previous_digests', (
        select private.section_digests(p.snapshot -> 'sections')
        from public.thesis_versions p
        where p.project_id = v_project and p.number < v_number and p.erased_at is null
        order by p.number desc
        limit 1
      )
    )
    from public.thesis_versions v
    where v.id = p_version_id
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Copie des données personnelles
-- -----------------------------------------------------------------------------
create function private.my_thesis_versions()
returns table (
  id uuid, project_id uuid, number integer, label text, note text,
  word_count integer, section_count integer, created_at timestamptz, erased_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.project_id, v.number, v.label, v.note, v.word_count, v.section_count, v.created_at, v.erased_at
  from public.thesis_versions v
  join public.research_projects r on r.id = v.project_id
  where private.is_account_active() and r.owner_id = (select auth.uid())
  order by v.created_at, v.id
  limit 2000;
$$;

create function private.my_version_decisions()
returns table (version_id uuid, project_id uuid, decision text, comment text, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.version_id, d.project_id, d.decision, d.comment, d.decided_at
  from public.version_decisions d
  where private.is_account_active() and d.decided_by = (select auth.uid())
  order by d.decided_at, d.id
  limit 5000;
$$;

create function public.erase_thesis_version(version_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.erase_thesis_version(version_id); $$;

create function public.my_thesis_versions()
returns table (
  id uuid, project_id uuid, number integer, label text, note text,
  word_count integer, section_count integer, created_at timestamptz, erased_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_thesis_versions(); $$;

create function public.my_version_decisions()
returns table (version_id uuid, project_id uuid, decision text, comment text, decided_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_version_decisions(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'erase_thesis_version(uuid)', 'my_thesis_versions()', 'my_version_decisions()'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

revoke all on function private.section_digests(jsonb) from public, anon, authenticated, service_role;

-- L'effacement d'une version figure parmi les événements rendus au titulaire.
create or replace function private.my_account_events()
returns table (occurred_at timestamptz, category text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.occurred_at, a.category, a.action
  from public.audit_logs a
  where private.is_account_active()
    and a.subject_user_id = (select auth.uid())
    and a.action in (
      'account.data_exported',
      'account.deletion_requested',
      'account_status.insert',
      'account_status.update',
      'account_status.delete',
      'platform_roles.insert',
      'platform_roles.delete',
      'second_factor.recovery_code_used',
      'second_factor.recovery_codes_generated',
      'second_factor.recovery_codes_discarded',
      'project.shared',
      'project.unshared',
      'project.version_erased'
    )
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;
