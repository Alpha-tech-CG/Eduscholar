-- =============================================================================
-- E-05 : corrections de la revue de sécurité des notifications
-- =============================================================================
--   - le plafond global de deux cents non lues permettait de faire taire
--     toutes les notifications d'une personne depuis un seul projet. Une
--     notification identique encore non lue n'est plus répétée, et le plafond
--     se compte par projet (cinquante non lues) : un projet bavard ne masque
--     pas les autres ;
--   - les notifications d'un membre partent avec son appartenance : retiré, il
--     n'en garde pas de masquées qui pèseraient sur son plafond ;
--   - une notification qui ne peut pas s'écrire (destinataire supprimé à
--     l'instant) n'annule plus l'événement qui la déclenche.
--
-- Réversibilité : rétablir `private.notify` de la migration 005400, supprimer
-- le déclencheur et l'index.
-- =============================================================================

create index notifications_unread_idx
  on public.notifications (user_id, project_id) where read_at is null;

create or replace function private.notify(
  p_user_id uuid, p_actor uuid, p_kind text, p_project_id uuid,
  p_section_id uuid default null, p_version_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id is not distinct from p_actor then
    return;
  end if;
  -- La même notification, encore non lue, n'est pas répétée.
  if exists (
    select 1 from public.notifications n
    where n.user_id = p_user_id and n.read_at is null
      and n.kind = p_kind and n.project_id = p_project_id
      and n.section_id is not distinct from p_section_id
      and n.version_id is not distinct from p_version_id
  ) then
    return;
  end if;
  -- Cinquante non lues au plus par projet : un projet n'étouffe pas les autres.
  if (select count(*) from public.notifications n
      where n.user_id = p_user_id and n.project_id = p_project_id and n.read_at is null) >= 50 then
    return;
  end if;
  begin
    insert into public.notifications (user_id, kind, project_id, section_id, version_id)
    values (p_user_id, p_kind, p_project_id, p_section_id, p_version_id);
  exception when foreign_key_violation then
    -- Destinataire ou projet supprimé à l'instant : l'événement, lui, a bien lieu.
    null;
  end;
end
$$;

-- Les notifications d'un membre sur un projet partent avec son appartenance.
create function private.drop_member_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
  where n.user_id = old.user_id and n.project_id = old.project_id;
  return old;
end
$$;

revoke all on function private.drop_member_notifications() from public, anon, authenticated, service_role;
-- Une appartenance part aussi quand le service d'authentification supprime un compte.
grant execute on function private.drop_member_notifications() to supabase_auth_admin;

create trigger research_project_members_drop_notifications
  after delete on public.research_project_members
  for each row execute function private.drop_member_notifications();
