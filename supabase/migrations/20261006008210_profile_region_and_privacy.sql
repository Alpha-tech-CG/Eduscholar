-- =============================================================================
-- Lot 6 (cahier §6.2) : région du profil ; réglages de confidentialité
-- =============================================================================
-- 1. Région : texte libre court, facultatif, privé comme le reste du profil
--    (aucun référentiel de subdivisions n'existe ; un code ISO 3166-2 imposerait
--    d'en maintenir un). La valeur doit arriver normalisée : espaces réduits et
--    retirés aux extrémités, 2 à 100 caractères, sans caractère de commande,
--    invisible ou bidirectionnel, sans `<` ni `>`, sans formule de tableur en
--    tête, avec au moins un caractère qui n'est ni espace, ni ponctuation, ni
--    chiffre. Le titulaire seul la lit et la modifie (droits et RLS existants
--    de `profiles`).
--
-- 2. Confidentialité : `profile_public` (nom affiché, profil public) devient
--    réglable depuis l'application. Écriture directe sous la session, comme le
--    profil : droit de colonne et politique `profile_public_update_own`
--    existants (titulaire, compte actif, profil complété). Rien ne change pour
--    `anon`, qui ne lit toujours rien. Ajouts :
--      - le nom affiché suit les mêmes règles de propreté que la région
--        (1 à 80 caractères) ;
--      - un profil public a un nom affiché (`profile_public_public_requires_name`) ;
--      - chaque changement de visibilité est journalisé dans la même
--        transaction (`security`, `profile.published` / `profile.unpublished`),
--        sans le nom lui-même.
--    Lignes existantes non conformes (aucune écriture applicative jusqu'ici) :
--    le nom est normalisé ; s'il reste invalide, il est vidé ; un profil public
--    sans nom repasse privé. Le défaut le plus protecteur l'emporte.
--
-- Réversibilité : supprimer le déclencheur profile_public_audit_visibility et
-- sa fonction ; supprimer la contrainte profile_public_public_requires_name ;
-- rétablir profile_public_display_name_check
-- (display_name is null or char_length(btrim(display_name)) between 1 and 80) ;
-- revoke update (region) on public.profiles from authenticated ; supprimer la
-- colonne profiles.region (migration explicite, après export si nécessaire).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Région
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column region text
    constraint profiles_region_check check (
      region is null
      or (char_length(region) between 2 and 100
          and region = btrim(regexp_replace(region, '[[:space:]]+', ' ', 'g'))
          and region !~ '[[:cntrl:]]'
          and region !~ '[<>]'
          and region !~ '[\u0080-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\u3164\uFFA0\uFEFF\U000E0000-\U000E007F]'
          and region !~ '^[=+@-]'
          and region ~ '[^[:space:][:punct:][:digit:]]')
    );
comment on column public.profiles.region is
  'Région, en saisie libre normalisée. Privée : jamais affichée à un tiers.';

grant update (region) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Nom affiché et profil public
-- -----------------------------------------------------------------------------
update public.profile_public
set display_name = nullif(
  btrim(regexp_replace(regexp_replace(display_name, '[[:cntrl:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g')),
  ''
)
where display_name is not null;

alter table public.profile_public drop constraint profile_public_display_name_check;

-- Règle partagée par la remise à zéro et la contrainte.
update public.profile_public
set display_name = null
where display_name is not null
  and not (char_length(display_name) between 1 and 80
           and display_name !~ '[<>]'
           and display_name !~ '[\u0080-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\u3164\uFFA0\uFEFF\U000E0000-\U000E007F]'
           and display_name !~ '^[=+@-]'
           and display_name ~ '[^[:space:][:punct:][:digit:]]');

update public.profile_public set is_public = false where is_public and display_name is null;

alter table public.profile_public
  add constraint profile_public_display_name_check check (
    display_name is null
    or (char_length(display_name) between 1 and 80
        and display_name = btrim(regexp_replace(display_name, '[[:space:]]+', ' ', 'g'))
        and display_name !~ '[[:cntrl:]]'
        and display_name !~ '[<>]'
        and display_name !~ '[\u0080-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\u3164\uFFA0\uFEFF\U000E0000-\U000E007F]'
        and display_name !~ '^[=+@-]'
        and display_name ~ '[^[:space:][:punct:][:digit:]]')
  ),
  add constraint profile_public_public_requires_name check (not is_public or display_name is not null);

-- Journal : la visibilité change, jamais le nom consigné.
create function private.audit_profile_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_public is distinct from old.is_public then
    perform private.write_audit(
      'security',
      case when new.is_public then 'profile.published' else 'profile.unpublished' end,
      new.user_id, new.user_id, null,
      'profile_public', new.user_id::text, '{}'::jsonb
    );
  end if;
  return new;
end
$$;
revoke all on function private.audit_profile_visibility() from public, anon, authenticated, service_role;

create trigger profile_public_audit_visibility
  after update of is_public on public.profile_public
  for each row execute function private.audit_profile_visibility();
