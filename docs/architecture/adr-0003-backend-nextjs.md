# ADR-0003 — Backend dans Next.js pour le MVP

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet)
**Tâche :** B-02

## Contexte

Le cahier (§9.2) décrit une `apps/api` versionnée avec services métier, connecteurs et
file de tâches. Avec Supabase (ADR-0001), l’authentification, le stockage et la barrière
d’autorisation sont déjà fournis. Une API séparée dès le départ doublerait le déploiement.

## Décision

Pour le MVP, la logique serveur vit dans `apps/web` : Route Handlers pour les contrats
HTTP, Server Actions pour les mutations issues de l’interface. Pas d’`apps/api`.

## Règles

- Toute entrée est validée côté serveur par un schéma strict, partagé avec le client.
- L’identité vient de la session vérifiée côté serveur, jamais d’un identifiant transmis par le client.
- Les Route Handlers publics sont versionnés sous `/api/v1/`.
- Une Server Action est un point d’entrée public : mêmes contrôles qu’un endpoint.
- La logique métier est placée dans des modules de service indépendants de Next.js, pour pouvoir être extraite.
- Listes paginées, taille de requête bornée, limitation de débit sur les endpoints sensibles.

## Conséquences

- Positif : un seul déploiement, types de bout en bout, moins de surface à sécuriser.
- Négatif : les traitements longs (import, OCR, export) ne tiennent pas dans une requête ; ils demanderont une file de tâches.

## Critère de révision

Extraire une `apps/api` ou des workers lorsque les connecteurs (B-15), l’application
mobile ou des traitements longs l’exigent. La décision sur la file de tâches sera prise
à ce moment par un ADR dédié.
