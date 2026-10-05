# ADR-0005 — Internationalisation avec next-intl

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet)
**Tâche :** B-02

## Contexte

Le cahier (§14) impose le français et l’anglais dès le départ, une architecture prête pour
le portugais, l’arabe et des langues locales, et interdit les textes codés dans les
composants.

## Décision

`next-intl` avec routage par préfixe de langue (`/fr`, `/en`). Français et anglais au
lancement.

## Règles

- Aucun texte d’interface en dur dans un composant ; tout passe par les catalogues de messages.
- Une clé ajoutée l’est dans les deux langues ; un contrôle en CI détecte les clés manquantes.
- Dates, nombres et devises formatés selon la locale ; fuseaux en IANA ; devise séparée du montant.
- La mise en page utilise des propriétés logiques CSS, pour rester compatible avec une langue écrite de droite à gauche.
- Le contenu du catalogue (titres, résumés) garde sa langue d’origine, stockée en donnée ; il n’est pas traduit par l’interface.
- Pays, langues et niveaux viennent de référentiels en base, jamais de listes codées.

## Conséquences

- Positif : URL par langue utiles au référencement, compatibilité avec les Server Components.
- Négatif : discipline requise sur les catalogues de messages.
