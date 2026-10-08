# Administration des rôles et des comptes

**Date :** 7 octobre 2026
**Statut :** en vigueur
**Références :** `authorization-model.md` §5.6 ; migrations `20261006002800_administration.sql`
et `20261006002900_administration_hardening.sql`

## Qui fait quoi

| Opération | Administrateur | Super-administrateur |
|---|---|---|
| Chercher un compte par son adresse exacte | oui | oui |
| Attribuer le rôle de modération | oui | oui |
| Retirer le rôle de modération | à un compte sans autre rôle | à un compte de rang inférieur au sien |
| Attribuer ou retirer le rôle d'administration | non | oui |
| Attribuer, retirer ou suspendre un super-administrateur | non | non : hors application |
| Suspendre un compte | sans rôle, ou modérateur | tout compte sauf un super-administrateur |
| Rétablir un compte | s'il a été suspendu par un administrateur | oui |

Règles tenues par la base, quel que soit le chemin (écran ou appel direct à l'API) :

- l'appelant détient le rôle, sa session a présenté le second facteur, et l'a fait dans
  les **dix dernières minutes** ; passé ce délai, l'écran redemande un code ;
- personne n'agit sur son propre compte, ni sur un compte de rang égal ou supérieur ;
- un rôle ne s'attribue qu'à un compte confirmé, non suspendu, qui a **déjà** activé la
  validation en deux étapes ;
- une suspension exige un motif ; suspendre un compte déjà suspendu, ou rétablir un compte
  actif, est refusé — le motif et l'auteur d'origine ne s'écrasent pas ;
- une suspension décidée par un super-administrateur ne se lève que par un
  super-administrateur ;
- une suspension ferme aussitôt toutes les sessions du compte et l'empêche d'en ouvrir
  une nouvelle, dans la même transaction ; le rétablissement lui rend la connexion. À la
  connexion, le compte suspendu reçoit la même réponse qu'à un mot de passe erroné :
  rien ne dit à un tiers qu'un compte existe ou qu'il est sanctionné. Le titulaire est
  prévenu par un courriel de l'application, à la suspension comme au rétablissement
  (ADR-0009) ;
- 60 recherches par quart d'heure et 30 suspensions par heure, par administrateur ;
- chaque recherche, attribution, retrait, suspension et rétablissement est inscrit au
  journal d'audit au nom de son auteur. La recherche y figure sans l'adresse cherchée. La
  personne visée ne lit pas ces lignes.

Le rôle serveur (`service_role`) n'écrit plus dans la table des rôles : aucun chemin
applicatif n'attribue un rôle hors de ces fonctions.

## Désigner un modérateur ou un administrateur

1. La personne crée son compte, complète son profil et active la validation en deux
   étapes dans « Sécurité du compte ».
2. Un administrateur ouvre « Administration », saisit son code si l'écran le demande,
   cherche le compte par son adresse et attribue le rôle.
3. La personne se reconnecte et saisit son code : ses nouveaux droits sont actifs.

Si la personne remplace plus tard son second facteur — ou le lève par un code de
secours —, son rôle devient sans effet : un administrateur le réattribue, ce qui
renouvelle sa date.

## Le premier super-administrateur

Il ne peut pas être désigné par l'application : c'est voulu. La procédure se fait une
fois, à la création de chaque environnement, **à deux personnes**, par une session directe
sur la base (propriétaire `postgres`) :

1. La personne désignée crée son compte par l'application, confirme son adresse, complète
   son profil et active la validation en deux étapes. Le second facteur doit exister
   **avant** l'attribution, sans quoi le rôle serait sans effet.
2. Une seconde personne vérifie l'adresse du compte, puis exécute :

   ```sql
   insert into public.platform_roles (user_id, role)
   select id, 'super_admin' from auth.users where email = 'adresse@exemple.org';
   ```

3. Le journal d'audit porte une ligne `platform_roles.insert` sans acteur : c'est la
   signature attendue de cette procédure, et la seule. Toute autre ligne sans acteur
   est une anomalie.
4. Les deux personnes consignent la date et leurs noms hors de la plateforme.

Désignez **au moins deux** super-administrateurs : la base refuse que le dernier
super-administrateur effectif (non suspendu, second facteur antérieur au rôle) supprime
son compte, perde son rôle ou lève son second facteur par un code de secours. S'il perd
son application d'authentification, ou s'il n'en reste aucun utilisable, la même
procédure à deux personnes s'applique.

## Limites connues

- Un refus de droit ne lève plus d'erreur : la fonction d'administration le capture,
  l'écrit au journal (`admin.refused`, `source: database` : qui, quelle opération, quel
  motif — jamais la cible) et répond « 403 ». La transaction aboutit, la trace reste, et
  ce que la fonction avait commencé est annulé. Un appel direct à l'API laisse donc la
  même trace que l'application. Les deux écritures rendent un objet `{ code, message }`
  quand elles refusent et rien quand elles aboutissent ; une lecture refusée ne rend
  aucune ligne. L'application ne tient une écriture pour faite que si la réponse est un
  succès sans erreur ni contenu.
- Plafonds de cette consignation : cinq lignes par heure pour un compte sans rôle
  d'administration, trente pour un administrateur ; le premier dépassement d'une heure
  laisse une ligne `admin.refusal_overflow`. Cinq cents lignes par heure pour l'ensemble
  des comptes sans rôle, puis une ligne `admin.refusal_platform_overflow` ; les refus
  d'un administrateur passent toujours.
- Les autres refus — compte introuvable, limite de débit, valeur invalide — ne sont
  opposés qu'à un administrateur déjà reconnu ; ils sont levés comme avant et ne sont pas
  consignés. Seule la limite de débit de la recherche, opposée par l'application, l'est
  (`source: app`).
- Le motif d'une suspension n'entre pas au journal d'audit. Il est gardé dans
  l'historique du compte, avec son auteur, à chaque suspension et à chaque
  rétablissement ; l'administration le lit sur la fiche du compte, et cette lecture est
  journalisée. L'historique part avec le compte.
- Tout administrateur lit l'historique de tout compte, y compris d'un pair ou d'un
  super-administrateur : il n'y agit pas, et sa lecture est journalisée.
- L'historique d'un compte est gardé trois ans ; passé quatre-vingt-dix jours, seules les
  cinquante décisions les plus récentes du compte le sont. La copie des données remise
  au titulaire porte la date et la nature de chaque décision (événements du compte), pas
  son motif ni son auteur : le motif se demande à l'administration.
- La liste des comptes s'arrête à cinq cents, détenteurs d'un rôle d'abord.
- Le motif d'une suspension n'entre pas au journal d'audit. Il est gardé dans
  l'historique du compte, avec son auteur, à chaque suspension et à chaque
  rétablissement ; l'administration le lit sur la fiche du compte, et cette lecture est
  journalisée. L'historique part avec le compte.
- La liste des comptes à rôle et suspendus n'est pas journalisée à la lecture.
- Les organisations (invitation, rôles d'organisation, dissolution) ne sont pas encore
  administrées par fonctions : le rôle serveur y écrit toujours (dette D-01, D-04).
