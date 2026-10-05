# ADR-0007 — Aucun client de données Supabase dans le navigateur

**Date :** 6 octobre 2026
**Statut :** proposé — à valider par le porteur de projet
**Tâche :** B-03 (issu de la revue de sécurité du modèle d'autorisation)

## Contexte

L'API Supabase (PostgREST, Auth, Storage) est accessible avec la clé publique, sans passer
par l'application. Si le navigateur l'appelle directement, toutes les protections placées
dans le code Next.js sont contournables par un utilisateur authentifié : validation des
entrées, nettoyage du contenu riche, limitation de débit, pagination, journal d'audit.
De plus, un client Supabase dans le navigateur a besoin d'un jeton lisible par JavaScript,
ce qui contredit l'exigence de cookies `HttpOnly` (cahier §10.2).

## Décision

1. Le navigateur ne parle qu'à Next.js. Aucun client Supabase de données n'est instancié
   côté client ; la clé publique n'est pas utilisée par le code du navigateur.
2. La session est portée par des cookies `HttpOnly`, `Secure`, `SameSite`, posés et lus
   par le serveur.
3. Le serveur lit les données sous la session de l'utilisateur : la RLS s'applique.
4. Les écritures sensibles passent par des fonctions nommées en base, qui valident,
   appliquent la règle métier et écrivent l'audit dans la même transaction. Les droits
   d'écriture directe correspondants sont retirés au rôle `authenticated`.
5. Les objets Storage ne sont accessibles que par des URL signées émises par le serveur.
6. Toute règle de sécurité est imposée en base ; le code serveur la répète, il ne la
   porte pas seul.

## Conséquences

- Positif : un appel direct à l'API Supabase n'obtient rien de plus que l'application ;
  le jeton est hors de portée d'un script injecté ; l'audit est complet.
- Négatif : pas de Realtime côté navigateur pour l'instant (commentaires en direct,
  édition collaborative) ; chaque interaction passe par le serveur, ce qui coûte un aller
  supplémentaire ; davantage de logique en SQL, à tester en base.
- Le mode hors ligne (Phase 5) devra synchroniser par le serveur.

## Points à vérifier en B-10

- Configuration de la bibliothèque de session Supabase pour des cookies `HttpOnly`.
- Durée de vie du jeton d'accès et comportement du rafraîchissement.

## Alternative écartée

Client Supabase dans le navigateur, protégé par la seule RLS : plus simple et compatible
Realtime, mais chaque règle métier devrait être réécrite en politique ou en trigger sous
peine d'être contournable, et le jeton serait exposé au JavaScript de la page.

## Critère de révision

Si une fonctionnalité exige le temps réel (Phase 4), étudier un canal dédié limité à des
événements sans contenu privé, par un nouvel ADR.
