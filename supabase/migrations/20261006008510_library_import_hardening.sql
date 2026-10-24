-- =============================================================================
-- LOT 7, revue de sécurité (MOYEN-2) : import de références borné en base
-- =============================================================================
-- 1. Limite de débit propre à `import_project_sources`, tenue en base et par
--    compte : 20 appels par 15 minutes, 2 000 entrées par 24 heures. Les
--    entrées comptent dès l'appel, qu'elles soient ensuite créées ou refusées.
--    Le contrôle se fait au début, sous verrou, hors de tout sous-bloc. Les
--    traces de plus d'un jour sont effacées au passage : la table ne garde
--    qu'une date et un nombre par appel, rien du contenu.
-- 2. 200 entrées au plus par appel (l'application découpe un fichier de 500).
-- 3. Prévalidation sans exception de chaque entrée (`private.is_importable_source`) :
--    une entrée de forme invalide est refusée sans ouvrir de sous-bloc ; le
--    sous-bloc ne sert plus qu'aux cas résiduels (date impossible, contrainte).
--
-- Réversibilité :
--   rétablir private.import_project_sources de la migration 20261006008500 ;
--   drop function private.is_importable_source(jsonb);
--   drop table private.source_import_calls;
-- =============================================================================

create table private.source_import_calls (
  user_id uuid not null references auth.users (id) on delete cascade,
  called_at timestamptz not null default now(),
  entries integer not null
    constraint source_import_calls_entries_check check (entries between 0 and 200)
);
comment on table private.source_import_calls is
  'Appels à import_project_sources : date et nombre d''entrées, pour la limite de débit. Gardés un jour.';
create index source_import_calls_user_idx on private.source_import_calls (user_id, called_at);

alter table private.source_import_calls enable row level security;
alter table private.source_import_calls force row level security;
revoke all on private.source_import_calls from public, anon, authenticated, service_role;

-- Forme d'une entrée, sans exception possible : types JSON, longueurs,
-- motifs. Reprend les contraintes de project_sources ; la table reste seule
-- à faire foi.
create function private.is_importable_source(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p) is distinct from 'object' then false
    when jsonb_typeof(p -> 'title') is distinct from 'string' then false
    else
      private.is_clean_text_array(array[coalesce(private.clean_line(p ->> 'title'), '')], 1, 500)
      and coalesce(p ->> 'source_type', '')
            in ('', 'article', 'book', 'chapter', 'thesis', 'report', 'conference', 'web', 'other')
      and case coalesce(jsonb_typeof(p -> 'authors'), 'null')
            when 'array' then
              jsonb_array_length(p -> 'authors') <= 50
              and not exists (
                select 1 from jsonb_array_elements(p -> 'authors') as a (v)
                where jsonb_typeof(a.v) <> 'string'
                   or char_length(a.v #>> '{}') > 200
                   or btrim(a.v #>> '{}') = ''
              )
            when 'null' then true
            else false
          end
      and not exists (
        select 1
        from (values ('container_title', 300), ('publisher', 200), ('volume', 50), ('issue', 50),
                     ('pages', 50), ('doi', 255), ('url', 2000), ('publication_year', 4),
                     ('accessed_on', 10), ('source_type', 20)) as f (k, n)
        where (p -> f.k) is not null
          and (jsonb_typeof(p -> f.k) not in ('string', 'null') or char_length(p ->> f.k) > f.n)
      )
      and case
            when coalesce(p ->> 'publication_year', '') = '' then true
            when (p ->> 'publication_year') ~ '^\d{4}$'
              then (p ->> 'publication_year')::integer between 1400 and 2100
            else false
          end
      and coalesce(p ->> 'accessed_on', '') ~ '^(\d{4}-\d{2}-\d{2})?$'
      and (coalesce(p ->> 'doi', '') = ''
           or lower(btrim(p ->> 'doi')) ~ '^10\.[0-9]{4,9}/[^[:space:][:cntrl:]]+$')
      and (coalesce(p ->> 'url', '') = ''
           or btrim(p ->> 'url') ~ '^https?://[^[:space:][:cntrl:]<>"@]+$')
  end;
$$;
revoke all on function private.is_importable_source(jsonb) from public, anon, authenticated, service_role;

create or replace function private.import_project_sources(p_project_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := private.require_own_project(p_project_id);
  v_uid uuid := (select auth.uid());
  v_entry jsonb;
  v_index bigint;
  v_total integer;
  v_created integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_stop text;
  v_code text;
  v_title text;
  v_doi text;
begin
  -- Limite de débit, avant tout examen de la requête et hors sous-bloc.
  perform pg_advisory_xact_lock(hashtextextended('source_import:' || v_uid::text, 0));
  delete from private.source_import_calls c
  where c.user_id = v_uid and c.called_at < now() - interval '1 day';
  if (
    select count(*) from private.source_import_calls c
    where c.user_id = v_uid and c.called_at > now() - interval '15 minutes'
  ) >= 20 then
    perform private.fail('rate_limited');
  end if;

  if jsonb_typeof(p_entries) is distinct from 'array' then
    perform private.fail('invalid_payload', '22023');
  end if;
  v_total := jsonb_array_length(p_entries);
  if v_total = 0 or v_total > 200 then
    perform private.fail('invalid_payload', '22023');
  end if;
  if (
    select coalesce(sum(c.entries), 0) from private.source_import_calls c where c.user_id = v_uid
  ) + v_total > 2000 then
    perform private.fail('rate_limited');
  end if;
  insert into private.source_import_calls (user_id, entries) values (v_uid, v_total);

  for v_entry, v_index in
    select e.value, e.ordinality - 1 from jsonb_array_elements(p_entries) with ordinality as e
  loop
    -- Plafond ou quota atteint : les entrées suivantes échoueraient de même.
    if v_stop is not null then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', v_stop);
      continue;
    end if;
    if not private.is_importable_source(v_entry) then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', 'invalid');
      continue;
    end if;

    -- Doublon d'une source déjà présente : même DOI, ou même titre et même année.
    v_title := private.clean_line(v_entry ->> 'title');
    v_doi := nullif(lower(btrim(coalesce(v_entry ->> 'doi', ''))), '');
    if exists (
      select 1 from public.project_sources s
      where s.project_id = v_project
        and ((v_doi is not null and s.doi = v_doi)
             or (lower(s.title) = lower(v_title)
                 and s.publication_year is not distinct from
                     (nullif(coalesce(v_entry ->> 'publication_year', ''), ''))::smallint))
    ) then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', 'duplicate');
      continue;
    end if;

    begin
      perform private.add_project_source(v_project, v_entry);
      v_created := v_created + 1;
    exception when others then
      v_code := case when sqlerrm in ('limit_reached', 'rate_limited') then sqlerrm else 'invalid' end;
      if v_code <> 'invalid' then
        v_stop := v_code;
      end if;
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'code', v_code);
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'rejected', v_rejected);
end
$$;
