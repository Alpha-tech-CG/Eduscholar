-- =============================================================================
-- C-05 : appuis de l'export des données personnelles
-- =============================================================================
-- 1. my_report_ids() exposée : l'export ne doit contenir que les signalements
--    faits par le titulaire. La politique de lecture des signalements a une
--    branche pour la modération ; s'en remettre à elle seule ferait entrer les
--    signalements d'autrui dans l'export d'un modérateur.
-- 2. Trace de l'export : un événement de sécurité, sans contenu, que le
--    titulaire peut lire. Une session volée ne peut pas emporter le compte sans
--    laisser de trace.
--
-- Réversibilité : supprimer les trois fonctions.
-- =============================================================================

create function public.my_report_ids() returns setof uuid
language sql security invoker set search_path = ''
as $$ select private.my_report_ids(); $$;

revoke all on function public.my_report_ids() from public, anon, service_role;
grant execute on function public.my_report_ids() to authenticated;

create function private.log_personal_data_export()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_account_active() then
    perform private.fail('forbidden', '42501');
  end if;
  perform private.write_audit(
    'security', 'account.data_exported', v_uid, v_uid, null, 'account', v_uid::text, '{}'::jsonb
  );
end
$$;

create function public.log_personal_data_export() returns void
language sql security invoker set search_path = ''
as $$ select private.log_personal_data_export(); $$;

revoke all on function private.log_personal_data_export() from public, anon, authenticated, service_role;
revoke all on function public.log_personal_data_export() from public, anon, service_role;
grant execute on function private.log_personal_data_export() to authenticated;
grant execute on function public.log_personal_data_export() to authenticated;
