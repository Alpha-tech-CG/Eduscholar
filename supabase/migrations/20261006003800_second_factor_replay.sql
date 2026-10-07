-- =============================================================================
-- D-28 : un code à six chiffres ne sert qu'une fois, pas de voisin compris
-- =============================================================================
-- Le service d'authentification accepte le code du pas de trente secondes
-- courant, du précédent et du suivant. La base ne refusait un second succès
-- que dans le même pas : un code accepté en fin de pas pouvait resservir au
-- début du suivant.
--
-- Un code accepté au pas T appartient au pas T-1, T ou T+1 ; il reste donc
-- recevable par le service jusqu'à la fin du pas T+2. La base refuse désormais
-- tout second succès du même facteur jusque-là : une minute à une minute et
-- demie d'attente entre deux codes.
--
-- Un refus par ce hook ferme toutes les sessions du compte. Pour qu'un
-- titulaire trop pressé ne soit pas déconnecté, l'application lit d'abord
-- l'attente restante (`second_factor_wait_seconds`) et l'annonce.
--
-- Réversibilité : rétablir la fonction du hook de la migration 001400 et
-- supprimer `second_factor_wait_seconds`.
-- =============================================================================

create or replace function private.hook_mfa_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factor uuid := (event ->> 'factor_id')::uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_row private.second_factor_attempts;
begin
  insert into private.second_factor_attempts as a (factor_id)
  values (v_factor)
  on conflict (factor_id) do update set
    failures = case when a.window_start < now() - interval '15 minutes' then 0 else a.failures end,
    window_start = case when a.window_start < now() - interval '15 minutes' then now() else a.window_start end
  returning * into v_row;

  if v_row.failures >= 10 then
    return jsonb_build_object('decision', 'reject', 'message', 'too_many_attempts');
  end if;

  if v_valid then
    -- Un même code ne sert qu'une fois. Le service accepte aussi le code des
    -- pas voisins : aucun second succès tant que le code du premier peut
    -- encore être reçu, soit jusqu'à la fin du deuxième pas suivant.
    if v_row.last_success_at is not null
       and floor(extract(epoch from now()) / 30)
           <= floor(extract(epoch from v_row.last_success_at) / 30) + 2 then
      return jsonb_build_object('decision', 'reject', 'message', 'code_already_used');
    end if;
    update private.second_factor_attempts
      set last_success_at = now(), failures = 0
      where factor_id = v_factor;
  else
    update private.second_factor_attempts
      set failures = failures + 1
      where factor_id = v_factor;
  end if;

  return jsonb_build_object('decision', 'continue');
end
$$;

-- Secondes à attendre avant qu'un nouveau code du compte puisse être accepté.
-- Zéro : aucun code accepté récemment. Répond à la session qui n'a pas encore
-- présenté son second facteur — c'est elle qui saisit le code à la connexion —,
-- mais pas à une session fermée.
create function private.second_factor_wait_seconds()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or not private.is_session_live() then 0
    else coalesce((
      select max(greatest(0, ceil(
        (floor(extract(epoch from a.last_success_at) / 30) + 3) * 30 - extract(epoch from now())
      )))::integer
      from private.second_factor_attempts a
      join auth.mfa_factors f on f.id = a.factor_id
      where f.user_id = (select auth.uid())
        and f.status = 'verified'
        and a.last_success_at is not null
    ), 0)
  end;
$$;

create function public.second_factor_wait_seconds() returns integer
language sql stable security invoker set search_path = ''
as $$ select private.second_factor_wait_seconds(); $$;

revoke all on function private.second_factor_wait_seconds() from public, anon, service_role;
revoke all on function public.second_factor_wait_seconds() from public, anon, service_role;
grant execute on function private.second_factor_wait_seconds() to authenticated;
grant execute on function public.second_factor_wait_seconds() to authenticated;

comment on function public.second_factor_wait_seconds() is
  'Secondes avant qu''un nouveau code de validation du compte puisse être accepté (zéro si aucun code récent).';
