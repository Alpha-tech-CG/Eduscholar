# Authentification

**Mise à jour :** 6 octobre 2026 (B-10)
**Références :** ADR-0003, ADR-0007 ; modèle de menaces M-01 à M-06, M-47 à M-53, M-57 à M-59

## Principes

1. Le navigateur ne parle qu'à l'application. Il n'a ni client Supabase, ni jeton lisible.
2. La session est dans un cookie `HttpOnly`, `Secure`, `SameSite=Lax`, nommé avec le
   préfixe `__Host-` en production : il est réservé à l'hôte exact de l'application.
3. Le proxy rafraîchit la session et ne protège rien. Chaque page protégée appelle
   `requireUser()` ; chaque action vérifie elle-même l'identité.
4. L'identité est vérifiée auprès du service d'authentification (`getUser()`), pas lue
   dans le cookie.
5. Les actions ne renvoient que des codes. Aucun message ne distingue un compte inconnu
   d'un mauvais mot de passe, ni une adresse déjà inscrite d'une adresse nouvelle.
6. Aucune modification par GET : un lien reçu par courriel mène à une page, et c'est un
   bouton qui consomme le jeton.

## Parcours

| Parcours | Déroulement |
|---|---|
| Inscription | Formulaire (adresse, mot de passe, déclaration d'âge) → courriel → page de confirmation → bouton → **page de connexion** |
| Connexion | Adresse et mot de passe → page demandée, si elle est interne, sinon le compte |
| Déconnexion | Bouton (POST) → la session est révoquée côté service, pas seulement effacée |
| Mot de passe oublié | Adresse → courriel → page de confirmation → bouton → nouveau mot de passe → toutes les sessions sont fermées → page de connexion |

Pages : `/sign-up`, `/sign-in`, `/forgot-password`, `/reset-password`, `/auth/confirm`,
`/account`, sous `/fr` et `/en`. Les pages d'authentification ne sont pas indexées.

## Décisions de sécurité

### La confirmation d'une adresse n'ouvre pas de session

Le service d'authentification conserve le mot de passe d'une première inscription non
confirmée. Un tiers peut donc inscrire l'adresse d'une personne avec son propre mot de
passe, puis attendre qu'elle s'inscrive et confirme. Si la confirmation la connectait,
elle ne remarquerait rien, et le tiers garderait un accès durable au compte.

Ici, la confirmation renvoie à la page de connexion. Le mot de passe de la personne est
alors refusé ; elle passe par « mot de passe oublié », ce qui remplace celui du tiers et
ferme toutes les sessions. Ce cas a été reproduit sur l'instance locale et est couvert
par un test de bout en bout.

### Un lien ne remplace jamais une session ouverte

Si une personne connectée ouvre un lien de confirmation, la page affiche le compte en
cours et demande de se déconnecter d'abord. Un lien envoyé par un tiers ne peut donc pas
la faire basculer sur un autre compte à son insu. La page de nouveau mot de passe affiche
l'adresse du compte concerné.

### Le changement de mot de passe est réservé au lien de réinitialisation

`updatePassword` n'accepte que la session ouverte, depuis moins de 15 minutes, par un
lien reçu par courriel. L'information vient de la revendication `amr` du jeton, signée
par le service. Une session ordinaire laissée ouverte sur un poste partagé ne permet pas
de s'emparer du compte par l'application.

Limite : par appel direct à l'API d'authentification, une session ordinaire peut encore
changer le mot de passe (dette D-10). Le titulaire est prévenu par courriel de tout
changement.

### Jeton des liens par courriel

Le jeton d'un lien est l'empreinte de l'adresse et du code à usage unique. Avec le code à
6 chiffres par défaut, il se devinait en un million d'essais : la longueur est portée à
10 chiffres (`otp_length = 10`), la validité à 15 minutes. Un test vérifie que le jeton
ne se déduit pas d'un code à 6 chiffres.

### Limitation de débit

Les compteurs sont en base (`private.rate_limit_buckets`), donc communs à toutes les
instances du serveur. Les clés sont des empreintes : ni adresse IP ni adresse
électronique ne sont stockées.

| Action | Par client | Par client et compte | Par compte, toutes origines |
|---|---|---|---|
| Connexion | 100 / 15 min | 10 / 15 min | 100 / 15 min |
| Inscription | 20 / h | — | 5 / h |
| Demande de réinitialisation | 20 / h | — | 3 / h |
| Confirmation d'un lien | 30 / 15 min | — | — |
| Nouveau mot de passe | 20 / h | — | — |
| Mot de passe redemandé (suppression de compte) | 20 / 15 min | 5 / 15 min | — |
| Code du second facteur | 60 / 15 min | 8 / 15 min | — |

- Le refus courant porte sur le couple client + compte : il ne gêne pas le titulaire qui
  se connecte d'ailleurs.
- Au-delà de la limite par compte, l'inscription et la demande de réinitialisation
  répondent comme d'habitude, sans envoyer de courriel.
- En cas de panne du compteur, la tentative est refusée.
- Une durée plancher de réponse réduit l'écart de temps entre compte existant et inconnu.

**Adresse du client.** `x-forwarded-for` est contrôlable par le client et n'est jamais
lu par défaut. Sur Vercel, l'application lit `x-vercel-forwarded-for` ; ailleurs,
l'en-tête nommé par `TRUSTED_CLIENT_IP_HEADER`. Sans source fiable, tous les visiteurs
partagent un même compteur : c'est sûr, mais peu fin. Les adresses IPv6 sont regroupées
par préfixe /64.

### Redirection après connexion

`safeNextPath` n'accepte qu'un chemin interne ; toute autre valeur mène au compte. Le
texte des messages affichés après redirection vient d'une liste fermée, jamais de l'adresse.

### Validation en deux étapes

Tout utilisateur peut activer un second facteur par application d'authentification
(TOTP) depuis `/account/security`. Elle est indispensable aux rôles privilégiés : leurs
droits n'existent que dans une session où le second facteur a été vérifié.

- **Activation** : le serveur crée le facteur, affiche le code à scanner et la clé, puis
  un premier code prouve que l'application est configurée.
- **Connexion** : après le mot de passe, `/sign-in/verify` demande le code. Tant qu'il
  n'est pas fourni, aucune page protégée n'est accessible.
- **En base** : un compte qui a un facteur vérifié n'a aucun droit dans une session
  ouverte par le seul mot de passe (`private.is_account_active`). La règle vaut donc
  aussi pour un appel direct à l'API ; un test d'intégration le vérifie.
- **Désactivation** : un code saisi à l'instant est exigé.
- **Mot de passe oublié** : le lien de réinitialisation fonctionne pour un compte à deux
  étapes ; le code reste demandé à la connexion suivante.

Limites connues :

- aucun code de secours : la perte de l'application d'authentification demande une
  intervention de l'assistance (dette D-17) ;
- le service d'authentification accepte qu'un même code serve deux fois pendant sa
  demi-minute de validité ; la limitation de débit borne les essais.

### Profil exigé à la première connexion

Tant que le profil minimal (pays, niveau, filière) et la déclaration d'âge ne sont pas
enregistrés, la page du compte renvoie au formulaire de profil. La règle vaut aussi par
appel direct à l'API : la base ne laisse rien publier à un compte qui ne l'a pas fait
(`private.is_onboarded()`), quel que soit le chemin par lequel il a été créé.

### Suppression de son compte

Le mot de passe est redemandé, avec un compteur de tentatives distinct de celui de la
connexion. La base est ensuite interrogée sous la session de l'utilisateur : un compte
suspendu ne peut pas effacer sa suspension en se supprimant, et le dernier administrateur
d'une organisation doit d'abord transmettre l'administration. La demande et la
suppression sont journalisées. Le cookie de session est effacé même si le service
d'authentification ne répond pas.

## Modules

| Module | Rôle |
|---|---|
| `src/lib/env.server.ts` | Seul lecteur des variables serveur, avec validation |
| `src/lib/supabase/server.ts` | Client de session (sous le jeton de l'utilisateur) et client de service |
| `src/lib/supabase/proxy.ts` | Rafraîchissement de la session avant le rendu, borné à 4 secondes |
| `src/lib/supabase/cookies.ts` | Nom et options imposées du cookie de session |
| `src/lib/auth/actions.ts` | Actions serveur |
| `src/lib/auth/session.ts` | `getCurrentUser`, `requireUser`, session de réinitialisation |
| `src/lib/auth/rate-limit.ts`, `client-address.ts` | Limitation de débit |
| `src/lib/auth/redirect.ts`, `schemas.ts`, `recovery.ts`, `state.ts` | Fonctions pures, testées unitairement |

Supabase n'est importé que dans `src/lib/supabase/` ; une règle de lint l'interdit ailleurs.

## Tests

| Niveau | Commande | Couvre |
|---|---|---|
| Unitaire | `npm test` | Redirection, schémas, adresse du client, session de réinitialisation, cookies |
| Appel direct à l'API | `npm run test:integration` | Ce que la base refuse à un client qui contourne l'application |
| Bout en bout | `npm run test:e2e` | Les parcours complets, courriels compris, sur bureau et mobile |

Les deux derniers ont besoin de l'instance Supabase locale (`npm run db:start`).

## Ce qui reste à faire

Voir la dette de sécurité du backlog : CAPTCHA et mots de passe compromis (D-09),
changement de mot de passe par appel direct (D-10), purge des comptes non confirmés
(D-12), codes de secours du second facteur (D-17).

Risques résiduels connus :

- par appel direct à l'API d'authentification, la limite par compte de l'application ne
  s'applique pas : seules valent les limites par adresse IP du service, d'où D-09 ;
- les points d'entrée de connexion par lien magique et par code restent ouverts côté
  service ; l'application ne les utilise pas ;
- un attaquant réparti peut atteindre la limite par compte et gêner une connexion ; le
  CAPTCHA remplacera ce refus.
