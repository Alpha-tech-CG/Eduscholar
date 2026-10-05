# AGENTS.md

## Projet

EduScholar est une plateforme mondiale de recherche académique,
de bibliothèque numérique et d'accompagnement à la rédaction.

## Règles obligatoires

1. Lire le cahier des charges avant toute modification.
2. Inspecter le code existant avant de créer un nouveau module.
3. Ne jamais réécrire toute l'application sans audit préalable.
4. Ne jamais mettre de secret dans le dépôt.
5. Ne jamais faire confiance aux données envoyées par le frontend.
6. Toute autorisation doit être vérifiée côté backend.
7. Toute modification de base de données doit passer par une migration.
8. Toute fonctionnalité doit avoir des tests.
9. Toute donnée privée doit être protégée par des permissions explicites.
10. Ne jamais indexer les projets privés dans la recherche publique.
11. Ne jamais inventer de source, citation, auteur ou DOI.
12. Ne jamais envoyer un document privé à un fournisseur IA sans consentement.
13. Toute modification critique doit être revue par l'agent sécurité.
14. Ne jamais supprimer une donnée de production directement.
15. Préserver le support français et anglais.
16. Prévoir les petits écrans et les connexions faibles.

## Règles de base de données

- Toutes les tables privées doivent disposer de politiques d'accès.
- Les migrations doivent être versionnées.
- Les contraintes, index et relations doivent être documentés.
- Les tests d'isolation entre utilisateurs et organisations sont obligatoires.
- Les projets de recherche sont privés par défaut.

## Règles de fin de tâche

Tout agent doit fournir :

- les fichiers modifiés ;
- les migrations créées ;
- les tests exécutés ;
- les décisions prises ;
- les risques de sécurité ;
- les problèmes restants ;
- la prochaine action recommandée.
