-- =============================================================================
-- D-26 : suites du journal d'administration
-- =============================================================================
--   - historique des suspensions : le motif d'une suspension s'effaçait au
--     rétablissement, et suspendre de nouveau écrasait le précédent. Chaque
--     décision est désormais gardée, avec son motif et son auteur, tant que le
--     compte existe ;
--   - tentatives refusées : une opération refusée annule sa transaction, et
--     n'écrit donc rien au journal. L'application consigne le refus dans une
--     transaction à elle, après coup : qui, quelle opération, quel motif de
--     refus — jamais la cible ;
--   - la suppression en cascade d'un compte n'attribue plus la ligne d'audit
--     de son rôle à l'administrateur qui l'avait accordé : c'était corrigé
--     depuis la migration 000800, un test le fixe désormais.
--
-- Limite connue : un refus opposé à un appel direct de l'API, hors
-- application, n'est pas consigné ici ; il se lit dans les journaux de l'API.
--
-- Réversibilité : supprimer les fonctions, les déclencheurs, puis la table.
-- =============================================================================

create table private.account_status_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null
    constraint account_status_history_status_check check (status in ('active', 'suspended')),
  reason text,
  -- Simple identifiant, sans clé étrangère : mis à vide si son compte est supprimé.
  changed_by uuid,
  changed_at timestamptz not null default now()
);
comment on table private.account_status_history is
  'Suspensions et rétablissements d''un compte, avec leur motif. Écrit par la base seulement ; part avec le compte.';
create index account_status_history_user_id_idx on private.account_status_history (user_id, changed_at desc);
create index account_status_history_changed_by_idx on private.account_status_history (changed_by);

alter table private.account_status_history enable row level security;
alter table private.account_status_history force row level security;
revoke all on private.account_status_history from public, anon, authenticated, service_role;

create function private.record_account_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.reason is not distinct from old.reason then
    return new;
  end if;
  insert into private.account_status_history (user_id, status, reason, changed_by, changed_at)
  values (new.user_id, new.status, new.reason, new.changed_by, new.changed_at);
  return new;
end
$$;

revoke all on function private.record_account_status() from public, anon, authenticated, service_role;

create trigger account_status_history
  after insert or update on private.account_status
  for each row execute function private.record_account_status();

-- Les suspensions en cours entrent dans l'historique.
insert into private.account_status_history (user_id, status, reason, changed_by, changed_at)
select s.user_id, s.status, s.reason, s.changed_by, s.changed_at
from private.account_status s
where s.status = 'suspended';

-- L'auteur d'une décision qui supprime son compte n'y laisse pas d'identifiant.
create function private.anonymize_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.account_status_history h set changed_by = null where h.changed_by = old.id;
  return old;
end
$$;

revoke all on function private.anonymize_status_history() from public, anon, authenticated, service_role;
grant execute on function private.anonymize_status_history() to supabase_auth_admin;

create trigger users_anonymize_status_history
  before delete on auth.users
  for each row execute function private.anonymize_status_history();

-- -----------------------------------------------------------------------------
-- L'administration : lire l'historique d'un compte
-- -----------------------------------------------------------------------------
-- Les cinquante décisions les plus récentes. La lecture est journalisée.
create function private.admin_account_history(p_user uuid)
returns table (changed_at timestamptz, status text, reason text, changed_by_email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_user is null then
    perform private.fail('invalid_payload', '22023');
  end if;
  perform private.write_audit(
    'platform', 'user.history_read', (select auth.uid()), p_user, null, 'account', p_user::text, '{}'::jsonb
  );
  return query
  select h.changed_at, h.status, h.reason, u.email::text
  from private.account_status_history h
  left join auth.users u on u.id = h.changed_by
  where h.user_id = p_user
  order by h.changed_at desc, h.id desc
  limit 50;
end
$$;

-- -----------------------------------------------------------------------------
-- Consigner une tentative refusée
-- -----------------------------------------------------------------------------
-- Appelée par l'application, sous la session de qui vient d'essuyer le refus,
-- dans une transaction distincte de celle qui a été annulée. L'opération et le
-- motif sont pris dans des listes fermées : rien de libre n'entre au journal,
-- et la cible n'y figure pas. Trente lignes par heure et par compte ; au-delà,
-- l'appel ne fait rien.
create function private.log_admin_refusal(p_operation text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or p_operation is null
     or p_operation not in ('find_user', 'set_role', 'set_account_status', 'account_history')
     or p_code is null
     or p_code not in (
       'forbidden', 'recent_second_factor_required', 'own_account', 'not_found',
       'account_suspended', 'second_factor_missing', 'invalid_transition', 'rate_limited',
       'last_super_admin'
     ) then
    return;
  end if;
  begin
    perform private.consume_user_quota('admin-refusal', 30, 3600);
  exception when others then
    return;
  end;
  perform private.write_audit(
    'platform', 'admin.refused', v_uid, null, null, 'operation', p_operation,
    jsonb_build_object('code', p_code)
  );
end
$$;

create function public.admin_account_history(target_user uuid)
returns table (changed_at timestamptz, status text, reason text, changed_by_email text)
language sql security invoker set search_path = ''
as $$ select * from private.admin_account_history(target_user); $$;

create function public.log_admin_refusal(operation text, code text) returns void
language sql security invoker set search_path = ''
as $$ select private.log_admin_refusal(operation, code); $$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array['admin_account_history(uuid)', 'log_admin_refusal(text, text)'] loop
    execute format('revoke all on function private.%s from public, anon, service_role', v_signature);
    execute format('revoke all on function public.%s from public, anon, service_role', v_signature);
    execute format('grant execute on function private.%s to authenticated', v_signature);
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end
$$;
