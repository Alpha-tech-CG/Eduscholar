-- =============================================================================
-- D-15 : les référentiels ne se lisent plus par l'API, mais par une fonction
-- =============================================================================
-- Tout compte connecté lisait les neuf tables de référence directement. L'API
-- permet d'imbriquer des lectures en suivant les clés étrangères, et rien ne
-- borne la profondeur : programmes → spécialités → programmes → matières…
-- Une seule requête pouvait occuper la base jusqu'au délai de huit secondes.
--
-- Les référentiels sont désormais rendus en une fois par une fonction, en un
-- seul objet : rien à imbriquer, rien à paginer. La lecture directe des tables
-- est retirée aux comptes connectés ; elles ne peuvent donc plus servir de
-- maillon à une requête imbriquée partie d'une autre table.
--
-- Trente lectures par minute et par compte : c'est une lecture de page, pas
-- une lecture de boucle.
--
-- Le rôle serveur garde sa lecture (import par connecteur). Les politiques de
-- lecture restent en place, sans effet tant que le droit de table est retiré.
--
-- Réversibilité : rendre `select` aux comptes connectés sur les neuf tables ;
-- supprimer les fonctions.
-- =============================================================================

create function private.reference_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.is_account_active() then null else jsonb_build_object(
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                  from public.countries x where x.is_active),
    'languages', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                  from public.languages x where x.is_active),
    'licenses', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels, 'can_host', x.can_host) order by x.position, x.code), '[]'::jsonb)
                 from public.licenses x where x.is_active),
    'resource_types', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                       from public.resource_types x where x.is_active),
    'education_levels', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                         from public.education_levels x where x.is_active),
    'academic_domains', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                         from public.academic_domains x where x.is_active),
    'academic_programs', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'domain_code', x.domain_code, 'labels', x.labels) order by x.code), '[]'::jsonb)
                          from public.academic_programs x where x.is_active),
    'program_specialties', (select coalesce(jsonb_agg(jsonb_build_object('program_code', x.program_code, 'code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                            from public.program_specialties x where x.is_active),
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object('program_code', x.program_code, 'code', x.code, 'labels', x.labels) order by x.position, x.code), '[]'::jsonb)
                 from public.subjects x where x.is_active)
  ) end;
$$;

-- Le compteur écrit : il ne peut pas vivre dans la fonction de lecture, que
-- l'API exécute en lecture seule. L'enveloppe, volatile, compte puis lit.
create function private.read_reference_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  perform private.consume_user_quota('reference-data', 30, 60);
  return private.reference_data();
end
$$;

create function public.reference_data() returns jsonb
language sql security invoker set search_path = ''
as $$ select private.read_reference_data(); $$;

revoke all on function private.reference_data() from public, anon, authenticated, service_role;
revoke all on function private.read_reference_data() from public, anon, service_role;
revoke all on function public.reference_data() from public, anon, service_role;
grant execute on function private.read_reference_data() to authenticated;
grant execute on function public.reference_data() to authenticated;

revoke select on
  public.countries, public.languages, public.licenses, public.resource_types,
  public.education_levels, public.academic_domains, public.academic_programs,
  public.program_specialties, public.subjects
from authenticated;
