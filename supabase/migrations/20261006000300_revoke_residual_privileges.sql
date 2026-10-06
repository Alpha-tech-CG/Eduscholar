-- =============================================================================
-- B-09 — Retrait des droits résiduels
--
-- Le test de configuration a montré que les rôles de l'API conservaient, par
-- les privilèges par défaut de la plateforme, TRUNCATE, REFERENCES et TRIGGER
-- sur les tables de public. Aucune opération prévue n'en a besoin.
--
-- Réversibilité : GRANT des mêmes droits.
-- =============================================================================

revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated, service_role;

revoke all on private.account_status from anon, authenticated, service_role;
