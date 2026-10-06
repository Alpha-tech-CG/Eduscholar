# Sources autorisées et conditions d'usage

**Date :** 6 octobre 2026
**Statut :** proposé — à valider par le porteur de projet
**Tâche :** B-06
**Références :** cahier §7 ; `content-and-licensing-policy.md` ; modèle de menaces M-25, M-26

Seules les sources de la liste A peuvent être intégrées par un connecteur. Une source
passe d'une liste à l'autre par une modification de ce document, après vérification de
ses conditions sur sa page officielle, avec la date de vérification.

## Règles communes à tout connecteur

1. Ne récupérer que des **métadonnées** et le lien officiel. Aucun fichier n'est copié
   sur la plateforme par un connecteur.
2. La licence de la **métadonnée** n'est pas la licence du **document**. Une métadonnée
   en CC0 peut décrire un article sous droits réservés. La licence du document est lue
   dans le champ fourni par la source ; à défaut elle vaut `unknown`.
3. Le statut d'accès (`open_access`, `free_link`, etc.) est distinct de la licence.
4. Chaque enregistrement conserve la source, l'identifiant dans la source, la date de
   récupération et la date de dernière vérification du lien.
5. Un import aboutit au statut `pending` au plus. Rien n'est publié sans modération.
6. Un champ absent reste vide. Aucun auteur, DOI, date ou licence n'est déduit ou complété.
7. Respect des limites de débit publiées, mise en cache, reprise avec temporisation.
8. Les clés d'API sont des secrets serveur. Les conditions de chaque source sont
   revérifiées au moins une fois par an et avant tout changement de volume.

## Liste A — sources retenues pour le pilote

Conditions vérifiées le 6 octobre 2026 par recherche sur les pages publiques des sources.
À confirmer sur le texte officiel au moment d'écrire chaque connecteur (B-15).

| Source | Ce qu'elle apporte | Licence des métadonnées | Accès | Points d'attention |
|---|---|---|---|---|
| **OpenAlex** | Articles, auteurs, institutions, sujets, statut d'accès ouvert, lien vers le texte | CC0 | Clé d'API obligatoire depuis 2026, gratuite ; tarification à l'usage au-delà d'un quota quotidien gratuit ; recherche par identifiant ou DOI gratuite ; instantané complet téléchargeable sans clé | Coût : privilégier l'instantané ou les recherches par DOI ; plafonner le budget ; 100 requêtes par seconde au plus |
| **Crossref** | Métadonnées de référence par DOI : titre, auteurs, revue, date, licence déclarée | Presque aucune métadonnée soumise au droit d'auteur ; réutilisation libre | Sans clé ; accès « poli » en fournissant une adresse de contact | Limites révisées le 1er décembre 2025 : 10 requêtes par seconde par DOI et 3 pour les listes en accès poli ; mise en cache attendue |
| **DOAJ** | Revues en accès ouvert vérifiées et leurs articles ; licence de la revue | CC0 pour les revues et les articles | API, OAI-PMH et export complet | Bon signal de fiabilité pour le score de qualité |

Usage prévu pour le MVP :

- **Crossref** pour résoudre un DOI saisi par un utilisateur (import de référence, cahier §6.10) ;
- **OpenAlex** pour alimenter le catalogue pilote en informatique et connaître le statut d'accès ;
- **DOAJ** pour confirmer qu'une revue est en accès ouvert et sous quelle licence.

Connecteurs écrits :

| Source | Date | Usage | Vérification |
|---|---|---|---|
| Crossref | 6 octobre 2026 | Résolution d'un DOI à la demande d'un modérateur ; une requête par import ; adresse de contact transmise si `CROSSREF_MAILTO` est définie | Page « Tips for using the Crossref REST API » relue ce jour : usage responsable, mise en cache, arrêt sur réponse `429`, fichiers publics pour les gros volumes. Le connecteur ne fait aucun moissonnage et ne relance pas après un refus. |

## Liste B — sources sous condition

| Source | Intérêt | Condition avant intégration |
|---|---|---|
| **CORE** | Texte intégral et métadonnées de dépôts institutionnels | Une licence est requise pour l'API ; un produit susceptible d'être monétisé, maintenant ou plus tard, doit contacter CORE. Débit sans inscription : cinq requêtes simples par dix secondes. **À négocier avant tout usage**, compte tenu du modèle économique à définir. |
| **Dépôts institutionnels partenaires** | Mémoires et thèses d'universités africaines (cahier §3.1) | Accord écrit avec l'établissement, précisant les champs, l'hébergement éventuel et le retrait. Moissonnage OAI-PMH seulement si l'établissement l'autorise. |
| **Contributions d'utilisateurs** | Cours, fiches, mémoires autorisés | Déclaration de droits et licence choisie par le contributeur, puis modération (voir `content-and-licensing-policy.md`). |

## Liste C — candidates, conditions non vérifiées

Ces sources sont pertinentes pour le cahier, mais leurs conditions actuelles n'ont **pas**
été vérifiées. Aucune ne peut être intégrée avant vérification et passage en liste A ou B.

| Source | Type de contenu | À vérifier |
|---|---|---|
| arXiv | Prépublications, forte couverture en informatique | Conditions de l'API, licence par article |
| HAL | Archive ouverte francophone | Conditions de l'API, licence par dépôt |
| Unpaywall | Localisation d'une version en accès ouvert d'un DOI | Conditions et limites de l'API |
| theses.fr | Thèses soutenues en France | Licence des données |
| DOAB et OAPEN | Livres en accès ouvert | Licence des métadonnées, licence par livre |
| OpenStax | Manuels universitaires ouverts | Licence par ouvrage, conditions de redistribution |
| MIT OpenCourseWare | Cours | Licence non commerciale probable : incompatible avec une offre payante sans analyse |
| Zenodo | Jeux de données, rapports | Licence par dépôt |
| African Journals Online (AJOL) | Revues africaines | Existence d'un accès programmatique, conditions |
| Plateformes vidéo | Cours filmés | Intégration par lecteur embarqué seulement ; conditions de l'API |

## Sources exclues

- Tout site dont les conditions interdisent la collecte automatisée.
- Toute bibliothèque « pirate » ou tout site diffusant des œuvres sans autorisation.
- Tout contenu derrière une authentification, un paiement ou une mesure technique.
- Toute collecte par extraction de pages lorsqu'une API ou un accord n'existe pas.

## Questions ouvertes

| # | Question | Effet |
|---|---|---|
| 1 | Modèle économique (gratuit, payant, institutionnel) | Décide de l'usage possible des contenus sous licence non commerciale et des sources de la liste B |
| 2 | Budget mensuel pour OpenAlex | Détermine le choix entre API et instantané |
| 3 | Premiers établissements partenaires | Lance les accords de la liste B |

## Sources des vérifications

- OpenAlex : https://developers.openalex.org/api-reference/authentication et https://blog.openalex.org/?p=3953
- Crossref : https://crossref.org/blog/announcing-changes-to-rest-api-rate-limits/ et https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/
- DOAJ : https://www.doaj.org/terms/
- CORE : https://core.ac.uk/terms et https://core.ac.uk/services/api
