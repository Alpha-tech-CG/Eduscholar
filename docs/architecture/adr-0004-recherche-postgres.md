# ADR-0004 — Recherche plein texte PostgreSQL pour le MVP

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet)
**Tâche :** B-02

## Contexte

Le cahier (§9.3) prévoit un moteur de recherche séparé de la base transactionnelle. Le
MVP (§19) vise un catalogue limité et vérifié, sur une filière pilote, pas une indexation
massive.

## Décision

La recherche du MVP utilise la recherche plein texte de PostgreSQL (`tsvector`, index GIN),
avec des configurations distinctes pour le français et l’anglais, et des filtres SQL
indexés (filière, niveau, pays, langue, type, année, licence, statut d’accès).

## Règles

- Seules les ressources au statut éditorial `published` sont interrogeables publiquement, et la RLS l’impose.
- Aucun projet, brouillon, note ou commentaire privé n’entre dans une table ou une vue de recherche publique.
- Un changement de visibilité ou un retrait prend effet immédiatement, sans réindexation différée.
- Les requêtes sont paramétrées ; les opérateurs avancés sont limités ; pagination obligatoire.
- La recherche est exposée derrière une interface de service, pour pouvoir changer de moteur.

## Conséquences

- Positif : pas d’index externe à synchroniser, donc pas de risque de fuite par un index désynchronisé ; la RLS s’applique à la recherche.
- Négatif : pertinence, tolérance aux fautes et facettes plus limitées qu’un moteur dédié.

## Critère de révision

Passer à un moteur dédié lorsque le volume, les temps de réponse mesurés ou la qualité de
pertinence ne suffisent plus. L’index externe ne devra contenir que des ressources publiées.
