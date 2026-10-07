-- =============================================================================
-- D-24 : enregistrement automatique de la rédaction
-- =============================================================================
--   - `update_thesis_section` rend la nouvelle date de modification : l'éditeur
--     enchaîne les enregistrements sans relire la section, et le contrôle de
--     version reste exact d'un enregistrement au suivant ;
--   - les enregistrements d'un compte sont limités en débit, en base : la
--     réécriture répétée d'un gros texte par appel direct à l'API est bornée au
--     même titre que par l'application.
--
-- Réversibilité : rétablir la fonction de la migration 002600 (retour `void`)
-- et supprimer `private.consume_user_quota`.
-- =============================================================================

-- Compte une opération du compte courant dans une fenêtre fixe, et refuse
-- au-delà de la limite. La clé ne porte que l'action et l'identifiant du compte.
create function private.consume_user_quota(p_action text, p_limit integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_window timestamptz;
  v_hits integer;
begin
  if v_uid is null then
    perform private.fail('forbidden', '42501');
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (p_action || ':user:' || v_uid::text, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set hits = b.hits + 1
  returning b.hits into v_hits;

  if v_hits > p_limit then
    perform private.fail('rate_limited');
  end if;
end
$$;

revoke all on function private.consume_user_quota(text, integer, integer)
  from public, anon, authenticated, service_role;

drop function public.update_thesis_section(uuid, jsonb);
drop function private.update_thesis_section(uuid, jsonb);

create function private.update_thesis_section(p_section_id uuid, p jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expected text;
  v_updated_at timestamptz;
  v_body text;
begin
  perform private.require_own_section(p_section_id);
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('invalid_payload', '22023');
  end if;
  if p ? 'level' and coalesce(p ->> 'level', '') !~ '^[1-3]$' then
    perform private.fail('invalid_payload', '22023');
  end if;

  -- Deux cents enregistrements par dix minutes et par compte, toutes sections
  -- confondues : l'enregistrement automatique en fait au plus soixante.
  perform private.consume_user_quota('section-save', 200, 600);

  v_expected := p ->> 'expected_updated_at';
  if v_expected is not null then
    if v_expected !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      perform private.fail('invalid_payload', '22023');
    end if;
    select s.updated_at into v_updated_at from public.thesis_sections s where s.id = p_section_id;
    if v_expected::timestamptz is distinct from v_updated_at then
      perform private.fail('conflict', '40001');
    end if;
  end if;

  if p ? 'body' then
    -- Sauts de ligne simples ; espaces de début et de fin retirés, paragraphes conservés.
    v_body := nullif(btrim(
      replace(replace(normalize(coalesce(p ->> 'body', ''), NFC), E'\r\n', E'\n'), E'\r', E'\n'),
      E' \t\n'), '');

    -- Texte total du compte, projets supprimés compris : trois millions de
    -- caractères, soit plus de mille pages.
    perform pg_advisory_xact_lock(hashtextextended('section_quota:' || v_uid::text, 0));
    if coalesce(char_length(v_body), 0) + coalesce((
      select sum(char_length(s.body))
      from public.thesis_sections s
      join public.research_projects r on r.id = s.project_id
      where r.owner_id = v_uid and s.id <> p_section_id
    ), 0) > 3000000 then
      perform private.fail('limit_reached');
    end if;
  end if;

  update public.thesis_sections s
  set title = case when p ? 'title' then coalesce(private.clean_line(p ->> 'title'), '') else s.title end,
      level = case when p ? 'level' then (p ->> 'level')::smallint else s.level end,
      body = case when p ? 'body' then v_body else s.body end
  where s.id = p_section_id
  returning s.updated_at into v_updated_at;

  return v_updated_at;
end
$$;

create function public.update_thesis_section(section_id uuid, payload jsonb) returns timestamptz
language sql security invoker set search_path = ''
as $$ select private.update_thesis_section(section_id, payload); $$;

revoke all on function private.update_thesis_section(uuid, jsonb) from public, anon, service_role;
revoke all on function public.update_thesis_section(uuid, jsonb) from public, anon, service_role;
grant execute on function private.update_thesis_section(uuid, jsonb) to authenticated;
grant execute on function public.update_thesis_section(uuid, jsonb) to authenticated;

comment on function public.update_thesis_section(uuid, jsonb) is
  'Modifie une section de son propre projet ; rend sa nouvelle date de modification.';
