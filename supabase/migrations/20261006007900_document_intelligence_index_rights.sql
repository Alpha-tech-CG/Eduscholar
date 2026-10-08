-- =============================================================================
-- Phase 6 : le rôle serveur doit pouvoir écrire une fiche malgré les nouveaux index
-- =============================================================================
-- Défaut de la migration 007800, relevé par les tests existants du catalogue
-- (05 et 07) : les deux index posés sur `resources` — titre normalisé, lien
-- normalisé — sont calculés à chaque écriture d'une fiche, sous le rôle qui
-- écrit. Or le rôle serveur écrit des fiches (import par connecteur), et les
-- deux fonctions d'index lui étaient fermées : toute insertion échouait par
-- « permission denied for function fold_text ».
--
-- Le rôle serveur reçoit donc l'exécution de ces deux fonctions, et d'elles
-- seules. Elles sont pures : un texte en entrée, un texte en sortie, aucune
-- lecture de table, aucun droit particulier (`security invoker`). Elles ne
-- donnent accès à rien. Les comptes connectés n'en ont pas besoin : ils
-- n'écrivent jamais directement dans `resources`, et les fonctions qui le font
-- pour eux s'exécutent sous le propriétaire de la base.
--
-- Réversibilité : retirer ces deux droits, après avoir supprimé les index
-- `resources_title_trgm_idx` et `resources_normalized_url_idx`.
-- =============================================================================

grant execute on function private.fold_text(text) to service_role;
grant execute on function private.normalize_url(text) to service_role;
