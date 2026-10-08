-- =============================================================================
-- D-31 : les refus d'administration consignés par la base elle-même
-- =============================================================================
-- Une opération refusée annulait sa transaction, et sa trace avec elle. Depuis
-- la migration 006300 l'application consignait le refus après coup ; un appel
-- direct à l'API, lui, n'en laissait aucune — or c'est celui d'un attaquant.
--
-- Les fonctions d'administration exposées par l'API capturent désormais le
-- refus (droit insuffisant), l'écrivent au journal, et rendent une réponse
-- « 403 » sans lever d'erreur : la transaction aboutit, la trace reste. Ce que
-- la fonction avait pu faire avant le refus est annulé comme avant.
--
--   - pour l'appelant de l'API, rien ne change : réponse 403, et le même code
--     de refus dans le corps pour les deux opérations d'écriture ;
--   - les règles restent dans les fonctions du schéma `private`, qui lèvent
--     toujours ; seules leurs enveloppes changent ;
--   - la trace est écrite par la base (`source: database`) : elle ne dépend
--     plus de l'honnêteté de l'appelant, qui ne peut ni la fabriquer ni
--     l'omettre. L'application ne déclare plus que le refus qu'elle oppose
--     elle-même : la limite de débit de la recherche d'un compte ;
--   - mêmes plafonds qu'avant : cinq par heure sans rôle, trente pour un
--     administrateur, cinq cents pour la plateforme, dépassement signalé.
--
-- Conservation de l'historique des suspensions : trois ans, et les cinquante
-- décisions les plus récentes d'un compte au plus.
--
-- Réversibilité : rétablir les enveloppes des migrations 002800 et 006300 et
-- `log_admin_refusal` de la migration 006500 ; supprimer la tâche planifiée.
-- =============================================================================

-- Écrit une ligne de refus, dans la limite des plafonds.
create function private.write_admin_refusal(p_operation text, p_code text, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_uid is null then
    return;
  end if;
  v_admin := private.highest_role_rank(v_uid) >= 2;
  -- Plafond de la plateforme : le journal ne se vide pas.
  if (select count(*) from public.audit_logs a
      where a.action = 'admin.refused' and a.occurred_at > now() - interval '1 hour') >= 500 then
    return;
  end if;

  begin
    perform private.consume_user_quota('admin-refusal', case when v_admin then 30 else 5 end, 3600);
  exception when raise_exception then
    if sqlerrm <> 'rate_limited' then
      raise;
    end if;
    -- Plafond atteint : une ligne, une seule par heure, dit que la suite manque.
    begin
      perform private.consume_user_quota('admin-refusal-overflow', 1, 3600);
      perform private.write_audit(
        'platform', 'admin.refusal_overflow', v_uid, null, null, null, null,
        jsonb_build_object('source', p_source)
      );
    exception when raise_exception then
      if sqlerrm <> 'rate_limited' then
        raise;
      end if;
    end;
    return;
  end;

  perform private.write_audit(
    'platform', 'admin.refused', v_uid, null, null, 'operation', p_operation,
    jsonb_build_object('code', p_code, 'source', p_source)
  );
end
$$;

-- Appelée par une enveloppe qui vient de capturer un refus : le consigne, et
-- demande à l'API de répondre « 403 ». Le code est ramené à une liste fermée.
create function private.refuse_admin_operation(p_operation text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := case
    when p_message in ('forbidden', 'recent_second_factor_required', 'own_account',
                       'account_suspended', 'second_factor_missing') then p_message
    else 'forbidden'
  end;
begin
  perform private.write_admin_refusal(p_operation, v_code, 'database');
  perform set_config('response.status', '403', true);
  return jsonb_build_object('code', '42501', 'message', v_code);
end
$$;

revoke all on function private.write_admin_refusal(text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.refuse_admin_operation(text, text) from public, anon, service_role;
grant execute on function private.refuse_admin_operation(text, text) to authenticated;

-- L'application ne déclare plus que le refus qu'elle oppose elle-même.
create or replace function private.log_admin_refusal(p_operation text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or p_operation is distinct from 'find_user'
     or p_code is distinct from 'rate_limited'
     or private.highest_role_rank((select auth.uid())) < 2 then
    return;
  end if;
  perform private.write_admin_refusal(p_operation, p_code, 'app');
end
$$;

-- -----------------------------------------------------------------------------
-- Enveloppes : le refus est capturé, consigné, rendu en « 403 »
-- -----------------------------------------------------------------------------
drop function public.admin_set_role(uuid, text, boolean);
create function public.admin_set_role(target_user uuid, role text, grant_role boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_set_role(target_user, role, grant_role);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('set_role', sqlerrm);
end
$$;

drop function public.admin_set_account_status(uuid, boolean, text);
create function public.admin_set_account_status(target_user uuid, suspended boolean, reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.admin_set_account_status(target_user, suspended, reason);
  return null;
exception when insufficient_privilege then
  return private.refuse_admin_operation('set_account_status', sqlerrm);
end
$$;

-- Les deux lectures rendent des lignes : refusées, elles n'en rendent aucune,
-- et la réponse « 403 » le dit.
-- Le paramètre de l'API et une colonne rendue portent le même nom, ce qu'une
-- fonction plpgsql n'admet pas : la capture se fait un cran plus bas.
create function private.admin_find_user_guarded(p_email text)
returns table (
  user_id uuid, email text, created_at timestamptz, confirmed boolean,
  roles text[], suspended boolean, suspension_reason text, has_second_factor boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query select * from private.admin_find_user(p_email);
exception when insufficient_privilege then
  perform private.refuse_admin_operation('find_user', sqlerrm);
end
$$;

revoke all on function private.admin_find_user_guarded(text) from public, anon, service_role;
grant execute on function private.admin_find_user_guarded(text) to authenticated;

create or replace function public.admin_find_user(email text)
returns table (
  user_id uuid, email text, created_at timestamptz, confirmed boolean,
  roles text[], suspended boolean, suspension_reason text, has_second_factor boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.admin_find_user_guarded(email); $$;

create or replace function public.admin_account_history(target_user uuid)
returns table (changed_at timestamptz, status text, reason text, changed_by_email text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query select * from private.admin_account_history(target_user);
exception when insufficient_privilege then
  perform private.refuse_admin_operation('account_history', sqlerrm);
end
$$;

revoke all on function public.admin_set_role(uuid, text, boolean) from public, anon, service_role;
revoke all on function public.admin_set_account_status(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.admin_set_role(uuid, text, boolean) to authenticated;
grant execute on function public.admin_set_account_status(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Conservation de l'historique des suspensions
-- -----------------------------------------------------------------------------
create function private.purge_status_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if session_user <> 'postgres' then
    perform private.fail('forbidden', '42501');
  end if;
  delete from private.account_status_history h
  where h.changed_at < now() - interval '3 years'
     or h.id in (
       select o.id from (
         select x.id, row_number() over (partition by x.user_id order by x.changed_at desc, x.id desc) as place
         from private.account_status_history x
       ) o
       where o.place > 50
     );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function private.purge_status_history() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'eduscholar-status-history-purge';
select cron.schedule('eduscholar-status-history-purge', '57 3 * * *', 'select private.purge_status_history()');

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'eduscholar-status-history-purge' and username = 'postgres' and active
  ) then
    raise exception 'La tâche eduscholar-status-history-purge doit être planifiée et active sous le rôle postgres';
  end if;
end
$$;
