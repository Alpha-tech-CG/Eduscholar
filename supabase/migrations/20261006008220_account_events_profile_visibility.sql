-- =============================================================================
-- Lot 6 (suite) : la publication du profil dans les événements du compte
-- =============================================================================
-- Les changements de visibilité du profil (migration 20261006008210) sont
-- journalisés. Le titulaire doit les retrouver parmi les événements de son
-- compte (copie de ses données) : `profile.published` et
-- `profile.unpublished` rejoignent la liste fermée de private.my_account_events.
--
-- Réversibilité : rétablir private.my_account_events de la migration
-- 20261006006000 (même liste, sans les deux actions).
-- =============================================================================

create or replace function private.my_account_events()
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
    and a.action in (
      'account.data_exported',
      'account.deletion_requested',
      'account_status.insert',
      'account_status.update',
      'account_status.delete',
      'platform_roles.insert',
      'platform_roles.delete',
      'second_factor.recovery_code_used',
      'second_factor.recovery_codes_generated',
      'second_factor.recovery_codes_discarded',
      'project.shared',
      'project.unshared',
      'project.scope_changed',
      'project.version_erased',
      'notifications.unsubscribed_by_link',
      'profile.published',
      'profile.unpublished'
    )
  order by a.occurred_at desc, a.id desc
  limit 2000;
$$;
