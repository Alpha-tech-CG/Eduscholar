# Taxonomie pilote — filière informatique

**Date :** 6 octobre 2026
**Statut :** proposé — à valider par le porteur de projet
**Tâche :** B-06
**Références :** cahier §6.3, §6.4, §14, §19 ; ADR-0005

Cette taxonomie alimente les référentiels (classe A du modèle d'autorisation) : lecture
publique, modification par un administrateur de plateforme. Elle sera chargée par une
migration de données en B-12. Rien n'est codé en dur dans l'application.

## 1. Règles de conception

- Chaque entrée a un **code stable** en minuscules ASCII, jamais affiché ni traduit, et
  des **libellés** par langue stockés à part.
- Un code ne change jamais. Une entrée retirée est désactivée, pas supprimée.
- Les pays suivent ISO 3166-1 alpha-2, les langues BCP 47, les fuseaux IANA, les devises
  ISO 4217.
- Les niveaux d'études sont rattachés à la classification internationale CITE (ISCED),
  pour rester comparables d'un pays à l'autre.
- Les programmes officiels d'un pays sont versionnés par pays et par année (cahier §14.2) ;
  ils ne font pas partie du pilote.
- La hiérarchie est limitée à trois niveaux : domaine → filière → matière.

## 2. Langues

| Code | Libellé | Statut |
|---|---|---|
| `fr` | Français | Interface et contenu |
| `en` | English | Interface et contenu |
| `pt` | Português | Prévu, non activé |
| `ar` | العربية | Prévu, non activé ; écriture de droite à gauche |

La langue d'une ressource est celle du document, indépendante de la langue de l'interface.
D'autres langues de contenu peuvent être ajoutées sans traduire l'interface.

## 3. Pays

Le référentiel contient tous les pays ISO 3166-1. Le choix des **pays pilotes** reste à
faire par le porteur de projet : il conditionne l'analyse juridique (B-05), les
établissements proposés à l'inscription et la région d'hébergement.

## 4. Niveaux d'études

| Code | Français | English | CITE |
|---|---|---|---|
| `upper_secondary` | Lycée | Upper secondary | 3 |
| `short_cycle` | Cycle court (BTS, DUT, HND) | Short-cycle tertiary | 5 |
| `bachelor_1` | Licence 1 | Bachelor year 1 | 6 |
| `bachelor_2` | Licence 2 | Bachelor year 2 | 6 |
| `bachelor_3` | Licence 3 | Bachelor year 3 | 6 |
| `bachelor_4` | Licence 4 / année d'honneur | Bachelor year 4 / Honours | 6 |
| `master_1` | Master 1 | Master year 1 | 7 |
| `master_2` | Master 2 | Master year 2 | 7 |
| `doctorate` | Doctorat | Doctorate | 8 |
| `professional` | Formation professionnelle | Professional training | — |

`bachelor_4` couvre les systèmes anglophones en quatre ans. `upper_secondary` n'est
proposé à l'inscription que si l'accueil de mineurs est décidé (`minors-policy.md`).

## 5. Domaine et filière pilotes

| Niveau | Code | Français | English |
|---|---|---|---|
| Domaine | `sciences_technology` | Sciences et technologies | Science and technology |
| Filière | `computer_science` | Informatique | Computer science |

Spécialités de la filière, utilisées pour le profil et les projets de mémoire :

| Code | Français | English |
|---|---|---|
| `software_engineering` | Génie logiciel | Software engineering |
| `networks_systems` | Réseaux et systèmes | Networks and systems |
| `data_ai` | Données et intelligence artificielle | Data and artificial intelligence |
| `cybersecurity` | Cybersécurité | Cybersecurity |
| `information_systems` | Systèmes d'information | Information systems |
| `web_mobile` | Développement web et mobile | Web and mobile development |

## 6. Matières de la filière informatique

| Code | Français | English |
|---|---|---|
| `programming_fundamentals` | Bases de la programmation | Programming fundamentals |
| `algorithms` | Algorithmique | Algorithms |
| `data_structures` | Structures de données | Data structures |
| `object_oriented_programming` | Programmation orientée objet | Object-oriented programming |
| `discrete_mathematics` | Mathématiques discrètes | Discrete mathematics |
| `probability_statistics` | Probabilités et statistiques | Probability and statistics |
| `computer_architecture` | Architecture des ordinateurs | Computer architecture |
| `operating_systems` | Systèmes d'exploitation | Operating systems |
| `computer_networks` | Réseaux informatiques | Computer networks |
| `databases` | Bases de données | Databases |
| `software_engineering` | Génie logiciel | Software engineering |
| `web_development` | Développement web | Web development |
| `mobile_development` | Développement mobile | Mobile development |
| `formal_languages_compilers` | Langages formels et compilation | Formal languages and compilers |
| `theory_of_computation` | Calculabilité et complexité | Theory of computation |
| `artificial_intelligence` | Intelligence artificielle | Artificial intelligence |
| `machine_learning` | Apprentissage automatique | Machine learning |
| `data_science` | Science des données | Data science |
| `information_security` | Sécurité informatique | Information security |
| `cryptography` | Cryptographie | Cryptography |
| `distributed_systems` | Systèmes distribués | Distributed systems |
| `cloud_computing` | Informatique en nuage | Cloud computing |
| `human_computer_interaction` | Interaction homme-machine | Human-computer interaction |
| `computer_graphics` | Informatique graphique | Computer graphics |
| `embedded_systems` | Systèmes embarqués | Embedded systems |
| `information_systems` | Systèmes d'information | Information systems |
| `it_project_management` | Gestion de projet informatique | IT project management |
| `research_methodology` | Méthodologie de recherche | Research methodology |
| `ethics_law_computing` | Éthique et droit du numérique | Ethics and law in computing |

Une ressource peut porter plusieurs matières. Les mots-clés libres restent des tags,
distincts des matières.

## 7. Types de ressources du MVP

Le cahier §19 retient six types sur les quatorze du §6.4.

| Code | Français | English |
|---|---|---|
| `course` | Cours | Course |
| `article` | Article | Article |
| `book` | Livre | Book |
| `thesis` | Thèse ou mémoire | Thesis or dissertation |
| `video` | Vidéo | Video |
| `exercise` | Exercice | Exercise |

Prévus ensuite, codes réservés : `chapter`, `report`, `preprint`, `past_exam`,
`technical_documentation`, `dataset`, `presentation`.

Le cahier distingue thèse et mémoire ; ils sont regroupés pour le MVP avec un champ de
niveau du diplôme (`bachelor`, `master`, `doctorate`), ce qui permet de les séparer plus
tard sans migration de contenu.

## 8. Statuts

Repris tels quels du cahier §6.4. Ce sont des valeurs techniques, avec libellés traduits.

| Statut d'accès | Français | English |
|---|---|---|
| `open_access` | Accès ouvert | Open access |
| `free_link` | Lien gratuit | Free link |
| `preview_only` | Aperçu seulement | Preview only |
| `institutional_access` | Accès institutionnel | Institutional access |
| `paid` | Payant | Paid |
| `unknown` | Inconnu | Unknown |
| `removed` | Retiré | Removed |

| Statut éditorial | Français | English |
|---|---|---|
| `pending` | En attente | Pending |
| `under_review` | En cours d'examen | Under review |
| `verified` | Vérifié | Verified |
| `published` | Publié | Published |
| `rejected` | Rejeté | Rejected |
| `suspended` | Suspendu | Suspended |

## 9. Licences

Le référentiel des licences porte ce que chaque licence **permet à la plateforme**. Ces
quatre indicateurs pilotent l'interface (bouton de téléchargement, hébergement) et les
contraintes de publication.

| Code | Licence | Héberger le fichier | Redistribuer | Modifier | Usage commercial |
|---|---|---|---|---|---|
| `cc0-1.0` | CC0 1.0 | oui | oui | oui | oui |
| `public-domain` | Domaine public | oui | oui | oui | oui |
| `cc-by-4.0` | CC BY 4.0 | oui | oui | oui | oui |
| `cc-by-sa-4.0` | CC BY-SA 4.0 | oui | oui | oui, même licence | oui |
| `cc-by-nd-4.0` | CC BY-ND 4.0 | oui | oui, sans modification | non | oui |
| `cc-by-nc-4.0` | CC BY-NC 4.0 | à analyser | à analyser | oui | non |
| `cc-by-nc-sa-4.0` | CC BY-NC-SA 4.0 | à analyser | à analyser | oui, même licence | non |
| `cc-by-nc-nd-4.0` | CC BY-NC-ND 4.0 | à analyser | à analyser | non | non |
| `author-permission` | Autorisation écrite de l'ayant droit | selon l'autorisation | selon l'autorisation | selon l'autorisation | selon l'autorisation |
| `all-rights-reserved` | Tous droits réservés | non | non | non | non |
| `unknown` | Inconnue | non | non | non | non |

Règles :

- Toutes les licences Creative Commons exigent l'attribution : auteur, titre, source et
  licence sont affichés sur la fiche.
- Les versions antérieures (3.0, 2.0) sont enregistrées avec leur propre code lorsqu'elles
  se présentent ; elles ne sont pas assimilées à la version 4.0.
- Les licences non commerciales sont « à analyser » tant que le modèle économique n'est
  pas défini : une offre payante ou financée par la publicité peut les rendre inutilisables
  pour l'hébergement. En attendant, ces ressources sont référencées par lien uniquement.
- `unknown` et `all-rights-reserved` : lien vers la source officielle uniquement, jamais
  de fichier hébergé.
- `author-permission` exige une preuve conservée dans `resource_internal`.
- Ce tableau est une aide à la décision, pas un avis juridique ; il est à faire valider
  avec les politiques (B-05).

## 10. Hors périmètre du pilote

- Autres filières et domaines : ajoutés par données, sans changement de schéma.
- Référentiel des établissements : saisie libre et privée dans le profil pour le MVP ;
  un référentiel contrôlé viendra avec les organisations partenaires.
- Programmes officiels par pays.
