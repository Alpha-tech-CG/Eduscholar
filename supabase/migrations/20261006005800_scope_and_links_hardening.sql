-- =============================================================================
-- E-06 : corrections de la revue de sécurité de la portée et des liens
-- =============================================================================
--   - un membre pouvait élargir sa propre portée — ou son rôle — en acceptant
--     une invitation plus ancienne restée en attente. Toute création ou
--     modification d'une appartenance annule désormais les invitations en
--     attente vers l'adresse du membre : seule vaut la dernière décision du
--     propriétaire ;
--   - la fiche rendue à un membre limité s'en tient à ce que prévoit le modèle
--     d'autorisation : titre, statut, échéance. Problématique, question,
--     objectif et méthodologie restent réservés à l'accès complet ;
--   - une demande refusée ne se répète pas pendant trente jours ; désactiver
--     le lien refuse les demandes qui en étaient parties ;
--   - la copie des données ne rend plus le passage cité d'un commentaire quand
--     sa section n'est plus ouverte à son auteur.
--
-- Limite connue et acceptée : qui tient un lien peut savoir s'il vaut encore
-- (sa demande apparaît dans « demandes en attente »). Il n'en apprend rien du
-- projet.
--
-- Réversibilité : supprimer le déclencheur, rétablir les fonctions des
-- migrations 004700, 005600 et 005700.
-- =============================================================================

-- Seule vaut la dernière décision du propriétaire sur un membre.
create function private.revoke_invitations_of_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_invitations i
  set status = 'revoked'
  where i.project_id = new.project_id and i.status = 'pending'
    and i.email = (select lower(u.email) from auth.users u where u.id = new.user_id);
  return new;
end
$$;

revoke all on function private.revoke_invitations_of_member() from public, anon, authenticated, service_role;

create trigger research_project_members_revoke_invitations
  after insert or update of role, full_access on public.research_project_members
  for each row execute function private.revoke_invitations_of_member();

create or replace function private.shared_project_document(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_full boolean;
begin
  select a.o_role, a.o_full into v_role, v_full from private.project_access(p_project_id) a;
  -- Cette lecture est celle d'un membre : le propriétaire a ses propres pages.
  if v_role = 'owner' then
    perform private.fail('not_found');
  end if;
  -- Lecture lourde : cent vingt par quart d'heure et par compte.
  perform private.consume_user_quota('shared-document', 120, 900);

  return (
    select jsonb_build_object(
      'role', v_role,
      'full_access', v_full,
      -- Accès limité : la fiche s'en tient au titre, au statut et à l'échéance.
      'project', jsonb_build_object(
        'id', r.id, 'title', r.title, 'status', r.status, 'due_date', r.due_date,
        'supervisor_name', case when v_full then r.supervisor_name end,
        'problem_statement', case when v_full then r.problem_statement end,
        'main_question', case when v_full then r.main_question end,
        'general_objective', case when v_full then r.general_objective end,
        'methodology', case when v_full then r.methodology end,
        'updated_at', r.updated_at
      ),
      -- Accès limité : les seules sections ouvertes ; ni sources ni citations.
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'level', s.level, 'title', s.title, 'body', s.body
        ) order by s.position)
        from public.thesis_sections s
        where s.project_id = r.id
          and (v_full or exists (
            select 1 from public.research_project_member_sections x
            where x.project_id = r.id and x.user_id = v_uid and x.section_id = s.id
          ))
      ), '[]'::jsonb),
      'sources', case when v_full then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'resource_id', s.resource_id, 'source_type', s.source_type, 'title', s.title,
          'authors', s.authors, 'publication_year', s.publication_year,
          'container_title', s.container_title, 'publisher', s.publisher, 'volume', s.volume,
          'issue', s.issue, 'pages', s.pages, 'doi', s.doi, 'url', s.url, 'accessed_on', s.accessed_on
        ) order by s.title, s.id)
        from public.project_sources s where s.project_id = r.id
      ), '[]'::jsonb) else '[]'::jsonb end,
      'citations', case when v_full then coalesce((
        select jsonb_agg(jsonb_build_object(
          'section_id', c.section_id, 'source_id', c.source_id, 'pages', c.pages
        ) order by c.created_at, c.source_id)
        from public.section_citations c
        join public.thesis_sections s on s.id = c.section_id
        where s.project_id = r.id
      ), '[]'::jsonb) else '[]'::jsonb end
    )
    from public.research_projects r
    where r.id = p_project_id and r.deleted_at is null
  );
end
$$;

create or replace function private.request_project_access(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.project_share_links;
  v_owner uuid;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  -- Dix demandes par jour et par compte ; une demande sans suite est comptée aussi.
  perform private.consume_user_quota('project-access-request', 10, 86400);
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select l.* into v_link
  from public.project_share_links l
  join public.research_projects r on r.id = l.project_id
  where l.token_hash = private.invitation_token_hash(p_token)
    and l.revoked_at is null and l.expires_at > now() and r.deleted_at is null;
  if v_link.id is null then
    return;
  end if;
  select r.owner_id into v_owner from public.research_projects r where r.id = v_link.project_id;
  if v_owner = v_uid
     or exists (select 1 from public.research_project_members m
                where m.project_id = v_link.project_id and m.user_id = v_uid)
     -- Refusé il y a moins de trente jours : la demande ne se répète pas.
     or exists (select 1 from public.project_access_requests q
                where q.project_id = v_link.project_id and q.user_id = v_uid
                  and q.status = 'refused' and q.decided_at > now() - interval '30 days') then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || v_link.project_id::text, 0));
  if (select count(*) from public.project_access_requests q
      where q.project_id = v_link.project_id and q.status = 'pending') >= 20 then
    return;
  end if;
  insert into public.project_access_requests (project_id, user_id, role)
  values (v_link.project_id, v_uid, v_link.role)
  on conflict (project_id, user_id) where status = 'pending' do nothing;
  if found then
    perform private.notify(v_owner, v_uid, 'access_requested', v_link.project_id);
  end if;
end
$$;

-- Désactiver le lien refuse aussi les demandes qui en étaient parties : le
-- propriétaire n'a pas à les refuser une à une.
create or replace function private.revoke_project_link(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_own_project(p_project_id);
  perform pg_advisory_xact_lock(hashtextextended('project_sharing:' || p_project_id::text, 0));
  update public.project_share_links l set revoked_at = now()
  where l.project_id = p_project_id and l.revoked_at is null;
  update public.project_access_requests q
  set status = 'refused', decided_at = now()
  where q.project_id = p_project_id and q.status = 'pending';
end
$$;

-- Copie des données : ses commentaires ; le passage cité — du texte du
-- propriétaire — seulement si la section lui est encore ouverte.
create or replace function private.my_project_comments()
returns table (id uuid, project_id uuid, section_id uuid, body text, quote text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.project_id, c.section_id, c.body,
         case when private.can_see_notification(c.project_id, c.section_id) then c.quote end,
         c.created_at
  from public.project_comments c
  where private.is_account_active()
    and c.author_id = (select auth.uid())
    and c.deleted_at is null
  order by c.created_at, c.id
  limit 5000;
$$;
