-- =============================================================================
-- B-11 — Profil académique
--
-- Références : cahier §6.2 ; authorization-model §5.2 ; docs/product/minors-policy.md
-- (option A : déclaration d'âge) ; dette D-11.
--
-- Le profil reste privé : seul son titulaire le lit et le modifie. Les valeurs
-- sont contrôlées par la base (clés étrangères, entrées actives, cohérence
-- filière / spécialité / matières), pour qu'un appel direct à l'API ne puisse
-- pas enregistrer ce que le formulaire refuserait.
--
-- Réversibilité : supprimer les déclencheurs profiles_validate_references et
-- profiles_stamp_declarations, leurs fonctions, puis les colonnes ajoutées.
-- =============================================================================

alter table public.profiles
  add column country_code text
    references public.countries (code) on update restrict on delete restrict,
  add column level_code text
    references public.education_levels (code) on update restrict on delete restrict,
  add column program_code text
    references public.academic_programs (code) on update restrict on delete restrict,
  add column specialty_code text,
  add column subject_codes text[] not null default '{}',
  add column institution_name text,
  add column goals text[] not null default '{}',
  add column age_confirmed_at timestamptz,
  add column onboarded_at timestamptz;

alter table public.profiles
  add constraint profiles_specialty_fkey
    foreign key (program_code, specialty_code)
    references public.program_specialties (program_code, code)
    on update restrict on delete restrict,
  add constraint profiles_specialty_requires_program
    check (specialty_code is null or program_code is not null),
  add constraint profiles_subjects_require_program
    check (cardinality(subject_codes) = 0 or program_code is not null),
  add constraint profiles_subject_codes_size check (cardinality(subject_codes) <= 40),
  add constraint profiles_institution_name_check
    check (institution_name is null or char_length(btrim(institution_name)) between 2 and 200),
  add constraint profiles_goals_check
    check (
      goals <@ array['courses', 'revision', 'thesis', 'research', 'project']
      and cardinality(goals) <= 5
    );

comment on column public.profiles.institution_name is
  'Établissement, en saisie libre. Privé : jamais affiché à un tiers.';
comment on column public.profiles.age_confirmed_at is
  'Date de la déclaration d''avoir l''âge requis. Seule la confirmation est conservée, pas la date de naissance.';
comment on column public.profiles.onboarded_at is
  'Date à laquelle le profil minimal a été complété. Calculée par la base.';

-- Les valeurs choisies doivent exister et être actives. Une clé étrangère ne
-- vérifie pas le caractère actif : un niveau désactivé (le lycée, tant que
-- l'accueil de mineurs n'est pas décidé) resterait sélectionnable par appel direct.
create function private.validate_profile_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invalid text;
begin
  if new.country_code is not null
     and new.country_code is distinct from old.country_code
     and not exists (
       select 1 from public.countries c where c.code = new.country_code and c.is_active
     ) then
    raise exception 'Pays inconnu ou inactif.' using errcode = '23514';
  end if;

  if new.level_code is not null
     and new.level_code is distinct from old.level_code
     and not exists (
       select 1 from public.education_levels l where l.code = new.level_code and l.is_active
     ) then
    raise exception 'Niveau inconnu ou inactif.' using errcode = '23514';
  end if;

  if new.program_code is not null
     and new.program_code is distinct from old.program_code
     and not exists (
       select 1 from public.academic_programs p where p.code = new.program_code and p.is_active
     ) then
    raise exception 'Filière inconnue ou inactive.' using errcode = '23514';
  end if;

  if new.specialty_code is not null
     and (new.specialty_code is distinct from old.specialty_code
          or new.program_code is distinct from old.program_code)
     and not exists (
       select 1
       from public.program_specialties s
       where s.program_code = new.program_code
         and s.code = new.specialty_code
         and s.is_active
     ) then
    raise exception 'Spécialité inconnue pour cette filière.' using errcode = '23514';
  end if;

  if new.subject_codes is distinct from old.subject_codes
     or new.program_code is distinct from old.program_code then
    if cardinality(new.subject_codes) <> (
      select count(distinct code) from unnest(new.subject_codes) as u (code)
    ) then
      raise exception 'Une matière ne peut figurer qu''une fois.' using errcode = '23514';
    end if;

    select u.code into v_invalid
    from unnest(new.subject_codes) as u (code)
    where not exists (
      select 1
      from public.subjects s
      where s.program_code = new.program_code and s.code = u.code and s.is_active
    )
    limit 1;

    if v_invalid is not null then
      raise exception 'Matière inconnue pour cette filière.' using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

-- Déclarations horodatées par la base : la valeur envoyée par le client ne sert
-- que de signal.
--  - La déclaration d'âge ne se retire pas et ne se redate pas.
--  - Le profil est « complété » dès que pays, niveau, filière et déclaration
--    d'âge sont renseignés ; cette date n'est pas modifiable par le client.
create function private.stamp_profile_declarations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.age_confirmed_at is not null then
    new.age_confirmed_at := old.age_confirmed_at;
  elsif new.age_confirmed_at is not null then
    new.age_confirmed_at := now();
  end if;

  new.onboarded_at := old.onboarded_at;
  if new.onboarded_at is null
     and new.country_code is not null
     and new.level_code is not null
     and new.program_code is not null
     and new.age_confirmed_at is not null then
    new.onboarded_at := now();
  end if;

  return new;
end
$$;

create trigger profiles_validate_references
  before update on public.profiles
  for each row execute function private.validate_profile_references();
create trigger profiles_stamp_declarations
  before update on public.profiles
  for each row execute function private.stamp_profile_declarations();

-- Droits : le titulaire modifie ses champs académiques. onboarded_at n'est pas
-- accordé : il est calculé.
grant update (
  country_code, level_code, program_code, specialty_code, subject_codes,
  institution_name, goals, age_confirmed_at
) on public.profiles to authenticated;
