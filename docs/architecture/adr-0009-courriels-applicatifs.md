# ADR-0009 — Courriels envoyés par l'application

- Statut : accepté le 7 octobre 2026 (délégation du porteur de projet : « fonce jusqu'à la fin »)
- Contexte de la décision : dette D-27 et D-29

## Contexte

Le service d'authentification envoie lui-même les courriels de confirmation, de
réinitialisation, et les avis d'activation ou de désactivation du second facteur. Il
n'en envoie pas pour quatre événements que le titulaire doit pourtant connaître :

- un code de secours a levé sa validation en deux étapes ;
- de nouveaux codes de secours ont été générés ;
- son compte a été suspendu — la connexion, par choix, lui répond alors comme à un mot
  de passe erroné, pour ne rien révéler à un tiers ;
- son compte a été rétabli.

## Décision

L'application envoie ces avis elle-même, par SMTP, avec la bibliothèque `nodemailer`.

- **SMTP** plutôt que l'API d'un fournisseur : le service d'authentification exige déjà
  un serveur SMTP en production ; le même compte sert aux deux, et changer de
  fournisseur ne touche pas au code.
- **Deux variables serveur** : `SMTP_URL` et `MAIL_FROM`. Sans elles, aucun avis ne
  part et rien d'autre ne change : l'envoi est un complément, jamais une condition.
- **Contenu constant** : bilingue, sans lien, sans code, sans aucune donnée du compte
  (`apps/web/src/lib/mail/notices.ts`). Un avis ne demande jamais de cliquer.
- **Après l'action, jamais avant** : l'opération a déjà abouti en base quand l'avis
  part. Un échec d'envoi est consigné sans l'adresse du destinataire et n'apparaît pas
  comme une erreur de l'action.
- **Adresse du destinataire** : celle de la session pour les avis sur son propre compte.
  Pour une suspension ou un rétablissement, elle est lue par le rôle serveur, une fois
  l'opération acceptée par la base sous la session de l'administrateur ; elle n'est ni
  affichée ni journalisée (`authorization-model.md` §7.5).

## Complément du 7 octobre 2026 : l'invitation à un projet

L'invitation à suivre un projet (E-01) est le seul message de l'application qui porte un
lien : celui de la plateforme elle-même, avec un jeton à usage unique. Elle ne nomme que
la personne qui invite, par l'adresse confirmée de son compte ; le titre du projet, que
cette personne choisit librement, n'y figure pas, pour qu'il ne serve pas à faire passer
un autre message. Vingt invitations par jour et par compte.

## Complément du 8 octobre 2026 : le courriel des notifications

Qui le demande reçoit un courriel quand de nouvelles notifications l'attendent (E-05).

- **Demandé, jamais imposé** : désactivé par défaut, réglé depuis la page
  « Notifications ». Au plus un courriel par vingt heures.
- **Aucun contenu** : le message dit qu'il y a du nouveau, sans nommer le projet ni ce
  qui s'y est passé, et ne porte aucun lien vers le compte — il invite à ouvrir
  l'application comme d'habitude. Son seul lien est celui du désabonnement.
- **Désabonnement sans connexion** : le lien porte un jeton propre à la personne. Ouvrir
  la page ne fait rien ; il faut le demander, pour qu'un logiciel de messagerie qui suit
  les liens ne désabonne personne. L'en-tête `List-Unsubscribe` désigne la même page ; le
  désabonnement en un clic (RFC 8058) n'est pas offert.
- **Déclenchement** : la base ne sait pas envoyer de courriel. Une tâche planifiée de
  l'hébergeur appelle `/api/cron/notification-digest` en présentant `CRON_SECRET` ; la
  base choisit les destinataires et les marque comme prévenus avant l'envoi. Un envoi qui
  échoue n'est pas retenté avant le lendemain : le courriel est un complément, la
  notification interne reste la référence.
- **Par lot de cinquante** : au-delà, les personnes restantes sont prévenues à l'appel
  suivant. À reprendre (transport partagé, file d'attente) si le volume le demande.

## Écarté

- **Confirmation par courriel avant de lever le second facteur** : fermerait la voie de
  secours à qui a perdu l'accès à sa boîte en même temps que son téléphone ; l'avis
  après coup, la fermeture des autres sessions et l'avertissement à l'écran suffisent.
- **File d'attente en base et tâche d'envoi** : utile pour des envois en nombre
  (notifications de Phase 4) ; disproportionné pour quatre avis unitaires. À reprendre
  si le volume le demande.

## Conséquences

- Une dépendance de plus (`nodemailer`), côté serveur seulement.
- En production : définir `SMTP_URL` et `MAIL_FROM` sur l'hébergeur, avec un domaine
  d'envoi authentifié (SPF, DKIM), le même que celui du service d'authentification.
- Un avis peut ne pas partir (panne du service de courriel) : l'avertissement à l'écran
  et le journal d'audit restent la trace de référence.
- L'adresse de contact de l'assistance n'est pas encore dans les messages : elle attend
  la désignation de l'entité responsable.
