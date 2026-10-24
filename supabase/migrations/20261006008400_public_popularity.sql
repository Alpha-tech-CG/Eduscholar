-- =============================================================================
-- LOT 1, revue de sécurité (MOYEN-1 b, FAIBLE-3) : popularité calculée une
-- fois par jour (ADR-0014)
-- =============================================================================
-- `public_home_sections` comptait les favoris à chaque affichage de l'accueil :
-- une lecture de toute la table, déclenchable sans compte. Et un changement
-- d'ordre visible aussitôt après un favori renseignait sur le geste d'une
-- personne et son moment.
--
-- Désormais :
--   - `private.resource_popularity` garde, par fiche publiée et publique, le
--     nombre de favoris retenus. La table n'est lisible d'aucun rôle de l'API ;
--     le nombre n'est jamais rendu, il sert à l'ordre ;
--   - un favori n'est retenu que s'il vient d'un compte actif : adresse
--     confirmée, ni supprimé, ni banni par le service d'authentification, ni
--     suspendu par la plateforme, et créé depuis au moins sept jours. Un lot
--     de comptes neufs ne fait donc rien monter ;
--   - trois favoris retenus au moins (seuil d'effectif, modèle d'autorisation
--     §5.5) ;
--   - recalcul chaque nuit par la tâche `eduscholar-popularity` (pg_cron, rôle
--     postgres), et une fois à l'application de cette migration ;
--   - la fiche doit encore être publiée et publique à la lecture : une fiche
--     suspendue sort de l'accueil sans attendre le recalcul.
--
-- Réversibilité :
--   select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-popularity';
--   rétablir `private.public_home_sections` de la migration 008300 ;
--   drop function private.refresh_resource_popularity();
--   drop table private.resource_popularity;
-- =============================================================================

create table private.resource_popularity (
  resource_id uuid primary key references public.resources (id) on delete cascade,
  favorites integer not null constraint resource_popularity_favorites_check check (favorites >= 3),
  computed_at timestamptz not null default now()
);
comment on table private.resource_popularity is
  'Favoris retenus par fiche publiée, recalculés chaque nuit. Un nombre, aucune identité ; lisible d''aucun rôle de l''API.';
create index resource_popularity_rank_idx on private.resource_popularity (favorites desc, resource_id);

alter table private.resource_popularity enable row level security;
alter table private.resource_popularity force row level security;
revoke all on private.resource_popularity from public, anon, authenticated, service_role;

-- Rend le nombre de fiches retenues.
create function private.refresh_resource_popularity()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_min_favorites constant integer := 3;
  c_min_account_age constant interval := interval '7 days';
  v_count integer;
begin
  delete from private.resource_popularity where true;

  insert into private.resource_popularity (resource_id, favorites, computed_at)
  select f.resource_id, count(*)::integer, now()
  from public.resource_favorites f
  join auth.users u on u.id = f.user_id
  join public.resources r on r.id = f.resource_id
  where r.editorial_status = 'published' and r.visibility = 'public'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and u.created_at <= now() - c_min_account_age
    and not exists (
      select 1 from private.account_status s
      where s.user_id = u.id and s.status = 'suspended'
    )
  group by f.resource_id
  having count(*) >= c_min_favorites;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function private.refresh_resource_popularity() from public, anon, authenticated, service_role;

-- L'accueil lit l'agrégat ; le reste est inchangé.
create or replace function private.public_home_sections()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recent', (
      select coalesce(jsonb_agg(private.public_resource_object(s.r) order by (s.r).published_at desc, (s.r).id), '[]'::jsonb)
      from (
        select r from public.resources r
        where r.editorial_status = 'published' and r.visibility = 'public'
        order by r.published_at desc, r.id
        limit 6
      ) s
    ),
    -- Agrégat de la nuit : le nombre n'est pas rendu.
    'popular', (
      select coalesce(jsonb_agg(private.public_resource_object(s.r) order by s.n desc, (s.r).published_at desc, (s.r).id), '[]'::jsonb)
      from (
        select r, p.favorites as n
        from private.resource_popularity p
        join public.resources r on r.id = p.resource_id
        where r.editorial_status = 'published' and r.visibility = 'public'
        order by p.favorites desc, r.published_at desc, r.id
        limit 6
      ) s
    ),
    'institutional', (
      select coalesce(jsonb_agg(private.public_resource_object(s.r) order by (s.r).published_at desc, (s.r).id), '[]'::jsonb)
      from (
        select r from public.resources r
        join public.organizations o on o.id = r.organization_id and o.status = 'verified'
        where r.editorial_status = 'published' and r.visibility = 'public'
          and r.source_kind = 'organization'
        order by r.published_at desc, r.id
        limit 6
      ) s
    )
  );
$$;

select private.refresh_resource_popularity();

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-popularity';
select cron.schedule('eduscholar-popularity', '12 4 * * *', 'select private.refresh_resource_popularity()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-popularity' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-popularity doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
