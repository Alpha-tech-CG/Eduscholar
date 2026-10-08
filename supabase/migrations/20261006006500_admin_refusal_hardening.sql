-- =============================================================================
-- D-26 : corrections de la revue de sécurité du journal d'administration
-- =============================================================================
--   - un compte sans rôle d'administration ne peut déclarer que le refus qu'il
--     peut réellement essuyer, « forbidden » : les autres motifs ne sont émis
--     qu'une fois le contrôle d'administration franchi, et le journal aurait
--     laissé croire qu'il l'avait franchi ;
--   - chaque ligne dit d'où elle vient (« app ») : elle est déclarée par
--     l'application, pas écrite par la base dans la transaction du refus ;
--   - plafonds : cinq par heure pour un compte sans rôle, trente pour un
--     administrateur, cinq cents par heure pour toute la plateforme. Le
--     premier dépassement d'une heure laisse une ligne à lui : le silence qui
--     suit se voit ;
--   - seul le dépassement du plafond est absorbé : toute autre erreur remonte ;
--   - l'historique d'un compte inexistant n'écrit plus de ligne de lecture ;
--   - la liste des comptes montre d'abord ceux qui détiennent un rôle : une
--     vague de suspensions ne les en chasse pas.
--
-- Reste à faire (backlog) : consigner le refus dans la base elle-même, pour
-- qu'un appel direct à l'API laisse la même trace.
--
-- Réversibilité : rétablir les fonctions des migrations 002800 et 006300.
-- =============================================================================

create or replace function private.log_admin_refusal(p_operation text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_uid is null
     or p_operation is null
     or p_operation not in ('find_user', 'set_role', 'set_account_status', 'account_history')
     or p_code is null
     or p_code not in (
       'forbidden', 'recent_second_factor_required', 'own_account', 'not_found',
       'account_suspended', 'second_factor_missing', 'invalid_transition', 'rate_limited'
     ) then
    return;
  end if;
  v_admin := private.highest_role_rank(v_uid) >= 2;
  -- Sans rôle d'administration, le seul refus possible est « forbidden ».
  if not v_admin and p_code <> 'forbidden' then
    return;
  end if;
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
        jsonb_build_object('source', 'app')
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
    jsonb_build_object('code', p_code, 'source', 'app')
  );
end
$$;

create or replace function private.admin_account_history(p_user uuid)
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
  perform 1 from auth.users u where u.id = p_user;
  if not found then
    perform private.fail('not_found');
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

-- Les détenteurs d'un rôle d'abord, puis les comptes suspendus.
create or replace function private.admin_list_accounts()
returns table (user_id uuid, email text, roles text[], suspended boolean, suspension_reason text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select u.id, u.email::text,
         coalesce((select array_agg(r.role order by r.role) from public.platform_roles r where r.user_id = u.id), '{}'),
         coalesce(s.status = 'suspended', false),
         case when s.status = 'suspended' then s.reason end
  from auth.users u
  left join private.account_status s on s.user_id = u.id
  where exists (select 1 from public.platform_roles r where r.user_id = u.id)
     or s.status = 'suspended'
  order by exists (select 1 from public.platform_roles r where r.user_id = u.id) desc, u.email
  limit 500;
end
$$;
