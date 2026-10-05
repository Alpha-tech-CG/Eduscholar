# ADR-0006 — Hébergement Vercel et Supabase

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet)
**Tâche :** B-02

## Contexte

Le cahier (§9.4) exige des environnements séparés, une CI/CD avec revue, des secrets dans
un gestionnaire, un CDN, une protection contre les abus et des sauvegardes.

## Décision

- Application web sur Vercel.
- PostgreSQL, authentification et stockage sur Supabase hébergé.

## Environnements

| Environnement | Web | Données |
|---|---|---|
| local | `next dev` | Supabase local (CLI) |
| test | CI | Supabase local dans la CI |
| staging | Vercel preview | Projet Supabase de staging |
| production | Vercel production | Projet Supabase de production |

## Règles

- Les secrets vivent dans les variables d’environnement Vercel et Supabase, jamais dans le dépôt.
- Aucun identifiant de production sur un poste de développement ni dans une session d’agent.
- La production n’est déployée que depuis `main`, après revue et CI verte ; aucun déploiement de production par un agent.
- Les migrations sont appliquées à la production par la CI, jamais à la main.
- Aucune donnée de production dans les autres environnements.
- La région d’hébergement des données sera choisie avec l’analyse juridique (B-05).

## Conséquences

- Positif : prévisualisation par branche, CDN et pare-feu inclus, sauvegardes gérées.
- Négatif : dépendance à deux fournisseurs ; la restauration des sauvegardes doit être testée (critère du MVP §20).

## Points ouverts

- Région des données et obligations de localisation selon les pays pilotes.
- Offre Supabase nécessaire pour la restauration à un instant donné.
