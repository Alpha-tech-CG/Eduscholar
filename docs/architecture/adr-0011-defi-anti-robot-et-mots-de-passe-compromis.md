# ADR-0011 — Défi anti-robot et mots de passe compromis

- Statut : accepté le 8 octobre 2026 (fournisseur choisi par le porteur de projet :
  Cloudflare Turnstile)
- Contexte de la décision : dette D-09

## Contexte

Le service d'authentification est joignable sans passer par l'application. Les limites
de débit de l'application ne protègent donc que son propre chemin ; par appel direct,
seule joue la limite par adresse du service. Il manquait deux mesures du modèle de
menaces (M-01) : un défi anti-robot, et le refus des mots de passe déjà divulgués.

## Décision

### Défi anti-robot : Cloudflare Turnstile, vérifié par le service d'authentification

- **La barrière est dans le service d'authentification**, pas dans l'application. Activé
  dans sa configuration, il exige un jeton Turnstile à l'inscription, à la connexion et à
  la demande de réinitialisation, et le vérifie lui-même auprès de Cloudflare. Un appel
  direct sans jeton est refusé.
- **L'application ne vérifie pas le jeton** : elle le transmet. Un jeton ne sert qu'une
  fois ; le vérifier dans l'application le rendrait inutilisable pour le service.
- **Sept formulaires** portent le widget : connexion, inscription, mot de passe oublié,
  et les quatre qui redemandent le mot de passe (suppression du compte, copie des
  données, codes de secours, activation du second facteur). Ces derniers revérifient le
  mot de passe par une connexion, que le service soumet au même défi.
- **Deux réglages, tous deux nécessaires** :
  - `TURNSTILE_SITE_KEY`, variable serveur de l'application : affiche le widget et ouvre
    la politique de sécurité de contenu à `https://challenges.cloudflare.com`, et à elle
    seule (script et cadre). Sans elle, aucun cadre n'est admis ;
  - le secret Turnstile, dans la configuration du service d'authentification
    (`[auth.captcha]`), jamais dans le dépôt ni dans l'application.
- **Ordre d'activation** : la clé de site d'abord, le secret ensuite. L'inverse fermerait
  la connexion à tout le monde.
- **En local et dans les tests**, le défi est désactivé : le service appellerait
  Cloudflare à chaque connexion, et les tests ne doivent pas dépendre du réseau.

### Mots de passe compromis : k-anonymat, côté serveur

À l'inscription et au changement de mot de passe, le serveur calcule l'empreinte SHA-1
du mot de passe et n'en envoie que les cinq premiers caractères à « Have I Been Pwned »,
qui rend toutes les empreintes connues commençant ainsi. La comparaison se fait sur le
serveur : ni le mot de passe, ni son empreinte complète ne sortent.

- Activé par `PASSWORD_BREACH_CHECK=1`. Désactivé par défaut, et dans les tests.
- Complément, pas barrière : sans réponse en deux secondes, le mot de passe est accepté.
  Un appel direct au service d'authentification n'y passe pas. Sur un projet hébergé
  dont l'offre le permet, activer aussi le contrôle natif du service
  (protection contre les mots de passe divulgués), qui, lui, couvre l'appel direct.

## Vérifié

- Tests unitaires : politique de sécurité de contenu avec et sans défi ; contrôle des
  mots de passe (seul le préfixe part, lignes de remplissage ignorées, panne tolérée).
- Sonde manuelle du 8 octobre 2026, serveur local et clé de test publique de Cloudflare :
  le widget se charge sous la politique de sécurité de contenu, sans aucun refus, et le
  jeton arrive dans le champ du formulaire.

## Non vérifié

Le refus, par le service d'authentification, d'une connexion sans jeton : il demande
d'activer `[auth.captcha]` avec un secret, donc un projet de staging. **À valider en
staging avant l'ouverture**, formulaire par formulaire.

## Écarté

- **Vérifier le jeton dans l'application** : ne protégerait que son chemin.
- **hCaptcha** : équivalent ; Turnstile retenu par le porteur de projet.
- **Envoyer le mot de passe ou son empreinte entière à un tiers** : exclu.

## Conséquences

- Une origine tierce de plus, pour les seules pages qui portent un formulaire concerné,
  et seulement quand le défi est configuré. Cloudflare reçoit alors l'adresse et des
  signaux du navigateur du visiteur : à inscrire dans la politique de confidentialité.
- Sans JavaScript, le widget ne s'affiche pas et le service refusera la connexion une
  fois le défi activé : la connexion exige alors JavaScript.
- Les tests de bout en bout ne couvrent pas le widget.
