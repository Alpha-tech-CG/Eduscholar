-- =============================================================================
-- E-01 : corrections de la revue de sécurité du partage d'un projet
-- =============================================================================
--   - retirer un membre annule aussi les invitations encore en attente à son
--     adresse : sans cela, un second lien le faisait revenir aussitôt ;
--   - une même adresse ne reçoit pas plus de trois invitations par jour, tous
--     expéditeurs confondus : le courriel d'invitation ne sert pas à harceler ;
--   - la lecture du document par un membre est limitée en débit, en base ;
--   - le journal dit si un partage a pris fin par retrait ou par départ ;
--   - les invitations closes depuis trente jours sont effacées : elles portent
--     l'adresse de tiers.
--
-- Réversibilité : rétablir les fonctions de la migration 004500 et retirer la
-- tâche planifiée.
-- =============================================================================

create or replace function private.invite_project_member(p_project_id uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
  v_token text;
  v_hits integer;
begin
  perform private.require_own_project(p_project_id);
  v_uid := (select auth.uid());
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_email := lower(btrim(coalesce(p ->> 'email', '')));
  v_role := coalesce(p ->> 'role', '');
  if char_length(v_email) not between 6 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or v_role not in ('supervisor', 'viewer') then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- On ne s'invite pas soi-même.
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    perform private.fail('own_account', '42501');
  end if;

  -- Vingt invitations par jour et par compte ; dix en attente et dix membres par projet.
  perform private.consume_user_quota('project-invite', 20, 86400);

  -- Trois invitations par jour vers une même adresse, tous expéditeurs
  -- confondus. La clé est une empreinte : la table ne retient pas l'adresse.
  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (
    'project-invite:to:' || left(encode(sha256(convert_to('project-invite:' || v_email, 'UTF8')), 'hex'), 40),
    date_trunc('day', now(), 'UTC'), 1
  )
  on conflict (bucket_key, window_start) do update set hits = b.hits + 1
  returning b.hits into v_hits;
  if v_hits > 3 then
    perform private.fail('rate_limited');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || p_project_id::text, 0));

  -- Une nouvelle invitation à la même adresse remplace la précédente.
  update public.project_invitations i set status = 'revoked'
  where i.project_id = p_project_id and i.email = v_email and i.status = 'pending';

  if (select count(*) from public.project_invitations i
      where i.project_id = p_project_id and i.status = 'pending' and i.expires_at > now()) >= 10
     or (select count(*) from public.research_project_members m where m.project_id = p_project_id) >= 10 then
    perform private.fail('limit_reached');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.project_invitations (project_id, email, role, token_hash, expires_at, created_by)
  values (p_project_id, v_email, v_role, private.invitation_token_hash(v_token), now() + interval '7 days', v_uid);

  -- La réponse est la même que l'adresse ait un compte ou non, qu'elle soit
  -- déjà membre ou non : rien n'est révélé sur elle.
  return v_token;
end
$$;

create or replace function private.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_project(p_project_id);
  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || p_project_id::text, 0));

  delete from public.research_project_members m
  where m.project_id = p_project_id and m.user_id = p_user_id;
  if not found then
    perform private.fail('not_found');
  end if;
  -- Une invitation encore en attente à son adresse le ferait revenir : elle est annulée.
  update public.project_invitations i set status = 'revoked'
  where i.project_id = p_project_id and i.status = 'pending'
    and i.email = (select lower(u.email) from auth.users u where u.id = p_user_id);

  perform private.write_audit(
    'security', 'project.unshared', (select auth.uid()), (select auth.uid()), null,
    'research_projects', p_project_id::text,
    jsonb_build_object('reason', 'removed', 'member_id', p_user_id)
  );
end
$$;

create or replace function private.leave_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform private.require_project_membership(p_project_id);
  delete from public.research_project_members m
  where m.project_id = p_project_id and m.user_id = (select auth.uid());
  select r.owner_id into v_owner from public.research_projects r where r.id = p_project_id;
  perform private.write_audit(
    'security', 'project.unshared', (select auth.uid()), v_owner, null,
    'research_projects', p_project_id::text,
    jsonb_build_object('reason', 'left', 'member_id', (select auth.uid()))
  );
end
$$;

create or replace function private.shared_project_document(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.research_project_members := private.require_project_membership(p_project_id);
begin
  if not v_member.full_access then
    perform private.fail('not_found');
  end if;
  -- Lecture lourde : cent vingt par quart d'heure et par compte.
  perform private.consume_user_quota('shared-document', 120, 900);

  return (
    select jsonb_build_object(
      'role', v_member.role,
      'project', jsonb_build_object(
        'id', r.id, 'title', r.title, 'status', r.status, 'due_date', r.due_date,
        'supervisor_name', r.supervisor_name, 'problem_statement', r.problem_statement,
        'main_question', r.main_question, 'general_objective', r.general_objective,
        'methodology', r.methodology, 'updated_at', r.updated_at
      ),
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
    )
    from public.research_projects r
    where r.id = p_project_id and r.deleted_at is null
  );
end
$$;

-- Invitations closes (acceptées, annulées) ou expirées depuis plus de trente
-- jours : effacées chaque nuit, par le propriétaire de la base seulement.
create function private.purge_stale_invitations()
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
  delete from public.project_invitations i
  where greatest(i.created_at, least(i.expires_at, now())) < now() - interval '30 days'
    and (i.status <> 'pending' or i.expires_at < now() - interval '30 days');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function private.purge_stale_invitations() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-invitations-purge';
select cron.schedule('eduscholar-invitations-purge', '27 3 * * *', 'select private.purge_stale_invitations()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-invitations-purge' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-invitations-purge doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
