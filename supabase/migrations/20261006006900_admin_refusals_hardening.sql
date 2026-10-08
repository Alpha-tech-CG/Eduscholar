-- =============================================================================
-- D-31 : corrections de la revue de sécurité des refus consignés en base
-- =============================================================================
--   - les deux lectures d'administration restantes, la liste des comptes et
--     les compteurs de l'authentification, consignent leur refus comme les
--     autres : sonder la liste des détenteurs d'un rôle ne restait pas tracé ;
--   - le plafond de la plateforme ne fait plus taire les refus d'un
--     administrateur, déjà bornés à trente par heure ; quand il est atteint,
--     une ligne le dit, une fois par heure ;
--   - le quota du compte est consommé avant de compter le journal, et un index
--     sert ce décompte : un appel refusé ne parcourt plus le journal ;
--   - l'opération consignée est prise dans une liste fermée ;
--   - la limite de cinquante décisions par compte ne s'applique qu'aux
--     décisions de plus de quatre-vingt-dix jours : une rafale de suspensions
--     et de rétablissements ne chasse plus les motifs récents.
--
-- À savoir pour tout appelant : ces fonctions ne lèvent pas sur un refus de
-- droit. Les deux écritures rendent alors un objet { code, message } ; elles ne
-- rendent `null` que si l'opération a eu lieu. Les lectures refusées ne
-- rendent aucune ligne. Par l'API, la réponse porte le statut 403.
--
-- Attention, pour qui modifiera les lectures : une ligne déjà rendue par
-- `return query` n'est pas retirée par la capture. Aucun refus de droit ne doit
-- être levé après qu'une ligne a été rendue.
--
-- Réversibilité : rétablir les fonctions de la migration 006800 et les
-- enveloppes des migrations 002800 et 006100 ; supprimer l'index.
-- =============================================================================

create index audit_logs_admin_refused_idx
  on public.audit_logs (occurred_at)
  where action in ('admin.refused', 'admin.refusal_platform_overflow');

create or replace function private.write_admin_refusal(p_operation text, p_code text, p_source text)
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

  -- Le quota du compte d'abord : au-delà, plus rien n'est lu ni écrit.
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

  -- Plafond de la plateforme, pour les comptes sans rôle : le journal ne se
  -- vide pas. Les refus d'un administrateur, peu nombreux, passent toujours.
  if not v_admin and (
    select count(*) from public.audit_logs a
    where a.action = 'admin.refused' and a.occurred_at > now() - interval '1 hour'
  ) >= 500 then
    if not exists (
      select 1 from public.audit_logs a
      where a.action = 'admin.refusal_platform_overflow' and a.occurred_at > now() - interval '1 hour'
    ) then
      perform private.write_audit(
        'platform', 'admin.refusal_platform_overflow', null, null, null, null, null,
        jsonb_build_object('source', p_source)
      );
    end if;
    return;
  end if;

  perform private.write_audit(
    'platform', 'admin.refused', v_uid, null, null, 'operation', p_operation,
    jsonb_build_object('code', p_code, 'source', p_source)
  );
end
$$;

create or replace function private.refuse_admin_operation(p_operation text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := case
    when p_operation in ('find_user', 'set_role', 'set_account_status', 'account_history',
                         'list_accounts', 'auth_events') then p_operation
    else 'unknown'
  end;
  v_code text := case
    when p_message in ('forbidden', 'recent_second_factor_required', 'own_account',
                       'account_suspended', 'second_factor_missing') then p_message
    else 'forbidden'
  end;
begin
  perform private.write_admin_refusal(v_operation, v_code, 'database');
  perform set_config('response.status', '403', true);
  return jsonb_build_object('code', '42501', 'message', v_code);
end
$$;

create or replace function public.admin_list_accounts()
returns table (user_id uuid, email text, roles text[], suspended boolean, suspension_reason text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query select * from private.admin_list_accounts();
exception when insufficient_privilege then
  perform private.refuse_admin_operation('list_accounts', sqlerrm);
end
$$;

create or replace function public.admin_auth_events()
returns table (day date, kind text, total bigint)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query select * from private.admin_auth_events();
exception when insufficient_privilege then
  perform private.refuse_admin_operation('auth_events', sqlerrm);
end
$$;

create or replace function private.purge_status_history()
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
  -- Plus de trois ans ; et, parmi les décisions de plus de quatre-vingt-dix
  -- jours, celles qui ne sont pas dans les cinquante plus récentes du compte.
  delete from private.account_status_history h
  where h.changed_at < now() - interval '3 years'
     or (h.changed_at < now() - interval '90 days' and h.id in (
       select o.id from (
         select x.id, row_number() over (partition by x.user_id order by x.changed_at desc, x.id desc) as place
         from private.account_status_history x
       ) o
       where o.place > 50
     ));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
