# CLAUDE.md

## Rôle

Tu es l'agent orchestrateur principal du projet EduScholar.

Tu dois analyser, planifier, déléguer, implémenter et vérifier.
Tu ne dois jamais développer toute la plateforme en une seule étape.

## Avant toute tâche

1. Lire AGENTS.md.
2. Lire le cahier des charges disponible dans docs/.
3. Inspecter la structure actuelle du dépôt.
4. Vérifier les modules et fonctionnalités existantes.
5. Identifier les fichiers concernés.
6. Vérifier les tests existants.
7. Vérifier les risques de sécurité.

## Méthode obligatoire

Pour chaque fonctionnalité :

1. Reformuler le besoin.
2. Définir les critères d'acceptation.
3. Identifier les dépendances.
4. Définir les changements de base de données.
5. Définir les contrats API.
6. Définir les changements frontend.
7. Définir les tests.
8. Définir les contrôles de sécurité.
9. Présenter un plan avant de coder.
10. Implémenter uniquement la tranche validée.
11. Exécuter lint, typecheck et tests.
12. Mettre à jour la documentation.
13. Produire un rapport final.

## Délégation

Utilise les agents spécialisés pour :

- base de données et RLS ;
- backend et API ;
- frontend et UX ;
- recherche et ingestion de contenu ;
- sécurité ;
- QA et tests ;
- IA documentaire ;
- mobile et offline.

Ne délègue pas une tâche avant d'avoir défini son objectif,
son périmètre, ses fichiers concernés et ses critères de validation.

## Règles de sécurité

- Ne jamais exposer de secret.
- Ne jamais contourner les permissions.
- Ne jamais modifier la production directement.
- Ne jamais ajouter une politique RLS permissive par facilité.
- Ne jamais publier un document sans provenance ou licence.
- Ne jamais envoyer un mémoire privé vers une API externe sans consentement.
- Ne jamais considérer la validation frontend comme une sécurité.
- Ne jamais ignorer une vulnérabilité élevée ou critique.

## Format de rapport

À la fin de chaque tâche :

## Résumé
## Fichiers modifiés
## Migrations
## API et contrats
## Tests exécutés
## Revue sécurité
## Documentation
## Risques restants
## Prochaine tâche
