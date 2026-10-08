# ADR-0013 — Une assistance documentaire déterministe, sans modèle de langage

- Statut : accepté le 8 octobre 2026 (délégation du porteur de projet)
- Contexte de la décision : Phase 6 du cahier des charges (§8, §13, feuille de route)

## Contexte

Le cahier prévoit une « intelligence documentaire » : classification assistée, résumés
sourcés, contrôles de cohérence, alertes de lacunes et de doublons, recommandations —
« toujours avec validation humaine ». Il interdit d'inventer une source, un auteur, un
DOI ou une citation, et d'envoyer un mémoire privé à un service externe sans
consentement.

## Décision

Tout ce qui peut se calculer sans modèle de langage se calcule dans la base, par des
fonctions de lecture déterministes. Rien ne sort de la plateforme.

- **Doublons** d'une fiche (modération) : même DOI, même lien, ou titre très proche avec
  la même année ou un auteur commun.
- **Classification assistée** (modération) : matières de la filière dont le libellé
  partage des mots avec le titre, le résumé ou les mots-clés de la fiche. Aucun niveau
  d'étude n'est suggéré : rien, dans une fiche, ne l'appuie de façon fiable.
- **Cohérence d'un projet** (propriétaire, membre à accès complet) : quinze constats de
  forme — plan, citations, sources, échéances, lacunes de la littérature. Ce qui tient
  aux fiches de lecture, privées, n'est dit qu'au propriétaire.
- **Recommandations** : fiches publiées et publiques choisies d'après le seul profil et
  le seul projet de l'appelant.

Règles communes :

- **Une suggestion, jamais une action.** Aucune fonction ne modifie quoi que ce soit :
  la personne applique elle-même, par les formulaires existants.
- **Chaque résultat dit sur quoi il s'appuie** : identifiant de la ligne réelle, mots qui
  ont correspondu, raison codée, et un indice de confiance dont la règle est écrite.
  Aucun identifiant, auteur ou titre ne peut venir d'ailleurs que d'une ligne existante.
- **Aucun texte de mémoire ne sort** : le rapport de cohérence rend des identifiants, des
  titres de section et des nombres.
- **Aucun signal tiré d'autrui** : pas de « ceux qui ont lu… ». Les recommandations d'une
  personne ne dépendent que de ses propres données ; elles ne révèlent rien de personne.
- **Rien n'est mémorisé** : ni profil d'intérêt, ni journal de ce qui a été recommandé.

## Écarté, pour l'instant : les résumés générés

Un résumé sourcé demande un modèle de langage, donc un fournisseur externe ou un modèle
hébergé. Avant cela, il faut : le choix du fournisseur et de son coût ; le consentement
explicite, par projet, déjà prévu au modèle d'autorisation ; la garantie qu'aucun texte de
mémoire ne part sans cet accord ; la conservation, avec chaque résumé, des identifiants
des sources et des passages utilisés ; la phrase de refus exigée par le cahier quand
aucune source ne permet de répondre. C'est une décision du porteur de projet (tâche
G-05), pas un détail de mise en œuvre.

## Conséquences

- Des suggestions simples : elles relèvent ce qui se voit, pas ce qui se comprend. Un mot
  commun rapproche, un synonyme non.
- Les textes à l'écran disent que ce sont des contrôles automatiques de forme, à
  vérifier, et non une évaluation du travail.
- Deux index sur les fiches dépendent de fonctions de normalisation de texte : après une
  montée de version de PostgreSQL ou de l'extension `unaccent`, réindexer
  `resources_title_trgm_idx` et `resources_normalized_url_idx`.
- Coût mesuré pour les doublons seulement (environ 40 ms sur 2 800 fiches) ; les trois
  autres fonctions restent à mesurer au volume cible.
