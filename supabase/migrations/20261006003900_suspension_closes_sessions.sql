-- =============================================================================
-- D-29 : suspendre un compte ferme ses sessions
-- =============================================================================
-- La suspension retirait tout droit en base, mais laissait vivre les sessions
-- du compte auprès du service d'authentification : il pouvait encore s'y
-- adresser directement (changer son mot de passe, enrôler un facteur).
--
-- Les sessions sont désormais supprimées dans la transaction même de la
-- suspension, quel que soit le chemin qui l'écrit. L'application pose en plus,
-- par le rôle serveur, l'interdiction de se reconnecter (voir
-- `docs/security/authorization-model.md` §7.5).
--
-- Réversibilité : supprimer le déclencheur et sa fonction.
-- =============================================================================

create function private.close_sessions_on_suspension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Les jetons de rafraîchissement partent avec leur session (cascade).
  delete from auth.sessions s where s.user_id = new.user_id;
  return new;
end
$$;

revoke all on function private.close_sessions_on_suspension()
  from public, anon, authenticated, service_role;

create trigger account_status_close_sessions
  after insert or update of status on private.account_status
  for each row
  when (new.status = 'suspended')
  execute function private.close_sessions_on_suspension();
