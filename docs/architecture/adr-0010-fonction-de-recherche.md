# ADR-0010 — Recherche du catalogue par une fonction dédiée

- Statut : accepté le 8 octobre 2026 (délégation du porteur de projet)
- Contexte de la décision : dette D-21 ; complète l'ADR-0004

## Contexte

La recherche lisait la table `resources` par l'API, sous la session de l'utilisateur.
Sous RLS, PostgreSQL n'utilise pas l'index plein texte pour une telle requête :
l'opérateur de recherche n'est pas « leakproof », et le planificateur applique d'abord
la politique à chaque fiche. Chaque recherche parcourait donc le catalogue, et le
décompte exact des résultats le parcourait une seconde fois. Les résultats n'étaient pas
classés par pertinence.

## Décision

La recherche passe par une fonction de la base, `search_resources`, exécutée avec les
droits de son propriétaire.

- **Elle ne connaît que les fiches publiées et publiques**, celles que tout compte actif
  lit déjà. Le filtre est écrit dans la fonction, pas déduit de l'appelant : elle ne peut
  rien révéler d'une fiche en attente, réservée, suspendue ou retirée.
- **Elle ne rend que des identifiants**, avec le décompte. Le contenu des fiches reste lu
  par l'application sous la session de l'utilisateur, où la RLS décide comme avant. Une
  fiche dépubliée entre les deux lectures disparaît simplement de la page.
- **Classement** : par pertinence quand des mots sont cherchés, puis par date de
  publication ; par date seule sinon.
- **Décompte plafonné à cinq mille.** Au-delà, la fonction le dit, et l'écran invite à
  préciser la recherche. Deux cent cinquante pages de vingt au plus.
- **Mots** : huit au plus, quarante caractères chacun, sans espace ni ponctuation ; cités
  un par un dans la requête. À partir de trois lettres, un mot est cherché par son début ;
  plus court, il est cherché tel quel.
- **Filtres** : une valeur absente du référentiel rend une page vide sans rien parcourir.
- **Débit** : deux cents recherches par cinq minutes et par compte, tenues par la
  fonction. Un appel direct à l'API n'y échappe pas (dette D-15, pour cette lecture).
- **Index** : l'index plein texte ne couvre plus que les fiches publiées et publiques ;
  un index par date de publication sert le parcours sans mot.

## Ce qui change pour l'utilisateur

Rien dans le périmètre : la recherche ne montrait déjà que des fiches publiées et
publiques. Les fiches réservées à une organisation et ses propres soumissions en attente
n'y figurent pas, comme avant ; elles se lisent sur leurs écrans.

## Mesure

Le 8 octobre 2026, base locale, 200 000 fiches publiées de synthèse :

| Recherche | Durée |
|---|---|
| Un mot fréquent (20 000 fiches trouvées), avec classement et décompte | 48 ms |
| Trois mots (une cinquantaine de fiches) | 35 ms |
| Sans mot, filtre de langue | 6 ms |
| Pour comparaison, le seul décompte exact de l'ancienne lecture sous RLS | 160 ms |

Mesures refaites après les corrections de revue ; le plan montre l'usage de l'index
partiel `resources_public_search_idx`.

## Écarté

- **Marquer l'opérateur « leakproof »** : demande des droits de super-utilisateur, que
  l'hébergement n'accorde pas, et affirmerait une propriété qu'on ne peut pas garantir.
- **Une vue des fiches publiques sans RLS** : expose une seconde porte de lecture, à
  tenir alignée sur la politique ; la fonction ne rend que des identifiants.
- **Un moteur de recherche dédié** : reste l'option de l'ADR-0004 si le volume ou la
  pertinence le demandent.
- **Un délai d'exécution propre à la fonction** : un réglage posé sur une fonction ne
  borne pas la requête qui l'appelle. Le délai du rôle (huit secondes) reste la borne.

## Conséquences

- La file de modération cherche toujours sous RLS, sans index : elle est courte.
- Le classement tient à `ts_rank` sur une configuration sans analyse linguistique : un
  mot du titre pèse plus qu'un mot du résumé, rien de plus fin.
- Au-delà de cinq mille fiches trouvées, le classement porte sur cinq mille d'entre
  elles, prises sans ordre garanti.
- Les mots cherchés figurent toujours dans l'adresse de la page, donc dans les journaux
  d'accès de l'hébergeur. Durée de conservation à régler au déploiement : trente jours
  au plus. Le journal d'audit de l'application, lui, ne les contient pas.
