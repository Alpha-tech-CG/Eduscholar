-- =============================================================================
-- E-02 : corrections de la revue de sécurité des commentaires
-- =============================================================================
--   - un membre ne peut plus saturer le projet : cent cinquante commentaires
--     par membre, trois cents pour l'ensemble des membres, trois cents pour le
--     propriétaire, qui garde donc toujours la parole sur son propre projet ;
--   - un membre redevenu simple lecteur ne modifie ni ne supprime plus ses
--     anciens commentaires ;
--   - un fil clos ne reçoit plus de réponse, même par appel direct ;
--   - l'adresse des auteurs n'est rendue qu'au propriétaire du projet ; les
--     autres membres voient leur place dans le projet ;
--   - à la suppression d'un compte, ses commentaires sur les projets d'autrui
--     restent — ils font partie du suivi de l'étudiant — mais ne portent plus
--     son identifiant.
--
-- Réversibilité : rétablir les fonctions de la migration 004700 et supprimer
-- le déclencheur.
-- =============================================================================

create or replace function private.add_project_comment(p_section_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_owner uuid;
  v_role text;
  v_parent uuid;
  v_body text;
  v_quote text;
  v_id uuid;
begin
  -- La section, puis la place de l'appelant dans son projet : une section
  -- inconnue et une section d'un projet fermé à l'appelant répondent pareil.
  select s.project_id into v_project from public.thesis_sections s where s.id = p_section_id;
  if v_project is null then
    if v_uid is null or not private.is_account_active() then
      perform private.fail('forbidden', '42501');
    end if;
    perform private.fail('not_found');
  end if;
  v_role := private.project_role(v_project);
  if v_role not in ('owner', 'supervisor') or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;

  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_body := nullif(btrim(
    replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'), '');
  -- Le passage cité tient sur une ligne.
  v_quote := private.clean_line(regexp_replace(coalesce(p ->> 'quote', ''), '[\r\n]+', ' ', 'g'));
  if v_body is null or not private.is_clean_long_text(v_body, 2000)
     or not private.is_clean_long_text(v_quote, 400) then
    perform private.fail('invalid_payload', '22023');
  end if;

  if p ->> 'parent_id' is not null then
    if (p ->> 'parent_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    -- Une réponse suit un commentaire de premier niveau de la même section,
    -- dans un fil encore ouvert.
    select c.id into v_parent
    from public.project_comments c
    where c.id = (p ->> 'parent_id')::uuid and c.section_id = p_section_id and c.parent_id is null
      and c.resolved_at is null;
    if v_parent is null then
      perform private.fail('not_found');
    end if;
    v_quote := null;
  end if;

  -- Deux cents commentaires par jour et par compte.
  perform private.consume_user_quota('project-comment', 200, 86400);
  perform pg_advisory_xact_lock(hashtextextended('project_comments:' || v_project::text, 0));
  select r.owner_id into v_owner from public.research_projects r where r.id = v_project;
  -- Par projet : trois cents pour le propriétaire ; cent cinquante par membre
  -- et trois cents pour l'ensemble des membres, anciens compris. Personne ne
  -- prive le propriétaire de la parole sur son propre projet.
  if v_uid = v_owner then
    if (select count(*) from public.project_comments c
        where c.project_id = v_project and c.author_id = v_owner) >= 300 then
      perform private.fail('limit_reached');
    end if;
  elsif (select count(*) from public.project_comments c
         where c.project_id = v_project and c.author_id = v_uid) >= 150
     or (select count(*) from public.project_comments c
         where c.project_id = v_project and c.author_id is distinct from v_owner) >= 300 then
    perform private.fail('limit_reached');
  end if;

  insert into public.project_comments (project_id, section_id, parent_id, author_id, body, quote)
  values (v_project, p_section_id, v_parent, v_uid, v_body, v_quote)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function private.require_own_comment(p_comment_id uuid)
returns public.project_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.project_comments;
begin
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  select c.* into v_comment
  from public.project_comments c
  where c.id = p_comment_id and c.author_id = (select auth.uid()) and c.deleted_at is null
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  -- Retiré du projet, ou redevenu simple lecteur, on ne touche plus à ses
  -- anciens commentaires.
  if private.project_role(v_comment.project_id) not in ('owner', 'supervisor') then
    perform private.fail('forbidden', '42501');
  end if;
  return v_comment;
end
$$;

create or replace function private.project_comments(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.project_role(p_project_id);
begin
  return jsonb_build_object(
    'role', v_role,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'section_id', c.section_id,
        'parent_id', c.parent_id,
        'mine', c.author_id is not distinct from v_uid,
        'author_role', case
          when c.author_id is null then null
          when c.author_id = r.owner_id then 'owner'
          else m.role
        end,
        -- L'adresse d'un membre n'est rendue qu'au propriétaire, qui l'a invité ;
        -- celle du propriétaire, à ses membres, qui la connaissent déjà.
        'author_email', case
          when c.author_id = r.owner_id then u.email
          when m.user_id is not null and v_role = 'owner' then u.email
        end,
        'body', c.body,
        'quote', c.quote,
        'created_at', c.created_at,
        'edited', c.edited_at is not null,
        'deleted', c.deleted_at is not null,
        'resolved_at', c.resolved_at
      ) order by c.created_at, c.id)
      from public.project_comments c
      join public.research_projects r on r.id = c.project_id
      left join public.research_project_members m on m.project_id = c.project_id and m.user_id = c.author_id
      left join auth.users u on u.id = c.author_id
      where c.project_id = p_project_id
    ), '[]'::jsonb)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Suppression d'un compte : ce qu'il laisse dans les projets d'autrui
-- -----------------------------------------------------------------------------
-- Ses commentaires restent dans le projet de l'étudiant, sans son identifiant.
-- Seules les lignes des projets dont il n'est pas propriétaire sont touchées :
-- celles de ses propres projets partent avec eux, et y toucher ici ferait
-- échouer la suppression (voir la migration 004800).
create function private.anonymize_departed_member()
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

revoke all on function private.anonymize_departed_member() from public, anon, authenticated, service_role;
-- Le service d'authentification supprime les comptes sous son propre rôle.
grant execute on function private.anonymize_departed_member() to supabase_auth_admin;

create trigger users_anonymize_departed_member
  before delete on auth.users
  for each row execute function private.anonymize_departed_member();

comment on column public.project_comments.author_id is
  'Auteur. Sans clé étrangère (voir 004800) ; mis à vide à la suppression du compte, sauf dans ses propres projets, qui partent avec lui. Décide de qui modifie ou supprime le commentaire.';
