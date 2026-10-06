-- =============================================================================
-- B-13 / B-14 — Fonctions du catalogue : soumission, modération, signalement
--
-- Références : authorization-model §5.1 et §7.5 ; ADR-0007 (écritures sensibles
-- par fonctions nommées) ; modèle de menaces M-25, M-27, M-47.
--
-- Chaque fonction s'exécute sous la session de l'utilisateur : auth.uid() est
-- l'acteur. Elle vérifie le droit, applique la règle, écrit l'historique et le
-- journal d'audit dans la même transaction. Les fonctions du schéma private
-- sont SECURITY DEFINER ; celles du schéma public ne sont que des enveloppes
-- SECURITY INVOKER, pour être appelables par l'API sans ajouter de droit.
--
-- Convention d'erreur : une exception dont le message est un code
-- (« forbidden », « not_found », « rate_limited », « invalid_transition »,
-- « own_submission », « reason_required »…), que l'application traduit.
--
-- Réversibilité : supprimer les fonctions public.* puis private.* créées ici.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Outils
-- -----------------------------------------------------------------------------
create function private.fail(p_code text, p_sqlstate text default 'P0001')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code using errcode = p_sqlstate;
end
$$;

create function private.text_array(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then '{}'::text[]
    when jsonb_typeof(p_value) <> 'array' then null
    else coalesce(
      (select array_agg(btrim(e.value #>> '{}') order by e.ordinality)
       from jsonb_array_elements(p_value) with ordinality as e
       where jsonb_typeof(e.value) = 'string'),
      '{}'::text[]
    )
  end;
$$;

create function private.record_resource_transition(
  p_resource_id uuid,
  p_from text,
  p_to text,
  p_action text,
  p_reason text,
  p_subject uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.resource_status_history (resource_id, from_status, to_status, action, reason, actor_id)
  values (p_resource_id, p_from, p_to, p_action, p_reason, (select auth.uid()));

  perform private.write_audit(
    'moderation', 'resource.' || p_action, null, p_subject, null,
    'resources', p_resource_id::text,
    jsonb_build_object('from', p_from, 'to', p_to)
  );
end
$$;

revoke all on function private.fail(text, text) from public, anon, authenticated;
revoke all on function private.text_array(jsonb) from public, anon, authenticated;
revoke all on function private.record_resource_transition(uuid, text, text, text, text, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Soumission d'une ressource par un contributeur (cahier §6.6)
-- -----------------------------------------------------------------------------
-- Champs acceptés : type_code, title, abstract, authors, institution_name,
-- publication_year, thesis_degree, language_code, country_code, program_code,
-- level_codes, subject_codes, tags, doi, official_url, access_status,
-- license_code, contributor_comment, permission_proof, rights_declared.
-- Tout autre champ est ignoré : statut, visibilité, provenance et identité du
-- contributeur sont fixés ici.
create function private.submit_resource(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  -- Le contributeur déclare détenir les droits (politique de contenu §6).
  if (p ->> 'rights_declared') is distinct from 'true' then
    perform private.fail('rights_declaration_required', '22023');
  end if;
  -- Limite de débit en base : dix soumissions par jour et par contributeur (M-27).
  if (
    select count(*) from public.resources r
    where r.submitted_by = v_uid and r.created_at > now() - interval '1 day'
  ) >= 10 then
    perform private.fail('rate_limited');
  end if;

  insert into public.resources (
    type_code, title, abstract, authors, institution_name, publication_year, thesis_degree,
    language_code, country_code, program_code, level_codes, subject_codes, tags,
    doi, official_url, access_status, license_code,
    source_kind, source_name, editorial_status, visibility, submitted_by
  )
  values (
    p ->> 'type_code',
    btrim(p ->> 'title'),
    nullif(btrim(p ->> 'abstract'), ''),
    private.text_array(p -> 'authors'),
    nullif(btrim(p ->> 'institution_name'), ''),
    nullif(p ->> 'publication_year', '')::smallint,
    nullif(p ->> 'thesis_degree', ''),
    p ->> 'language_code',
    nullif(p ->> 'country_code', ''),
    p ->> 'program_code',
    private.text_array(p -> 'level_codes'),
    private.text_array(p -> 'subject_codes'),
    private.text_array(p -> 'tags'),
    nullif(lower(btrim(p ->> 'doi')), ''),
    nullif(btrim(p ->> 'official_url'), ''),
    coalesce(nullif(p ->> 'access_status', ''), 'unknown'),
    coalesce(nullif(p ->> 'license_code', ''), 'unknown'),
    'contribution', 'contribution', 'pending', 'public', v_uid
  )
  returning id into v_id;

  insert into public.resource_internal (resource_id, contributor_comment, permission_proof, rights_declared_at)
  values (
    v_id,
    nullif(btrim(p ->> 'contributor_comment'), ''),
    nullif(btrim(p ->> 'permission_proof'), ''),
    now()
  );

  perform private.record_resource_transition(v_id, null, 'pending', 'submitted', null, v_uid);
  return v_id;
end
$$;

-- Modification de sa soumission, tant qu'elle attend ou qu'une correction est demandée.
create function private.update_submission(p_resource_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.resources;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;

  select * into v_row from public.resources r
  where r.id = p_resource_id and r.submitted_by = v_uid
  for update;
  -- Même réponse pour « inexistant » et « pas à moi ».
  if not found then
    perform private.fail('not_found');
  end if;
  if v_row.editorial_status not in ('pending', 'changes_requested') then
    perform private.fail('invalid_transition');
  end if;

  update public.resources set
    type_code = p ->> 'type_code',
    title = btrim(p ->> 'title'),
    abstract = nullif(btrim(p ->> 'abstract'), ''),
    authors = private.text_array(p -> 'authors'),
    institution_name = nullif(btrim(p ->> 'institution_name'), ''),
    publication_year = nullif(p ->> 'publication_year', '')::smallint,
    thesis_degree = nullif(p ->> 'thesis_degree', ''),
    language_code = p ->> 'language_code',
    country_code = nullif(p ->> 'country_code', ''),
    program_code = p ->> 'program_code',
    level_codes = private.text_array(p -> 'level_codes'),
    subject_codes = private.text_array(p -> 'subject_codes'),
    tags = private.text_array(p -> 'tags'),
    doi = nullif(lower(btrim(p ->> 'doi')), ''),
    official_url = nullif(btrim(p ->> 'official_url'), ''),
    access_status = coalesce(nullif(p ->> 'access_status', ''), 'unknown'),
    license_code = coalesce(nullif(p ->> 'license_code', ''), 'unknown'),
    editorial_status = 'pending'
  where id = p_resource_id;

  update public.resource_internal set
    contributor_comment = nullif(btrim(p ->> 'contributor_comment'), ''),
    permission_proof = nullif(btrim(p ->> 'permission_proof'), '')
  where resource_id = p_resource_id;

  if v_row.editorial_status <> 'pending' then
    perform private.record_resource_transition(
      p_resource_id, v_row.editorial_status, 'pending', 'resubmitted', null, v_uid
    );
  end if;
end
$$;

-- Retrait de sa soumission avant publication.
create function private.withdraw_submission(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;

  select r.editorial_status into v_status from public.resources r
  where r.id = p_resource_id and r.submitted_by = v_uid
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_status in ('published', 'suspended', 'removed') then
    perform private.fail('invalid_transition');
  end if;

  update public.resources set editorial_status = 'removed', access_status = 'removed'
  where id = p_resource_id;
  perform private.record_resource_transition(p_resource_id, v_status, 'removed', 'withdrawn', null, v_uid);
end
$$;

-- -----------------------------------------------------------------------------
-- Modération (authorization-model §5.1, lignes 13 à 15)
-- -----------------------------------------------------------------------------
-- Actions : start_review, request_changes, verify, publish, reject, suspend,
-- restore, remove. Séparation des tâches : un modérateur ne traite pas sa
-- propre soumission.
create function private.moderate_resource(p_resource_id uuid, p_action text, p_reason text default null)
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
  -- Rôle de modérateur, compte actif et second facteur vérifié.
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
  if v_reason is not null and char_length(v_reason) > 2000 then
    perform private.fail('reason_too_long', '22023');
  end if;

  case p_action
    when 'start_review' then v_to := 'under_review'; v_allowed := array['pending'];
    when 'request_changes' then v_to := 'changes_requested'; v_allowed := array['pending', 'under_review'];
    when 'verify' then v_to := 'verified'; v_allowed := array['pending', 'under_review'];
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
  -- Un refus, une demande de correction, une suspension ou un retrait se motivent.
  if p_action in ('request_changes', 'reject', 'suspend', 'remove') and v_reason is null then
    perform private.fail('reason_required', '22023');
  end if;
  -- Une fiche sans lien officiel, auteur ou institution ne se vérifie pas.
  if p_action = 'verify'
     and (v_row.official_url is null
          or (cardinality(v_row.authors) = 0 and v_row.institution_name is null)) then
    perform private.fail('not_publishable', '23514');
  end if;

  update public.resources set
    editorial_status = v_to,
    -- La vérification date le contrôle du lien et de la licence.
    last_verified_at = case when p_action = 'verify' then now() else last_verified_at end,
    published_at = case when p_action = 'publish' then now() else published_at end,
    access_status = case when p_action = 'remove' then 'removed' else access_status end
  where id = p_resource_id;

  perform private.record_resource_transition(
    p_resource_id, v_row.editorial_status, v_to, p_action, v_reason, v_row.submitted_by
  );
  return v_to;
end
$$;

-- Correction d'une fiche par la modération. Changer la provenance, la licence,
-- le lien ou le statut d'accès d'une fiche publiée la repasse en attente
-- (authorization-model §5.1, ligne 14).
create function private.moderator_update_resource(p_resource_id uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.resources;
  v_new_url text;
  v_new_license text;
  v_new_access text;
  v_sensitive boolean;
  v_to text;
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;

  select * into v_row from public.resources r
  where r.id = p_resource_id and r.visibility = 'public'
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_row.submitted_by is not distinct from (select auth.uid()) then
    perform private.fail('own_submission', '42501');
  end if;
  if v_row.editorial_status in ('rejected', 'removed') then
    perform private.fail('invalid_transition');
  end if;

  v_new_url := case when p ? 'official_url' then nullif(btrim(p ->> 'official_url'), '') else v_row.official_url end;
  v_new_license := case when p ? 'license_code' then coalesce(nullif(p ->> 'license_code', ''), 'unknown') else v_row.license_code end;
  v_new_access := case when p ? 'access_status' then coalesce(nullif(p ->> 'access_status', ''), 'unknown') else v_row.access_status end;

  v_sensitive := v_new_url is distinct from v_row.official_url
    or v_new_license is distinct from v_row.license_code
    or v_new_access is distinct from v_row.access_status;
  v_to := case
    when v_sensitive and v_row.editorial_status in ('verified', 'published', 'suspended') then 'pending'
    else v_row.editorial_status
  end;

  update public.resources set
    title = case when p ? 'title' then btrim(p ->> 'title') else title end,
    abstract = case when p ? 'abstract' then nullif(btrim(p ->> 'abstract'), '') else abstract end,
    authors = case when p ? 'authors' then private.text_array(p -> 'authors') else authors end,
    institution_name = case when p ? 'institution_name' then nullif(btrim(p ->> 'institution_name'), '') else institution_name end,
    publication_year = case when p ? 'publication_year' then nullif(p ->> 'publication_year', '')::smallint else publication_year end,
    level_codes = case when p ? 'level_codes' then private.text_array(p -> 'level_codes') else level_codes end,
    subject_codes = case when p ? 'subject_codes' then private.text_array(p -> 'subject_codes') else subject_codes end,
    tags = case when p ? 'tags' then private.text_array(p -> 'tags') else tags end,
    official_url = v_new_url,
    license_code = v_new_license,
    access_status = v_new_access,
    editorial_status = v_to
  where id = p_resource_id;

  if p ? 'moderation_notes' then
    insert into public.resource_internal (resource_id, moderation_notes)
    values (p_resource_id, nullif(btrim(p ->> 'moderation_notes'), ''))
    on conflict (resource_id) do update set moderation_notes = excluded.moderation_notes;
  end if;

  if v_to is distinct from v_row.editorial_status then
    perform private.record_resource_transition(
      p_resource_id, v_row.editorial_status, v_to, 'edited_requires_review', null, v_row.submitted_by
    );
  else
    perform private.write_audit(
      'moderation', 'resource.edited', null, v_row.submitted_by, null,
      'resources', p_resource_id::text, '{}'::jsonb
    );
  end if;
  return v_to;
end
$$;

-- -----------------------------------------------------------------------------
-- Signalements (authorization-model §5.1, lignes 16 à 18)
-- -----------------------------------------------------------------------------
create function private.report_resource(p_resource_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not private.is_account_active() or not private.is_onboarded() then
    perform private.fail('forbidden', '42501');
  end if;
  -- Seule une fiche publiée et publique se signale par cette voie.
  if not exists (
    select 1 from public.resources r
    where r.id = p_resource_id and r.editorial_status = 'published' and r.visibility = 'public'
  ) then
    perform private.fail('not_found');
  end if;
  if (
    select count(*) from public.resource_reports x
    where x.reporter_id = v_uid and x.created_at > now() - interval '1 day'
  ) >= 20 then
    perform private.fail('rate_limited');
  end if;
  if exists (
    select 1 from public.resource_reports x
    where x.resource_id = p_resource_id and x.reporter_id = v_uid and x.status = 'open'
  ) then
    perform private.fail('already_reported');
  end if;

  insert into public.resource_reports (resource_id, reporter_id, reason, details)
  values (p_resource_id, v_uid, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  returning id into v_id;

  -- Le journal ne porte pas l'identité du signaleur.
  perform private.write_audit(
    'moderation', 'report.created', null, null, null,
    'resource_reports', v_id::text, jsonb_build_object('reason', p_reason)
  );
  return v_id;
end
$$;

create function private.resolve_report(p_report_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;
  if p_status not in ('resolved', 'dismissed') then
    perform private.fail('invalid_action', '22023');
  end if;

  update public.resource_reports set
    status = p_status,
    resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
    handled_by = v_uid,
    handled_at = now()
  where id = p_report_id and status = 'open';
  if not found then
    perform private.fail('not_found');
  end if;

  perform private.write_audit(
    'moderation', 'report.' || p_status, null, null, null,
    'resource_reports', p_report_id::text, '{}'::jsonb
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes exposées par l'API : SECURITY INVOKER, aucun droit ajouté
-- -----------------------------------------------------------------------------
create function public.submit_resource(payload jsonb) returns uuid
language sql security invoker set search_path = ''
as $$ select private.submit_resource(payload); $$;

create function public.update_submission(resource_id uuid, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select private.update_submission(resource_id, payload); $$;

create function public.withdraw_submission(resource_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.withdraw_submission(resource_id); $$;

create function public.moderate_resource(resource_id uuid, action text, reason text default null) returns text
language sql security invoker set search_path = ''
as $$ select private.moderate_resource(resource_id, action, reason); $$;

create function public.moderator_update_resource(resource_id uuid, payload jsonb) returns text
language sql security invoker set search_path = ''
as $$ select private.moderator_update_resource(resource_id, payload); $$;

create function public.report_resource(resource_id uuid, reason text, details text default null) returns uuid
language sql security invoker set search_path = ''
as $$ select private.report_resource(resource_id, reason, details); $$;

create function public.resolve_report(report_id uuid, status text, note text default null) returns void
language sql security invoker set search_path = ''
as $$ select private.resolve_report(report_id, status, note); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'submit_resource(jsonb)',
    'update_submission(uuid, jsonb)',
    'withdraw_submission(uuid)',
    'moderate_resource(uuid, text, text)',
    'moderator_update_resource(uuid, jsonb)',
    'report_resource(uuid, text, text)',
    'resolve_report(uuid, text, text)'
  ] loop
    execute format('revoke all on function private.%s from public, anon', v_signature);
    execute format('revoke all on function public.%s from public, anon', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
