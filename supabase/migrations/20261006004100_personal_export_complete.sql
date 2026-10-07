-- =============================================================================
-- D-25 : la copie des données personnelles, complétée
-- =============================================================================
-- Deux ensembles manquaient à la copie remise au titulaire :
--
--   - le journal des événements qui concernent son compte (connexion à un rôle,
--     suspension, export, second facteur, codes de secours) : la date et la
--     nature de l'événement, jamais son auteur ni ses détails internes ;
--   - ses projets supprimés, tant qu'ils ne sont pas purgés (trente jours) :
--     ils ne sont plus lisibles par la voie ordinaire, mais restent ses données.
--
-- Réversibilité : supprimer les quatre fonctions.
-- =============================================================================

create function private.my_account_events()
returns table (occurred_at timestamptz, category text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.occurred_at, a.category, a.action
  from public.audit_logs a
  where private.is_account_active()
    and a.subject_user_id = (select auth.uid())
    and a.category in ('security', 'platform')
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;

create function public.my_account_events()
returns table (occurred_at timestamptz, category text, action text)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_account_events(); $$;

-- Un objet par projet supprimé : sa fiche, ses sources avec leur fiche de
-- lecture, ses sections avec leurs citations.
create function private.my_deleted_projects()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(r) - 'owner_id')
    || jsonb_build_object(
      'sources', coalesce((
        select jsonb_agg(
          (to_jsonb(s) - 'project_id')
            || jsonb_build_object('literature_note', (
              select to_jsonb(n) - 'source_id' from public.literature_notes n where n.source_id = s.id
            ))
          order by s.created_at, s.id)
        from public.project_sources s where s.project_id = r.id
      ), '[]'::jsonb),
      'sections', coalesce((
        select jsonb_agg(
          (to_jsonb(t) - 'project_id')
            || jsonb_build_object('citations', coalesce((
              select jsonb_agg(to_jsonb(c) - 'section_id' order by c.created_at, c.source_id)
              from public.section_citations c where c.section_id = t.id
            ), '[]'::jsonb))
          order by t.position)
        from public.thesis_sections t where t.project_id = r.id
      ), '[]'::jsonb)
    )
  from public.research_projects r
  where private.is_account_active()
    and r.owner_id = (select auth.uid())
    and r.deleted_at is not null
  order by r.deleted_at, r.id;
$$;

create function public.my_deleted_projects() returns setof jsonb
language sql stable security invoker set search_path = ''
as $$ select private.my_deleted_projects(); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array['my_account_events()', 'my_deleted_projects()'] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;

comment on function public.my_account_events() is
  'Événements du journal qui concernent le compte de l''appelant : date, catégorie, nature. Ni auteur ni détail.';
comment on function public.my_deleted_projects() is
  'Projets supprimés de l''appelant en attente de purge, avec leurs sources et sections.';
