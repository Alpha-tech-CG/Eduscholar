# Politique de confidentialité — brouillon

**Date :** 6 octobre 2026
**Statut :** BROUILLON DE TRAVAIL — **à valider juridiquement avant toute ouverture au public**
**Tâche :** B-05
**Références :** cahier §6.2, §12.4, §13.3, §15 ; `authorization-model.md`

> Ce document décrit les engagements que le produit est conçu pour tenir. Ce n'est pas
> un texte juridique : il doit être repris par un juriste, adapté au droit de chaque pays
> pilote, puis traduit. Les mentions `[À COMPLÉTER]` attendent une décision.

## 1. Qui est responsable

- Responsable du traitement : `[À COMPLÉTER : entité juridique, adresse]`
- Contact pour la protection des données : `[À COMPLÉTER : adresse de contact]`
- Autorité de contrôle compétente : `[À COMPLÉTER selon les pays pilotes]`

## 2. Principes

1. Nous collectons le minimum nécessaire au service.
2. Vos travaux — projets, brouillons, notes, fiches de lecture — sont privés. Personne
   d'autre que vous n'y accède sans un partage que vous avez fait vous-même.
3. Votre profil n'est pas public. Vous choisissez ce que vous rendez visible.
4. Nous ne vendons pas vos données et ne les utilisons pas pour de la publicité ciblée.
5. Vos travaux ne servent pas à entraîner des modèles d'intelligence artificielle.
6. Aucun document privé n'est envoyé à un service externe d'intelligence artificielle
   sans votre accord explicite, projet par projet.

## 3. Données collectées

| Catégorie | Données | Pourquoi | Obligatoire |
|---|---|---|---|
| Compte | Adresse électronique, mot de passe (stocké haché par le fournisseur d'authentification), second facteur le cas échéant | Vous identifier et protéger le compte | Oui |
| Profil académique | Pays, niveau, filière, spécialité, langue préférée | Adapter la recherche et les suggestions | Pays, niveau et filière |
| Profil complémentaire | Établissement, matières suivies, objectifs, nom d'affichage | Personnaliser ; vous identifier auprès d'un encadreur | Non |
| Bibliothèque | Favoris, collections, notes, annotations, historique de consultation | Le service lui-même | Non |
| Travaux | Projets, sections, versions, fiches de lecture, citations, fichiers joints | Le service lui-même | Non |
| Collaboration | Invitations, commentaires, tâches, décisions de l'encadreur | Le suivi du mémoire | Non |
| Contributions | Ressources soumises, licence déclarée, signalements | Constituer et modérer le catalogue | Non |
| Sécurité | Journal des connexions et des actions sensibles, adresse IP, type d'appareil | Détecter les abus, enquêter sur un incident | Oui |
| Mesure d'usage | Statistiques agrégées, sans identification individuelle | Améliorer le produit | Non |

Nous ne collectons pas : données de santé, opinions, religion, origine, données
biométriques, géolocalisation précise, carnet d'adresses.

## 4. Ce qui est visible, et par qui

| Donnée | Visible par |
|---|---|
| Profil | Vous seul, sauf les champs que vous publiez |
| Nom d'affichage | Les personnes avec qui vous partagez un projet |
| Bibliothèque, notes, historique | Vous seul |
| Projet de recherche | Vous, et les personnes que vous avez invitées, dans la limite que vous fixez |
| Ressource que vous soumettez | Les modérateurs, puis le public si elle est publiée |
| Signalement | Les modérateurs ; l'organisation visée ne voit pas votre identité |

Les administrateurs de la plateforme, les modérateurs et les administrateurs de votre
établissement **n'ont pas accès** à vos projets, notes et fichiers privés. Votre
établissement ne voit que des statistiques agrégées, au-dessus d'un effectif minimal.

Limite à connaître : les personnes qui administrent techniquement l'infrastructure
d'hébergement disposent d'un accès à la base de données. Cet accès est restreint à un
nombre minimal de personnes, protégé et tracé. `[À PRÉCISER avec le juriste : procédure
d'accès exceptionnel en cas d'incident ou de réquisition légale.]`

## 5. Assistance automatisée

- Les fonctions d'assistance sont facultatives et signalées comme telles.
- Un projet n'est transmis à un fournisseur externe que si vous avez activé cette option
  pour ce projet. Vous pouvez la retirer à tout moment.
- Un mode sans traitement externe existe pour les projets confidentiels.
- Détail : `ai-consent-policy.md`.

## 6. Sous-traitants

| Rôle | Fournisseur | Lieu de traitement |
|---|---|---|
| Hébergement de l'application | Vercel | `[À COMPLÉTER : région]` |
| Base de données, authentification, fichiers | Supabase | `[À COMPLÉTER : région]` |
| Envoi des courriels | `[À CHOISIR]` | `[À COMPLÉTER]` |
| Assistance automatisée | `[À CHOISIR]` | `[À COMPLÉTER]` |

`[À TRAITER par le juriste : transferts internationaux de données, accords de
sous-traitance, obligations de localisation des pays pilotes.]`

## 7. Durées de conservation

Propositions, à confirmer.

| Donnée | Durée proposée |
|---|---|
| Compte et profil | Tant que le compte existe |
| Travaux et bibliothèque | Tant que le compte existe ; un projet supprimé est purgé après 30 jours |
| Compte inactif | Avertissement après 24 mois, suppression 3 mois plus tard `[À CONFIRMER]` |
| Journal de sécurité | 12 mois `[À CONFIRMER selon les obligations légales]` |
| Sauvegardes | 30 à 90 jours après la suppression `[À CONFIRMER]` |
| Décisions de modération et demandes de retrait | 5 ans, comme preuve `[À CONFIRMER]` |

## 8. Vos droits

Depuis votre compte ou en nous écrivant, vous pouvez :

- accéder à vos données et en obtenir une copie dans un format réutilisable : depuis
  « Mon compte », après avoir saisi votre mot de passe. La copie contient votre profil,
  votre bibliothèque, vos projets de recherche, vos propositions et vos signalements.
  Elle ne contient pas les projets supprimés en attente d'effacement ni le journal de
  sécurité de votre compte, que vous pouvez nous demander. Chaque copie est notée dans
  ce journal ;
- corriger votre profil ;
- supprimer un projet, une note, ou votre compte entier ;
- retirer un consentement (assistance automatisée, visibilité du profil, publication) ;
- vous opposer à un traitement ou en demander la limitation.

Effets d'une suppression de compte : vos données privées sont effacées. Une ressource que
vous avez publiée dans le catalogue peut y rester, selon la licence que vous lui avez
donnée, ou être retirée à votre demande. Le journal de sécurité est conservé sous une
forme qui ne vous identifie plus directement.

Délai de réponse : `[À COMPLÉTER selon la loi applicable]`.

## 9. Sécurité

- Chiffrement des échanges et des données stockées.
- Contrôle d'accès appliqué au niveau de la base de données elle-même.
- Fichiers privés accessibles uniquement par des liens temporaires.
- Second facteur d'authentification obligatoire pour les comptes à privilèges ; des
  codes de secours, dont seule une empreinte est conservée, permettent de retrouver
  l'accès à son compte.
- Journal des actions sensibles, non modifiable.
- Sauvegardes chiffrées, restauration testée.

En cas de violation de données vous concernant, nous vous informons ainsi que l'autorité
compétente, dans les délais légaux `[À COMPLÉTER]`.

## 10. Mineurs

Voir `minors-policy.md`. Tant que la décision d'accueillir des mineurs n'est pas prise,
l'inscription est réservée aux personnes majeures selon la loi de leur pays.

## 11. Cookies

- Cookies strictement nécessaires : session et sécurité. Ils ne demandent pas de consentement.
- Mesure d'usage : sans identification individuelle et sans partage avec des tiers.
- Aucun cookie publicitaire.

`[À CONFIRMER par le juriste selon l'outil de mesure choisi.]`

## 12. Modification de cette politique

Toute modification importante est annoncée dans l'application avant son entrée en vigueur.

## Points à traiter par le juriste

1. Droit applicable dans chaque pays pilote et autorité compétente.
2. Base légale de chaque traitement.
3. Transferts internationaux et choix de la région d'hébergement.
4. Durées de conservation.
5. Procédure d'accès exceptionnel et de réponse aux réquisitions.
6. Âge du consentement numérique par pays.
7. Désignation éventuelle d'un délégué ou d'un représentant local.
