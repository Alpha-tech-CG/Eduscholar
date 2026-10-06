-- =============================================================================
-- B-15 : corrections de la revue de sécurité de l'import par connecteur
-- =============================================================================
-- 1. Séparation des tâches : qui a importé une fiche ne la vérifie ni ne la publie.
-- 2. Import : rôle « moderator » seulement ; limite journalière sérialisée par
--    acteur ; une fiche refusée ou retirée n'empêche pas un nouvel import ; un
--    DOI porté par une fiche non publique n'est pas révélé.
--
-- Réversibilité : rétablir les définitions des migrations 001400 et 001500 et
-- l'index d'origine.
-- =============================================================================

-- Une même entrée d'une même source n'existe qu'une fois parmi les fiches
-- vivantes : une fiche refusée ou retirée ne bloque pas un nouvel import.
drop index public.resources_source_unique_idx;
create unique index resources_source_unique_idx
  on public.resources (source_name, source_identifier)
  where source_identifier is not null and editorial_status not in ('rejected', 'removed');

create or replace function private.moderate_resource(p_resource_id uuid, p_action text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.resources;
  v_to text;
  v_allowed text[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;

  select * into v_row from public.resources r
  where r.id = p_resource_id and r.visibility = 'public'
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_row.submitted_by is not distinct from v_uid then
    perform private.fail('own_submission', '42501');
  end if;
  -- Une fiche importée est vérifiée et publiée par un autre modérateur que
  -- celui qui l'a importée : l'import ne dispense pas du second regard.
  if p_action in ('verify', 'publish') and exists (
    select 1 from public.resource_status_history h
    where h.resource_id = p_resource_id and h.action = 'imported' and h.actor_id = v_uid
  ) then
    perform private.fail('own_submission', '42501');
  end if;
  if v_reason is not null and char_length(v_reason) > 2000 then
    perform private.fail('reason_too_long', '22023');
  end if;

  case p_action
    when 'start_review' then v_to := 'under_review'; v_allowed := array['pending'];
    when 'request_changes' then v_to := 'changes_requested'; v_allowed := array['pending', 'under_review'];
    -- La vérification part du statut « en cours d'examen », que le contributeur
    -- ne peut plus modifier : le contenu vérifié est celui que le modérateur a lu.
    when 'verify' then v_to := 'verified'; v_allowed := array['under_review'];
    when 'publish' then v_to := 'published'; v_allowed := array['verified'];
    when 'reject' then v_to := 'rejected'; v_allowed := array['pending', 'under_review', 'changes_requested', 'verified'];
    when 'suspend' then v_to := 'suspended'; v_allowed := array['published'];
    when 'restore' then v_to := 'published'; v_allowed := array['suspended'];
    when 'remove' then v_to := 'removed'; v_allowed := array['verified', 'published', 'suspended'];
    else perform private.fail('invalid_action', '22023');
  end case;

  if not (v_row.editorial_status = any (v_allowed)) then
    perform private.fail('invalid_transition');
  end if;
  if p_action in ('request_changes', 'reject', 'suspend', 'remove') and v_reason is null then
    perform private.fail('reason_required', '22023');
  end if;

  if p_action = 'verify' then
    if v_row.official_url is null
       or (cardinality(v_row.authors) = 0 and v_row.institution_name is null) then
      perform private.fail('not_publishable', '23514');
    end if;
    -- Le statut d'accès doit être connu (politique de contenu §5).
    if v_row.access_status = 'unknown' then
      perform private.fail('access_status_required', '23514');
    end if;
    -- Une autorisation d'ayant droit se prouve (politique de contenu §4).
    if v_row.license_code = 'author-permission'
       and not exists (
         select 1 from public.resource_internal i
         where i.resource_id = p_resource_id
           and char_length(btrim(coalesce(i.permission_proof, ''))) > 0
       ) then
      perform private.fail('permission_proof_required', '23514');
    end if;
  end if;

  begin
    update public.resources set
      editorial_status = v_to,
      last_verified_at = case when p_action = 'verify' then now() else last_verified_at end,
      published_at = case when p_action = 'publish' then now() else published_at end,
      access_status = case when p_action = 'remove' then 'removed' else access_status end
    where id = p_resource_id;
  exception when unique_violation then
    -- Une autre fiche validée porte déjà ce DOI.
    perform private.fail('duplicate_doi', '23505');
  end;

  perform private.record_resource_transition(
    p_resource_id, v_row.editorial_status, v_to, p_action, v_reason, v_row.submitted_by
  );
  return v_to;
end
$$;

create or replace function private.import_connector_resource(p_actor uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := p ->> 'source_name';
  v_identifier text := nullif(btrim(p ->> 'source_identifier'), '');
  v_doi text := nullif(lower(btrim(p ->> 'doi')), '');
  v_id uuid;
begin
  if ((select auth.jwt()) ->> 'role') is distinct from 'service_role' then
    perform private.fail('forbidden', '42501');
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- L'acteur : un compte non suspendu, au rôle de modération effectif.
  if p_actor is null
     or exists (
       select 1 from private.account_status s
       where s.user_id = p_actor and s.status = 'suspended'
     )
     or not exists (
       select 1
       from public.platform_roles r
       where r.user_id = p_actor
         and r.role = 'moderator'
         and exists (
           select 1 from auth.mfa_factors f
           where f.user_id = r.user_id
             and f.status = 'verified'
             and f.created_at <= r.granted_at
         )
     ) then
    perform private.fail('forbidden', '42501');
  end if;

  -- Liste fermée des sources : celles de la liste A dotées d'un connecteur.
  if v_source is null or v_source not in ('crossref') then
    perform private.fail('source_not_allowed', '22023');
  end if;
  if v_identifier is null then
    perform private.fail('invalid_payload', '22023');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('import_resource:' || v_source || ':' || v_identifier, 0));

  -- Import rejouable : la même entrée de la même source n'est créée qu'une fois.
  select r.id into v_id
  from public.resources r
  where r.source_name = v_source and r.source_identifier = v_identifier
    and r.editorial_status not in ('rejected', 'removed');
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  -- Un DOI déjà porté par une fiche validée n'est pas réimporté.
  if v_doi is not null then
    select r.id into v_id
    from public.resources r
    where lower(r.doi) = v_doi
      and r.editorial_status in ('verified', 'published', 'suspended')
      and r.visibility = 'public'
    limit 1;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'created', false);
    end if;
  end if;

  -- Deux cents imports par jour et par modérateur : borne les erreurs de
  -- manipulation. Les imports simultanés d'un même modérateur passent un par
  -- un, pour que la limite ne se contourne pas en les lançant ensemble. (La
  -- charge envoyée à la source est bornée par l'application, avant l'appel.)
  perform pg_advisory_xact_lock(hashtextextended('import_actor:' || p_actor::text, 0));
  if (
    select count(*) from public.resource_status_history h
    where h.actor_id = p_actor and h.action = 'imported'
      and h.occurred_at > now() - interval '1 day'
  ) >= 200 then
    perform private.fail('rate_limited');
  end if;

  insert into public.resources (
    type_code, title, authors, publication_year,
    language_code, program_code,
    doi, official_url, access_status, license_code,
    source_kind, source_name, source_identifier, retrieved_at,
    editorial_status, visibility
  )
  values (
    p ->> 'type_code',
    btrim(p ->> 'title'),
    private.text_array(p -> 'authors'),
    nullif(p ->> 'publication_year', '')::smallint,
    p ->> 'language_code',
    p ->> 'program_code',
    v_doi,
    nullif(btrim(p ->> 'official_url'), ''),
    -- La source ne dit pas si le document est en accès ouvert : rien n'est déduit.
    'unknown',
    coalesce(nullif(p ->> 'license_code', ''), 'unknown'),
    'connector', v_source, v_identifier, now(),
    'pending', 'public'
  )
  returning id into v_id;

  insert into public.resource_internal (resource_id) values (v_id);

  insert into public.resource_status_history (resource_id, from_status, to_status, action, reason, actor_id)
  values (v_id, null, 'pending', 'imported', null, p_actor);

  perform private.write_audit(
    'moderation', 'resource.imported', p_actor, null, null,
    'resources', v_id::text,
    jsonb_build_object('source', v_source, 'source_identifier', v_identifier)
  );

  return jsonb_build_object('id', v_id, 'created', true);
end
$$;
