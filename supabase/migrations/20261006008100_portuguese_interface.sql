-- =============================================================================
-- Phase 5, F-04 : le portugais devient une langue d'interface
-- =============================================================================
-- L'application s'affiche désormais en français, en anglais et en portugais
-- (cahier §14.1). La base ne connaissait que les deux premières comme langues
-- d'interface : la préférence enregistrée dans un profil ne pouvait pas être
-- le portugais.
--
--   - `languages.is_interface` vaut vrai pour `pt` ; la protection contre la
--     désactivation des langues d'interface (migration 008000) s'y applique
--     donc d'elle-même ;
--   - la contrainte de `profiles.preferred_locale` admet `pt`.
--
-- Les libellés des référentiels restent en français et en anglais ; l'arabe,
-- prévu « selon les marchés », n'est pas une langue d'interface.
--
-- Réversibilité : ramener les profils en `pt` à `fr`, rétablir la contrainte à
-- deux valeurs, remettre `is_interface` à faux pour `pt`.
-- =============================================================================

update public.languages set is_interface = true where code = 'pt';

alter table public.profiles drop constraint profiles_preferred_locale_check;
alter table public.profiles add constraint profiles_preferred_locale_check
  check (preferred_locale in ('fr', 'en', 'pt'));

do $$
begin
  if not exists (select 1 from public.languages where code = 'pt' and is_interface and is_active) then
    raise exception 'La langue pt doit exister, être active et être une langue d''interface';
  end if;
end
$$;
