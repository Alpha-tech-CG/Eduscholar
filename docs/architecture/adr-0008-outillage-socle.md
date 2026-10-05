# ADR-0008 — Outillage du socle technique

**Date :** 6 octobre 2026
**Statut :** proposé — à valider par le porteur de projet
**Tâche :** B-08

## Contexte

Le socle technique fixe des choix d'outillage laissés ouverts par ADR-0001 à ADR-0007.

## Décisions

| Sujet | Choix | Raison |
|---|---|---|
| Versions | Next.js 16.3, React 19.2, TypeScript 5, Node.js 22 ou plus | Versions courantes à la date du socle |
| Styles | Tailwind CSS 4 | Fourni par le gabarit Next.js ; feuilles de style externes compatibles avec une CSP stricte ; propriétés logiques pour l'écriture de droite à gauche |
| Polices | Polices système | Aucun téléchargement : adapté aux connexions lentes, aucune requête vers un tiers |
| Tests unitaires | Vitest | Rapide, TypeScript natif |
| Tests de bout en bout | Playwright, contre le build de production, en format bureau et mobile | Vérifie les en-têtes réellement servis et les petits écrans |
| Qualité | ESLint (`eslint-config-next`), zéro avertissement toléré ; TypeScript strict avec `noUncheckedIndexedAccess` | Échec précoce |
| Secrets | Script `scripts/check-secrets.mjs` en pre-commit et en CI ; Gitleaks en CI sur tout l'historique | Deux barrières indépendantes |
| Bundle client | Script `scripts/check-client-bundle.mjs` après le build | Modèle de menaces M-13 |
| CI | GitHub Actions | Trois tâches : secrets, qualité, dépendances |

## CSP stricte avec nonce : conséquence sur le rendu

La politique de sécurité du contenu utilise un nonce par requête, sans `unsafe-inline` ni
`unsafe-eval`. Next.js n'applique un nonce qu'à une page **rendue dynamiquement**.

Conséquence : aucune page n'est générée statiquement ni mise en cache par le CDN. Chaque
affichage coûte un rendu serveur.

C'est acceptable pour le socle et les pages authentifiées, qui doivent de toute façon être
dynamiques et sans cache (M-51). Pour les pages publiques du catalogue, à fort trafic et
utiles au référencement, le choix sera réexaminé en B-16 : soit conserver le rendu
dynamique, soit une CSP à base d'empreintes pour ces seules pages.

## Règles de code imposées par le lint

- Aucun texte en dur dans un composant (`react/jsx-no-literals`) : ADR-0005.
- `next/link` interdit au profit du `Link` de `@/i18n/navigation`, qui conserve la langue.
- Import de `@supabase/*` interdit dans `src/` : il sera autorisé pour les seuls modules
  serveur dédiés, par exception nommée, en B-09 (ADR-0007).

## Écart connu : plugin next-intl

Le plugin officiel `next-intl/plugin` charge `@swc/core`, dont le module natif refuse de
s'installer sur le poste de développement (contrôle des permissions de son dossier de
cache sous Windows). Le plugin ne faisant, pour notre usage, que poser l'alias
`next-intl/config`, cet alias est posé directement dans `apps/web/next.config.ts`.

- Risque : une future version de next-intl peut changer ce mécanisme interne.
- Parade : les tests de bout en bout échouent si la traduction ne se charge plus ; à
  revérifier à chaque mise à jour de next-intl.
- Retour au plugin officiel dès que le problème du module natif est résolu.

## Vulnérabilités connues des dépendances

À la date du socle, `npm audit` signale 5 alertes de gravité élevée, toutes issues d'un
même avis (`braces`, GHSA-vfj7-8cjw-p6xm, déni de service sur des motifs imbriqués), tiré
par `eslint-config-next`. Aucune version corrigée n'existe.

- Il n'est présent que dans l'outillage de lint, jamais dans l'application livrée :
  `npm audit --omit=dev` ne signale rien.
- Il ne traite que les motifs de fichiers du dépôt, pas d'entrée d'utilisateur.

**Décision à valider par le porteur de projet** : exception temporaire, enregistrée dans
`security/audit-exceptions.json` avec sa justification et une expiration au 6 janvier 2027.

L'audit reste **bloquant** : `npm run check:audit` échoue sur tout avis élevé ou critique,
en production comme en développement, qui ne figure pas dans ce fichier, ainsi que sur
toute exception expirée. Une exception s'ajoute par une modification revue du fichier.

## Couverture de la CSP

- Le proxy s'applique à toutes les pages, y compris les chemins contenant un point (un
  DOI par exemple) et les requêtes annoncées comme préchargement. Seuls sont exclus
  `/api`, `/_next`, `/_vercel` et une liste fermée d'extensions de fichiers statiques.
- Les routes `/api/*` reçoivent une CSP de repli sans aucune source.
- `X-Frame-Options: DENY` double `frame-ancestors 'none'` : il protège les réponses qui
  ne portent pas de CSP (fichiers statiques, page 404 hors langue).
- HSTS est servi sans `preload` : l'inscription aux listes des navigateurs demandera une
  décision écrite après inventaire des sous-domaines.

## Revue de sécurité

L'agent sécurité a relu le socle : aucun constat critique ou élevé, 6 moyens et 6
faibles. Corrigés dans le socle : couverture du proxy, lecture du contenu indexé par le
contrôle de secrets, motifs de secrets étendus, contrôle du bundle (jetons décodés,
valeurs sentinelles en CI), audit bloquant avec exceptions datées, `persist-credentials`
et délais de la CI, activation automatique du pre-commit, CSP de repli de l'API, HSTS
sans `preload`, liens alternatifs désactivés, règles de lint `no-danger` et import
dynamique de Supabase.

Les corrections n'ont pas fait l'objet d'une seconde revue.

## Reste à faire, hors socle

| Sujet | Quand |
|---|---|
| Épingler les actions GitHub par empreinte de commit et l'image Gitleaks par condensat | À la création du dépôt distant |
| `CODEOWNERS` et protection de la branche `main` (une demande de fusion peut aujourd'hui modifier les contrôles qu'elle subit) | À la création du dépôt distant |
| Vérifier le premier passage réel de la CI, qui n'a jamais tourné | Au premier push |
| Contrôle CI des tables sans RLS et des fonctions exposées | B-09 |
| Contrôle du HTML rendu contre les valeurs sentinelles | B-09, avec le premier module serveur |
| Ne plus publier les traces Playwright en artefact dès qu'elles contiennent des sessions | B-10 |
| Limitation de débit et pare-feu applicatif | B-10 et hébergement |
| Prévisualisations reliées au seul staging (M-45) | À la liaison du projet Vercel |
| Journalisation structurée | Avec le premier code serveur métier |
| Service worker et mode hors ligne | Phase 5 |
| Interdire `git commit --no-verify` aux agents dans `.claude/settings.json` | Sur décision du porteur de projet |
