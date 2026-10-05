# Politique de signalement et de retrait — brouillon

**Date :** 6 octobre 2026
**Statut :** BROUILLON DE TRAVAIL — **à valider juridiquement avant toute ouverture au public**
**Tâche :** B-05
**Références :** cahier §4.6, §6.13, §7.3, §21 ; `content-and-licensing-policy.md` ; modèle d'autorisation §5.1

## 1. Objet

Permettre à toute personne — auteur, éditeur, établissement, utilisateur — de demander le
retrait ou la correction d'une ressource du catalogue, et y répondre vite, de façon
traçable et contestable.

Cette procédure concerne le **catalogue public**. Les projets privés ne sont pas publiés
et ne sont pas visés, sauf obligation légale.

## 2. Deux voies

| Voie | Pour qui | Accès |
|---|---|---|
| **Signalement** | Utilisateur connecté | Bouton sur chaque fiche |
| **Demande de retrait** | Toute personne, y compris sans compte : ayant droit, éditeur, établissement | Formulaire public, limité en débit, et adresse `[À COMPLÉTER]` |

## 3. Motifs

- Atteinte au droit d'auteur ou à une licence.
- Données personnelles ou atteinte à la vie privée.
- Demande de l'auteur lui-même.
- Contenu illicite ou inapproprié.
- Erreur de métadonnées : auteur, licence, date.
- Lien cassé ou source disparue.
- Fichier malveillant.

## 4. Contenu d'une demande de retrait

1. Identité et qualité du demandeur : auteur, ayant droit, représentant.
2. Coordonnées de contact.
3. Adresse de la ressource visée sur la plateforme.
4. Œuvre ou droit concerné, et en quoi la ressource y porte atteinte.
5. Déclaration sur l'honneur de l'exactitude de la demande.

Une demande incomplète reçoit une demande de précision ; elle n'est pas ignorée.

## 5. Traitement

```text
reçue → accusé de réception → examen → décision → notification → contestation éventuelle
```

| Étape | Délai visé |
|---|---|
| Accusé de réception | 24 heures |
| Suspension conservatoire si la demande paraît fondée | 48 heures |
| Fichier malveillant ou contenu manifestement illicite | Suspension immédiate |
| Décision motivée | 7 jours |
| Correction de métadonnées ou de lien | 7 jours |

Ces délais sont des objectifs de service, à mesurer (cahier §21). `[À ALIGNER par le
juriste sur les délais légaux des pays pilotes.]`

**Suspension conservatoire.** En cas de doute sérieux, la ressource est suspendue pendant
l'examen : elle disparaît aussitôt de la recherche et de sa page publique. Le doute
profite au retrait.

## 6. Décisions possibles

| Décision | Effet |
|---|---|
| Retrait | Statut `removed` ; fichier hébergé rendu inaccessible puis supprimé à l'issue du délai de contestation |
| Passage en référencement seul | Le fichier n'est plus hébergé ; la fiche renvoie vers la source officielle |
| Correction | Métadonnées, licence ou lien corrigés ; nouvelle vérification |
| Maintien | Demande rejetée, avec motif |

La ressource retirée n'est pas effacée de l'historique : la décision, son motif et sa date
sont conservés comme preuve. Elle n'apparaît plus ni dans la recherche ni dans les
collections des utilisateurs, qui voient la mention « ressource retirée ».

## 7. Information des personnes

- Le demandeur reçoit la décision et son motif.
- Le contributeur est informé de la demande et de la décision, sans les coordonnées
  personnelles du demandeur lorsque celui-ci est un particulier.
- L'identité d'un utilisateur qui signale n'est communiquée ni au contributeur ni à
  l'établissement visé.

## 8. Contestation

Le contributeur ou le demandeur peut contester une décision dans un délai de 14 jours
`[À CONFIRMER]`, en apportant des éléments : preuve de licence, autorisation écrite. La
contestation est examinée par une autre personne que celle qui a pris la décision
initiale, lorsque l'effectif le permet.

## 9. Abus

Les demandes manifestement infondées ou répétées peuvent être écartées. Les signalements
abusifs répétés entraînent la suspension du droit de signaler.

## 10. Demandes d'autorités

Une demande d'une autorité judiciaire ou administrative est transmise au responsable
désigné `[À COMPLÉTER]`, vérifiée, traitée dans le strict périmètre demandé et consignée.
`[À DÉFINIR par le juriste.]`

## 11. Traçabilité et mesure

Chaque demande, décision et contestation est enregistrée dans le journal d'audit. Sont
suivis : le nombre de demandes, le délai de traitement, la part de retraits et de
contestations.

## 12. Qui décide

Les modérateurs traitent les signalements et les demandes de retrait. Un établissement
peut retirer ses propres ressources. Un administrateur n'intervient que s'il détient
aussi le rôle de modérateur.

## Points à traiter par le juriste

1. Procédure légale de notification et de retrait dans chaque pays pilote.
2. Délais légaux et forme de la notification.
3. Durée de conservation des demandes et des preuves.
4. Traitement des réquisitions et représentant légal.
