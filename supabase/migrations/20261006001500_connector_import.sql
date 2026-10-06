-- =============================================================================
-- B-15 : import d'une fiche depuis une source autorisée (premier connecteur : Crossref)
-- =============================================================================
-- Un modérateur saisit un DOI ; le serveur interroge la source, normalise la
-- réponse et appelle cette fonction avec le rôle serveur. Les métadonnées ne
-- viennent donc jamais du navigateur : la provenance enregistrée est vraie.
--
-- La fonction revérifie que l'acteur détient un rôle de modération assorti d'un
-- second facteur antérieur au rôle. Que sa session ait présenté ce facteur est
-- vérifié par le serveur, sous la session du modérateur, juste avant l'appel.
--
-- Règles (docs/product/authorized-sources.md) : métadonnées et lien officiel
-- seulement ; statut « en attente » ; aucun champ déduit ; source, identifiant
-- dans la source et date de récupération conservés.
--
-- Réversibilité : supprimer les deux fonctions.
-- =============================================================================

create function private.import_connector_resource(p_actor uuid, p jsonb)
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
         and r.role in ('moderator', 'platform_admin', 'super_admin')
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
  where r.source_name = v_source and r.source_identifier = v_identifier;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  -- Un DOI déjà porté par une fiche validée n'est pas réimporté.
  if v_doi is not null then
    select r.id into v_id
    from public.resources r
    where lower(r.doi) = v_doi
      and r.editorial_status in ('verified', 'published', 'suspended')
    limit 1;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'created', false);
    end if;
  end if;

  -- Deux cents imports par jour et par modérateur : borne les erreurs de
  -- manipulation et la charge envoyée à la source.
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

revoke all on function private.import_connector_resource(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.import_connector_resource(uuid, jsonb) to service_role;

create function public.import_connector_resource(actor_id uuid, payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_connector_resource(actor_id, payload);
$$;

revoke all on function public.import_connector_resource(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.import_connector_resource(uuid, jsonb) to service_role;

comment on function public.import_connector_resource(uuid, jsonb) is
  'Import d''une fiche par un connecteur, au nom d''un modérateur. Rôle serveur uniquement.';
