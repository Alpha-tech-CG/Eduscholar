# ADR-0014 — Catalogue public, sans compte

- Statut : proposé le 23 octobre 2026 (lot 1, accueil public et référencement) ; à
  valider par le porteur de projet
- Contexte de la décision : cahier §4.1 (visiteur), §6.1 (accueil et découverte), §13.1 ;
  modèle d'autorisation §5.1 ligne 3 ; complète l'ADR-0007 et l'ADR-0010
- Migrations : `20261006008300_public_catalogue.sql`, `20261006008310_public_catalogue_lint.sql`,
  `20261006008400_public_popularity.sql` (revue de sécurité) ; tests : `00_configuration`,
  `36_public_catalogue`, `tests/public-catalogue.test.ts`,
  `tests/integration/api-isolation.test.ts`, `e2e/public-catalogue.spec.ts`

## Contexte

Le cahier veut qu'un visiteur cherche des ressources publiques, consulte leurs fiches,
et que ces pages soient indexables. Jusqu'ici, la recherche et la fiche exigeaient un
compte au profil complété, et le rôle `anon` n'exécutait aucune fonction ni ne lisait
aucune table (test de configuration). Les référentiels eux-mêmes n'étaient lisibles que
par un compte actif.

## Décision

### Accès du visiteur : des fonctions dédiées, pas une politique RLS

Cinq fonctions de lecture, exécutables par `anon` seul :

| Fonction | Rend |
|---|---|
| `public_search_resources(payload)` | `{ items, total, capped }` : une page de vingt fiches |
| `public_resource(resource_id)` | une fiche, ou `null` |
| `public_home_sections()` | `{ recent, popular, institutional }`, six fiches chacune |
| `public_sitemap_resources()` | `[{ id, updated_at }]`, seize mille au plus |
| `public_reference_data()` | les référentiels, même forme que `reference_data()` |

- Enveloppe `security invoker` dans `public`, corps `security definer`, `stable`,
  `search_path = ''` dans `private`, comme le reste du dépôt. `anon` reçoit l'usage du
  schéma `private`, nécessaire pour atteindre ces corps, et aucun autre droit.
- **Le filtre est écrit dans la fonction** : `editorial_status = 'published'` et
  `visibility = 'public'`. En attente, en examen, à corriger, vérifiée, refusée,
  suspendue, retirée, réservée à une organisation : jamais rendue, jamais comptée. Une
  fiche suspendue disparaît à la lecture suivante, sans cache intermédiaire.
- **Colonnes** : une seule fonction de mise en forme (`private.public_resource_object`)
  liste ce qui sort : description, classement, DOI, lien officiel, licence, statut
  d'accès, origine, dates de vérification, de publication et de modification, badge.
  Jamais `submitted_by`, `organization_id`, `source_identifier`, `retrieved_at`,
  `edited_fields`, ni rien de `resource_internal`, de l'historique ou des signalements.
- **Aucune écriture** : toutes les fonctions sont `stable`. Aucune table n'est ouverte à
  `anon` ; aucune politique n'est ajoutée.
- `authenticated` et `service_role` ne les exécutent pas : un compte lit sous RLS, par
  ses propres fonctions, comme avant.

### Appel par le serveur, sans session

Le navigateur ne parle toujours qu'à Next.js (ADR-0007). Le serveur appelle ces
fonctions avec la clé publique, sans cookie (`createAnonymousClient`) quand la requête ne
porte pas de session. Avec une session, `/search` et `/resources/[id]` gardent leur
comportement : contrôle du profil, second facteur, RLS, actions.

### Limitation de débit

- **Application** : 300 recherches par cinq minutes et par adresse (`public-search`,
  `lib/auth/rate-limit.ts`), adresse lue comme pour l'authentification
  (`x-vercel-forwarded-for` sur Vercel, sinon `TRUSTED_CLIENT_IP_HEADER`, sinon une clé
  commune à tous les visiteurs). Large pour qu'un campus derrière une adresse ne se
  bloque pas ; la limite borne un robot.
- **Base** : pas de compteur. Toutes les requêtes du serveur y arrivent de la même
  adresse, et une limite globale laisserait n'importe qui fermer l'accueil à tous par un
  appel direct à l'API. La base borne le travail d'un appel : huit mots, vingt fiches
  par page, décompte plafonné à cinq mille, 250 pages, délai du rôle `anon` de trois
  secondes.
- Accueil et fiche, sans compte : 600 pages par cinq minutes et par adresse
  (`public-page`), un seul décompte par requête (métadonnées et page). Assez large pour
  un lecteur et pour un moteur de recherche, qui répartit ses visites sur de nombreuses
  adresses. Atteinte, la page s'affiche sans lecture du catalogue, avec un message.
- Plan du site : non limité, mais la liste des fiches est gardée cinq minutes
  (`unstable_cache`, `SITEMAP_REVALIDATE_SECONDS`) ; une erreur n'est pas gardée. Une
  fiche suspendue peut y rester jusqu'à cinq minutes ; sa page répond 404 aussitôt.
- Pertinence : au-delà de cinq mille fiches trouvées, le classement ne porte que sur
  cinq mille d'entre elles, prises sans ordre garanti (comme l'ADR-0010). Il est donc
  approximatif pour une recherche très large ; l'écran invite à la préciser.
- `robots.txt` ferme `/search` aux robots : ses pages sont en nombre infini, et le plan
  du site mène à chaque fiche.

### Popularité

Nombre de favoris par fiche, **jamais rendu**, recalculé **une fois par nuit** dans
`private.resource_popularity` (tâche `eduscholar-popularity`, pg_cron, rôle `postgres`),
illisible de tout rôle de l'API. Un favori n'est retenu que s'il vient d'un compte actif
(adresse confirmée, ni supprimé, ni banni, ni suspendu) **créé depuis au moins sept
jours** ; une fiche n'est classée qu'à partir de **trois** favoris retenus (seuil
d'effectif du modèle d'autorisation §5.5). Un lot de comptes neufs ne fait rien monter,
et l'ordre ne change pas dans l'instant qui suit un favori : il ne date aucun geste. La
fiche doit encore être publiée et publique à la lecture ; suspendue, elle sort aussitôt.
Aucune donnée nouvelle n'est collectée.

Écarté : un compteur de consultations. Il demanderait une écriture anonyme à chaque
page, donc une porte d'écriture ouverte à `anon`, et un dédoublonnage qui finit par
retenir une adresse ou un identifiant.

### Badge « institution vérifiée »

Fiche d'origine `organization`, rattachée à une organisation au statut `verified` au
moment de la lecture. Une organisation suspendue ou repassée à `pending` perd le badge
aussitôt. Le badge est un texte, pas une seule couleur.

### Fiche publique et référencement

- `generateMetadata` ne lit que `public_resource` : une fiche non publiée ou réservée ne
  laisse ni son titre ni son résumé dans les métadonnées, même pour un compte qui a le
  droit de la lire. Titre, description (résumé, à défaut auteurs et année), adresse
  canonique, versions `fr`, `en`, `pt` et `x-default`, Open Graph, `index, follow`.
- Données structurées schema.org (`ScholarlyArticle`, `Thesis`, `Book`, `Chapter`,
  `Report`, `Dataset`, `Course`…, `CreativeWork` à défaut). Rien n'est inventé : un champ
  absent de la fiche est absent du JSON-LD ; la licence n'est liée que pour les licences
  Creative Commons dont l'adresse est certaine. L'élément porte le nonce de la CSP ;
  `<`, `>` et `&` sont échappés. C'est la seule exception à la règle `react/no-danger`
  (M-17), justifiée dans le code : un enfant texte serait échappé en entités HTML que
  `<script>` ne décode pas.
- Inexistante, non publiée, réservée : 404, la même réponse.
- `app/sitemap.ts` : pages fixes (accueil, aide, pages juridiques) et fiches, chacune
  dans les trois langues avec ses alternatives. `app/robots.ts` : `/api/` et, dans chaque
  langue, compte, administration, modération, projets, bibliothèque, contributions,
  notifications, organisations, recommandations, invitations, partages, désabonnement,
  recherche et pages de connexion. Les deux lisent `APP_URL` à chaque demande
  (`force-dynamic`) : la construction ne dépend ni de la base ni de l'environnement.

### Référentiels

`public_reference_data` reprend la forme de `reference_data` sans exiger de compte
(référentiels : lecture publique, §5.1 ligne 1). Une session absente ou périmée lit la
fonction publique. Le test 36 compare les deux pour un compte actif : une évolution de
l'une sans l'autre le fait échouer.

## Conséquences

- Positif : le visiteur cherche, filtre par pays, niveau et filière, et ouvre des fiches
  indexables ; aucune table n'est ouverte, aucune écriture anonyme n'existe ; la liste
  des fonctions de `anon` est fermée et testée.
- Négatif : un appel direct à l'API avec la clé publique atteint ces fonctions sans la
  limite par adresse de l'application. Le contenu est public par nature ; le risque est
  la charge, bornée par appel. Si elle devient un problème : limite de débit devant
  l'API Supabase (réseau), ou passage de ces appels au rôle serveur et retrait du droit
  d'`anon`.
- Le corps de `reference_data` existe en deux exemplaires, tenus alignés par un test.
- La popularité a jusqu'à un jour de retard ; c'est voulu.
- Le plan du site s'arrête à seize mille fiches (cinquante mille adresses) ; au-delà,
  `generateSitemaps`.
- La recherche des comptes ne connaît ni le pays ni la filière : l'accueil n'offre ces
  deux filtres qu'aux visiteurs. Les ajouter à `search_resources` est une tâche à part.

## Écarté

- **Politique `select to anon` sur `resources`** : la RLS filtre des lignes, pas des
  colonnes ; il faudrait des droits par colonne tenus à jour à chaque ajout, et la
  table entière deviendrait une surface de requête (filtres, tri, imbrication) pour un
  appel direct.
- **Vue publique** : seconde porte de lecture à tenir alignée (déjà écartée par
  l'ADR-0010).
- **Rôle serveur pour les lectures publiques** : ferme l'appel direct, mais élargit
  l'usage d'une clé qui contourne la RLS à des lectures de page, contre la règle
  d'usage limité (§7.5).
- **Cache partagé des sections de l'accueil** : une fiche suspendue y resterait visible
  jusqu'à l'expiration, contre la règle de disparition immédiate.
