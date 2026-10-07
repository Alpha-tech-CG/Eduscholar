-- =============================================================================
-- D-29 : un compte suspendu n'ouvre plus de session
-- =============================================================================
-- Fermer les sessions à la suspension ne suffit pas : le compte pourrait en
-- rouvrir une (mot de passe, lien de réinitialisation) et s'adresser encore au
-- service d'authentification.
--
-- L'interdiction de connexion du service lui-même (« bannissement ») a été
-- écartée : elle répond « compte banni » avant d'avoir vérifié le mot de
-- passe, et dirait donc à n'importe qui qu'une adresse a un compte, et qu'il
-- est sanctionné.
--
-- Le refus est donc posé ici, à la création de la session : le service ne
-- l'atteint qu'après avoir reconnu le mot de passe ou le lien. Un mauvais mot
-- de passe reçoit la réponse ordinaire ; le bon reçoit une erreur du service,
-- sans session. La règle tient dans la même base que la suspension : aucun
-- état intermédiaire, aucun appel du rôle serveur.
--
-- Réversibilité : supprimer le déclencheur et sa fonction.
-- =============================================================================

create function private.refuse_session_when_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from private.account_status s
    where s.user_id = new.user_id and s.status = 'suspended'
  ) then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.refuse_session_when_suspended()
  from public, anon, authenticated, service_role;
-- Le service d'authentification insère les sessions sous son propre rôle.
grant execute on function private.refuse_session_when_suspended() to supabase_auth_admin;

create trigger sessions_refuse_suspended
  before insert on auth.sessions
  for each row execute function private.refuse_session_when_suspended();
