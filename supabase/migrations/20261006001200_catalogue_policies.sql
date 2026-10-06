-- =============================================================================
-- B-13 — Politiques du catalogue : identités masquées
--
-- L'identité du contributeur (resources.submitted_by) et celle du signaleur
-- (resource_reports.reporter_id) ne sont pas lisibles par les utilisateurs.
-- Or PostgreSQL exige le droit de lecture sur toute colonne qu'une politique
-- référence : une politique écrite « submitted_by = auth.uid() » rendait la
-- table illisible. Les politiques passent donc par des fonctions d'appui, qui
-- renvoient les identifiants des lignes de l'appelant sans exposer la colonne.
--
-- Réversibilité : recréer les trois politiques de la migration 20261006001000.
-- =============================================================================

create function private.my_submission_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.resources r
  where r.submitted_by = (select auth.uid());
$$;

create function private.my_report_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.id
  from public.resource_reports x
  where x.reporter_id = (select auth.uid());
$$;

revoke all on function private.my_submission_ids() from public, anon;
revoke all on function private.my_report_ids() from public, anon;
grant execute on function private.my_submission_ids() to authenticated;
grant execute on function private.my_report_ids() to authenticated;

drop policy resources_select on public.resources;
create policy resources_select on public.resources
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      -- Fiche publiée, publique.
      (editorial_status = 'published' and visibility = 'public')
      -- Fiche publiée, réservée à une organisation dont on est membre.
      or (editorial_status = 'published'
          and visibility = 'organization'
          and organization_id in (
            select private.my_org_ids(array['org_admin', 'librarian', 'teacher', 'member'])
          ))
      -- Sa propre soumission, quel que soit son statut.
      or id in (select private.my_submission_ids())
      -- Modération : les fiches publiques, à tout statut.
      or (visibility = 'public' and (select private.has_platform_role(array['moderator'])))
      -- Catalogue institutionnel : ceux qui le gèrent.
      or (visibility = 'organization'
          and organization_id in (select private.my_org_ids(array['org_admin', 'librarian'])))
    )
  );

drop policy resource_status_history_select on public.resource_status_history;
create policy resource_status_history_select on public.resource_status_history
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      (select private.has_platform_role(array['moderator']))
      or resource_id in (select private.my_submission_ids())
    )
  );

drop policy resource_reports_select on public.resource_reports;
create policy resource_reports_select on public.resource_reports
  for select to authenticated
  using (
    (select private.is_account_active())
    and (
      id in (select private.my_report_ids())
      or (select private.has_platform_role(array['moderator']))
    )
  );
