-- =============================================================================
-- Durcissement après revue de sécurité : second facteur, catalogue, modération
--
--  1. Essais de code du second facteur bornés par facteur, en base, quel que
--     soit le chemin (vérifié : le service acceptait 40 codes faux d'affilée).
--     Un code juste ne sert qu'une fois par pas de trente secondes.
--  2. Un rôle privilégié exige un second facteur vérifié, antérieur à
--     l'attribution du rôle : un facteur ajouté ou remplacé après coup ne
--     rend pas les droits sans nouvelle attribution.
--  3. Journal d'audit : un signalement n'y laisse plus l'identité du signaleur.
--  4. DOI : l'unicité ne porte plus que sur les fiches vérifiées ou publiées.
--     Une proposition en attente ne bloque plus celle d'autrui et ne permet
--     plus de sonder l'existence d'une fiche non publiée.
--  5. Vérification seulement depuis « en cours d'examen », statut qui gèle la
--     proposition : le contenu vérifié est celui que le modérateur a lu.
--  6. Le rôle serveur ne modifie plus les champs sensibles d'une fiche validée.
--  7. Un modérateur ne lit ni les notes internes ni les signalements de sa
--     propre proposition, et ne traite pas ces signalements.
--  8. Limites de débit des propositions et signalements sérialisées.
--  9. Rien ne se vérifie avec un statut d'accès inconnu, ni une autorisation
--     d'ayant droit sans preuve ; caractères de format invisibles refusés.
--
-- Réversibilité : recréer les fonctions, politiques, index et contraintes des
-- migrations 20261006000100 à 20261006001300 ; supprimer la table
-- private.second_factor_attempts et la fonction du hook.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Second facteur : essais bornés et rejeu refusé
-- -----------------------------------------------------------------------------
create table private.second_factor_attempts (
  factor_id uuid primary key,
  window_start timestamptz not null default now(),
  failures integer not null default 0
    constraint second_factor_attempts_failures_check check (failures >= 0),
  last_success_at timestamptz
);
comment on table private.second_factor_attempts is
  'Compteur d''échecs et dernier succès par facteur. Alimenté par le hook de vérification du second facteur.';

alter table private.second_factor_attempts enable row level security;
alter table private.second_factor_attempts force row level security;
revoke all on private.second_factor_attempts from public, anon, authenticated, service_role;

-- Appelée par le service d'authentification à chaque vérification de code.
-- Dix échecs par quart d'heure et par facteur ; au-delà, tout code est refusé
-- jusqu'à la fin de la fenêtre. Contrepartie assumée : qui connaît le mot de
-- passe peut retarder le titulaire d'un quart d'heure.
create function private.hook_mfa_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factor uuid := (event ->> 'factor_id')::uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_row private.second_factor_attempts;
begin
  insert into private.second_factor_attempts as a (factor_id)
  values (v_factor)
  on conflict (factor_id) do update set
    failures = case when a.window_start < now() - interval '15 minutes' then 0 else a.failures end,
    window_start = case when a.window_start < now() - interval '15 minutes' then now() else a.window_start end
  returning * into v_row;

  if v_row.failures >= 10 then
    return jsonb_build_object('decision', 'reject', 'message', 'too_many_attempts');
  end if;

  if v_valid then
    -- Un même code ne sert qu'une fois : un seul succès par pas de trente secondes.
    if v_row.last_success_at is not null
       and floor(extract(epoch from v_row.last_success_at) / 30)
           = floor(extract(epoch from now()) / 30) then
      return jsonb_build_object('decision', 'reject', 'message', 'code_already_used');
    end if;
    update private.second_factor_attempts
      set last_success_at = now(), failures = 0
      where factor_id = v_factor;
  else
    update private.second_factor_attempts
      set failures = failures + 1
      where factor_id = v_factor;
  end if;

  return jsonb_build_object('decision', 'continue');
end
$$;

revoke all on function private.hook_mfa_verification_attempt(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- 2. Rôles privilégiés : second facteur vérifié, antérieur à l'attribution
-- -----------------------------------------------------------------------------
create or replace function private.has_platform_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active()
    and private.is_session_aal2()
    and exists (
      select 1
      from public.platform_roles r
      where r.user_id = (select auth.uid())
        and r.role = any (p_roles)
        and exists (
          select 1
          from auth.mfa_factors f
          where f.user_id = r.user_id
            and f.status = 'verified'
            and f.created_at <= r.granted_at
        )
    );
$$;

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active()
    and exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and m.role = any (p_roles)
        and o.status <> 'suspended'
        and (m.role <> 'org_admin'
             or (private.is_session_aal2() and private.has_verified_factor()))
    );
$$;

create or replace function private.my_org_ids(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.role = any (p_roles)
    and o.status <> 'suspended'
    and (m.role <> 'org_admin'
         or (private.is_session_aal2() and private.has_verified_factor()))
    and private.is_account_active();
$$;

-- Vrai si l'appelant détient un rôle pour lequel le second facteur est
-- obligatoire : il ne peut pas le désactiver lui-même.
create function private.must_keep_second_factor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.platform_roles r where r.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organization_members m
      where m.user_id = (select auth.uid()) and m.role = 'org_admin'
    );
$$;

create function public.must_keep_second_factor()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.must_keep_second_factor();
$$;

revoke all on function private.must_keep_second_factor() from public, anon;
revoke all on function public.must_keep_second_factor() from public, anon;
grant execute on function private.must_keep_second_factor() to authenticated;
grant execute on function public.must_keep_second_factor() to authenticated;

-- Ses propres soumissions : rien pour un compte suspendu ou une session
-- incomplète.
create or replace function private.my_submission_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.resources r
  where r.submitted_by = (select auth.uid())
    and private.is_account_active();
$$;

-- -----------------------------------------------------------------------------
-- 3. Contraintes du catalogue
-- -----------------------------------------------------------------------------
-- Caractères de format invisibles (sens d'écriture forcé, espace sans chasse) :
-- ils permettent de déguiser un titre ou un nom d'auteur.
create or replace function private.is_clean_text_array(p_values text[], p_max_items integer, p_max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select array_ndims(p_values) is not distinct from case when cardinality(p_values) = 0 then null else 1 end
    and cardinality(p_values) <= p_max_items
    and not exists (
      select 1
      from unnest(p_values) as u (v)
      where v is null
        or char_length(v) > p_max_length
        or char_length(btrim(v)) = 0
        or v ~ '[[:cntrl:]]'
        or v ~ '[​-‏‪-‮⁦-⁩]'
    )
    and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as u (v));
$$;

alter table public.resources
  add constraint resources_title_no_format_characters
    check (title !~ '[​-‏‪-‮⁦-⁩]'),
  add constraint resources_institution_no_format_characters
    check (institution_name is null
           or institution_name !~ '[​-‏‪-‮⁦-⁩]'),
  -- Pas d'identifiants dans l'adresse : « https://vrai.org@autre.example/ »
  -- afficherait un domaine et mènerait à un autre.
  add constraint resources_official_url_no_userinfo
    check (official_url is null or official_url !~ '^https?://[^/?#]*@');

-- Rien ne se vérifie ni ne se publie avec un statut d'accès inconnu.
alter table public.resources
  drop constraint resources_publishable_check,
  add constraint resources_publishable_check
    check (
      editorial_status not in ('verified', 'published')
      or (official_url is not null
          and last_verified_at is not null
          and access_status not in ('removed', 'unknown')
          and (cardinality(authors) > 0 or institution_name is not null))
    );

-- DOI : unique parmi les fiches validées seulement.
drop index public.resources_doi_unique_idx;
create unique index resources_doi_unique_idx
  on public.resources (lower(doi))
  where doi is not null and editorial_status in ('verified', 'published', 'suspended');
create index resources_doi_idx on public.resources (lower(doi)) where doi is not null;

-- -----------------------------------------------------------------------------
-- 4. Garde des champs sensibles pour tout rôle autre que les fonctions nommées
-- -----------------------------------------------------------------------------
-- Les fonctions de transition sont SECURITY DEFINER : elles s'exécutent sous le
-- rôle propriétaire. Tout autre rôle (le rôle serveur d'un connecteur, par
-- exemple) crée des fiches en attente et ne touche ni au statut, ni à la
-- visibilité, ni au contributeur ; sur une fiche validée, il ne change pas non
-- plus le lien, la licence, le statut d'accès ni la provenance.
create or replace function private.guard_resource_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'postgres' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.editorial_status <> 'pending'
       or new.submitted_by is not null
       or new.source_kind <> 'connector'
       or new.visibility <> 'public'
       or new.organization_id is not null
       or new.published_at is not null
       or new.last_verified_at is not null then
      raise exception 'import_must_be_pending' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.editorial_status, new.submitted_by, new.visibility, new.organization_id,
      new.published_at, new.last_verified_at, new.source_kind)
     is distinct from
     (old.editorial_status, old.submitted_by, old.visibility, old.organization_id,
      old.published_at, old.last_verified_at, old.source_kind) then
    raise exception 'status_change_requires_moderation' using errcode = '42501';
  end if;

  if old.editorial_status in ('verified', 'published', 'suspended')
     and (new.official_url, new.license_code, new.access_status, new.doi,
          new.source_name, new.source_identifier)
         is distinct from
         (old.official_url, old.license_code, old.access_status, old.doi,
          old.source_name, old.source_identifier) then
    raise exception 'status_change_requires_moderation' using errcode = '42501';
  end if;

  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Fonctions du catalogue
-- -----------------------------------------------------------------------------
create or replace function private.submit_resource(p jsonb)
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
  if (p ->> 'rights_declared') is distinct from 'true' then
    perform private.fail('rights_declaration_required', '22023');
  end if;

  -- Les appels simultanés d'un même compte passent un par un : la limite de
  -- débit ne se contourne pas en les lançant ensemble.
  perform pg_advisory_xact_lock(hashtextextended('submit_resource:' || v_uid::text, 0));
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

create or replace function private.report_resource(p_resource_id uuid, p_reason text, p_details text default null)
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
  if not exists (
    select 1 from public.resources r
    where r.id = p_resource_id and r.editorial_status = 'published' and r.visibility = 'public'
  ) then
    perform private.fail('not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report_resource:' || v_uid::text, 0));
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

  -- Écriture directe, sans acteur : le journal, lisible par la modération, ne
  -- doit pas porter l'identité du signaleur.
  insert into public.audit_logs (category, action, actor_id, target_type, target_id, metadata)
  values ('moderation', 'report.created', null, 'resource_reports', v_id::text,
          jsonb_build_object('reason', p_reason));
  return v_id;
end
$$;

create or replace function private.resolve_report(p_report_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_resource uuid;
begin
  if not private.has_platform_role(array['moderator']) then
    perform private.fail('forbidden', '42501');
  end if;
  if p_status not in ('resolved', 'dismissed') then
    perform private.fail('invalid_action', '22023');
  end if;

  select x.resource_id into v_resource from public.resource_reports x
  where x.id = p_report_id and x.status = 'open'
  for update;
  if not found then
    perform private.fail('not_found');
  end if;
  -- Séparation des tâches : on ne classe pas un signalement visant sa propre proposition.
  if exists (
    select 1 from public.resources r where r.id = v_resource and r.submitted_by = v_uid
  ) then
    perform private.fail('own_submission', '42501');
  end if;

  update public.resource_reports set
    status = p_status,
    resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
    handled_by = v_uid,
    handled_at = now()
  where id = p_report_id;

  perform private.write_audit(
    'moderation', 'report.' || p_status, null, null, null,
    'resource_reports', p_report_id::text, '{}'::jsonb
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Politiques : un modérateur et sa propre proposition
-- -----------------------------------------------------------------------------
drop policy resource_internal_select on public.resource_internal;
create policy resource_internal_select on public.resource_internal
  for select to authenticated
  using (
    (select private.has_platform_role(array['moderator']))
    and resource_id not in (select private.my_submission_ids())
    and exists (
      select 1 from public.resources r
      where r.id = resource_internal.resource_id and r.visibility = 'public'
    )
  );

drop policy resource_reports_select on public.resource_reports;
create policy resource_reports_select on public.resource_reports
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      id in (select private.my_report_ids())
      or ((select private.has_platform_role(array['moderator']))
          and resource_id not in (select private.my_submission_ids()))
    )
  );
