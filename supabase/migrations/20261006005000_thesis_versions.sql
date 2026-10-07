-- =============================================================================
-- E-03 : versions soumises et décisions de l'encadreur (cahier §6.11)
-- =============================================================================
-- L'étudiant soumet une version : un instantané du document entier, figé au
-- moment de la soumission. L'encadreur rend une décision — acceptée, refusée,
-- à corriger — avec son commentaire. Versions et décisions ne se modifient ni
-- ne se suppriment : une nouvelle décision s'ajoute à l'historique (matrice
-- §5.3, lignes 11 à 13).
--
-- Une version exige l'accès complet : c'est le document entier. Comme pour le
-- reste du partage, aucune lecture ni écriture directe.
--
-- Réversibilité : supprimer les fonctions, puis les deux tables.
-- =============================================================================

create table public.thesis_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  number integer not null
    constraint thesis_versions_number_check check (number between 1 and 1000),
  label text
    constraint thesis_versions_label_check check (private.is_clean_long_text(label, 120)),
  -- Mot de l'étudiant à son encadreur.
  note text
    constraint thesis_versions_note_check check (private.is_clean_long_text(note, 1000)),
  -- Le document tel qu'il était : titre, sections, sources, citations.
  snapshot jsonb not null
    constraint thesis_versions_snapshot_check check (jsonb_typeof(snapshot) = 'object'),
  word_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
comment on table public.thesis_versions is
  'Versions soumises d''un projet : instantanés immuables du document. Lues et créées par fonctions seulement.';

create table public.version_decisions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.thesis_versions (id) on delete cascade,
  project_id uuid not null references public.research_projects (id) on delete cascade,
  decision text not null
    constraint version_decisions_decision_check check (decision in ('accepted', 'rejected', 'changes_requested')),
  comment text
    constraint version_decisions_comment_check check (private.is_clean_long_text(comment, 2000)),
  -- Simple identifiant, sans clé étrangère (voir 004800) ; mis à vide à la suppression du compte.
  decided_by uuid,
  decided_at timestamptz not null default now(),
  -- Refuser ou demander une correction se motive.
  constraint version_decisions_reason_check check (decision = 'accepted' or comment is not null)
);
comment on table public.version_decisions is
  'Décisions rendues sur une version soumise. Historique en ajout seul.';
create index version_decisions_version_id_idx on public.version_decisions (version_id, decided_at);
create index version_decisions_project_id_idx on public.version_decisions (project_id);
create index thesis_versions_created_by_idx on public.thesis_versions (created_by);
create index version_decisions_decided_by_idx on public.version_decisions (decided_by);

alter table public.thesis_versions enable row level security;
alter table public.thesis_versions force row level security;
alter table public.version_decisions enable row level security;
alter table public.version_decisions force row level security;
revoke all on public.thesis_versions from public, anon, authenticated, service_role;
revoke all on public.version_decisions from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Soumettre
-- -----------------------------------------------------------------------------
create function private.submit_thesis_version(p_project_id uuid, p jsonb)
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

  select coalesce(max(v.number), 0) + 1 into v_number
  from public.thesis_versions v where v.project_id = p_project_id;
  insert into public.thesis_versions (project_id, number, label, note, snapshot, word_count, created_by)
  values (p_project_id, v_number, v_label, v_note, v_snapshot, v_words, v_uid)
  returning id into v_id;
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Décider
-- -----------------------------------------------------------------------------
create function private.decide_thesis_version(p_version_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_decision text;
  v_comment text;
begin
  select v.project_id into v_project from public.thesis_versions v where v.id = p_version_id;
  if v_project is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  -- L'encadreur seul décide : ni le propriétaire, ni un simple lecteur.
  if private.project_role(v_project) <> 'supervisor' or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;

  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_decision := coalesce(p ->> 'decision', '');
  v_comment := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'comment', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  if v_decision not in ('accepted', 'rejected', 'changes_requested')
     or not private.is_clean_long_text(v_comment, 2000) then
    perform private.fail('invalid_payload', '22023');
  end if;
  if v_decision <> 'accepted' and v_comment is null then
    perform private.fail('reason_required', '22023');
  end if;

  -- Cinquante décisions par jour et par compte ; vingt par version.
  perform private.consume_user_quota('version-decide', 50, 86400);
  perform pg_advisory_xact_lock(hashtextextended('thesis_versions:' || v_project::text, 0));
  if (select count(*) from public.version_decisions d where d.version_id = p_version_id) >= 20 then
    perform private.fail('limit_reached');
  end if;

  insert into public.version_decisions (version_id, project_id, decision, comment, decided_by)
  values (p_version_id, v_project, v_decision, v_comment, (select auth.uid()));
end
$$;

-- -----------------------------------------------------------------------------
-- Lire
-- -----------------------------------------------------------------------------
-- Les versions d'un projet et leurs décisions, sans le document lui-même.
create function private.project_versions(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.project_role(p_project_id);
begin
  return jsonb_build_object(
    'role', v_role,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'number', v.number, 'label', v.label, 'note', v.note,
        'word_count', v.word_count, 'created_at', v.created_at,
        'section_count', jsonb_array_length(v.snapshot -> 'sections'),
        'decisions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'decision', d.decision, 'comment', d.comment, 'decided_at', d.decided_at,
            'mine', d.decided_by is not distinct from (select auth.uid()),
            -- L'adresse de l'encadreur n'est rendue qu'au propriétaire, qui l'a invité.
            'decided_by_email', case when v_role = 'owner' then u.email end
          ) order by d.decided_at, d.id)
          from public.version_decisions d
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

-- Une version : son instantané, et celui de la version précédente pour dire
-- ce qui a changé.
create function private.project_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.thesis_versions;
  v_role text;
begin
  select v.* into v_version from public.thesis_versions v where v.id = p_version_id;
  if v_version.id is null then
    if (select auth.uid()) is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_version.project_id);
  -- Lecture lourde : soixante par quart d'heure et par compte.
  perform private.consume_user_quota('version-read', 60, 900);

  return jsonb_build_object(
    'role', v_role,
    'project_id', v_version.project_id,
    'id', v_version.id,
    'number', v_version.number,
    'label', v_version.label,
    'note', v_version.note,
    'created_at', v_version.created_at,
    'snapshot', v_version.snapshot,
    'previous_sections', (
      select p.snapshot -> 'sections'
      from public.thesis_versions p
      where p.project_id = v_version.project_id and p.number < v_version.number
      order by p.number desc
      limit 1
    )
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées et droits
-- -----------------------------------------------------------------------------
create function public.submit_thesis_version(project_id uuid, payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.submit_thesis_version(project_id, payload); $$;

create function public.decide_thesis_version(version_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.decide_thesis_version(version_id, payload); $$;

create function public.project_versions(project_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.project_versions(project_id); $$;

create function public.project_version(version_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.project_version(version_id); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'submit_thesis_version(uuid, jsonb)',
    'decide_thesis_version(uuid, jsonb)',
    'project_versions(uuid)',
    'project_version(uuid)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

-- À la suppression d'un compte, ses décisions restent dans l'historique du
-- projet de l'étudiant, sans son identifiant.
create or replace function private.anonymize_departed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_comments c
  set author_id = case when c.author_id = old.id then null else c.author_id end,
      resolved_by = case when c.resolved_by = old.id then null else c.resolved_by end
  where (c.author_id = old.id or c.resolved_by = old.id)
    and not exists (
      select 1 from public.research_projects r where r.id = c.project_id and r.owner_id = old.id
    );
  update public.version_decisions d
  set decided_by = null
  where d.decided_by = old.id
    and not exists (
      select 1 from public.research_projects r where r.id = d.project_id and r.owner_id = old.id
    );
  update public.research_project_members m
  set invited_by = null
  where m.invited_by = old.id
    and not exists (
      select 1 from public.research_projects r where r.id = m.project_id and r.owner_id = old.id
    );
  update public.project_invitations i
  set accepted_by = case when i.accepted_by = old.id then null else i.accepted_by end,
      created_by = case when i.created_by = old.id then null else i.created_by end
  where (i.accepted_by = old.id or i.created_by = old.id)
    and not exists (
      select 1 from public.research_projects r where r.id = i.project_id and r.owner_id = old.id
    );
  return old;
end
$$;
