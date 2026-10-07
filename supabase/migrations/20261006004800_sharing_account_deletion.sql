-- =============================================================================
-- E-01, E-02 : la suppression d'un compte ne doit pas buter sur le partage
-- =============================================================================
-- Défaut constaté en vérifiant E-02 : le propriétaire d'un projet partagé ne
-- pouvait plus supprimer son compte. Sa suppression efface le projet, donc ses
-- membres, invitations et commentaires ; mais ces mêmes lignes portaient aussi
-- une référence « mise à vide » vers lui (qui a invité, qui a écrit, qui a
-- clos). PostgreSQL mettait la colonne à vide avant d'effacer la ligne, puis
-- revérifiait le projet, déjà parti : la suppression échouait.
--
-- Ces colonnes disent qui a fait quoi ; elles ne portent aucun droit. Elles
-- deviennent de simples identifiants, sans clé étrangère : la suppression
-- d'un compte ne les touche plus. L'identifiant d'un compte supprimé y reste,
-- comme dans le journal d'audit, sans plus rien désigner.
--
-- Réversibilité : recréer les cinq clés étrangères en `on delete set null`.
-- =============================================================================

alter table public.research_project_members
  drop constraint research_project_members_invited_by_fkey;
alter table public.project_invitations
  drop constraint project_invitations_created_by_fkey,
  drop constraint project_invitations_accepted_by_fkey;
alter table public.project_comments
  drop constraint project_comments_author_id_fkey,
  drop constraint project_comments_resolved_by_fkey;

comment on column public.research_project_members.invited_by is
  'Qui a invité. Simple identifiant, sans clé étrangère : il peut désigner un compte supprimé.';
comment on column public.project_invitations.created_by is
  'Qui a invité. Simple identifiant, sans clé étrangère.';
comment on column public.project_invitations.accepted_by is
  'Qui a accepté. Simple identifiant, sans clé étrangère.';
comment on column public.project_comments.author_id is
  'Auteur. Simple identifiant, sans clé étrangère : un commentaire survit au compte de son auteur.';
comment on column public.project_comments.resolved_by is
  'Qui a clos le fil. Simple identifiant, sans clé étrangère.';
