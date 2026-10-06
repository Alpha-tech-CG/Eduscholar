-- =============================================================================
-- B-14 — Liste de ses propres soumissions
--
-- L'identité du contributeur n'est pas une colonne lisible : l'application ne
-- peut donc pas filtrer « mes soumissions » elle-même. Cette enveloppe expose
-- la fonction d'appui déjà utilisée par les politiques ; elle ne renvoie que
-- les identifiants des fiches de l'appelant.
--
-- Réversibilité : supprimer la fonction public.my_submission_ids().
-- =============================================================================

create function public.my_submission_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select private.my_submission_ids();
$$;

revoke all on function public.my_submission_ids() from public, anon;
grant execute on function public.my_submission_ids() to authenticated;
