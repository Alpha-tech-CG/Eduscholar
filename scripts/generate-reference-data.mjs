#!/usr/bin/env node
// Génère la migration de données des référentiels (B-12) à partir de :
//  - la liste ISO 3166-1 des pays, dont les libellés français et anglais sont
//    fournis par les données CLDR embarquées dans Node.js ;
//  - la taxonomie pilote de docs/product/taxonomy-pilot.md, recopiée ci-dessous.
//
// Usage : node scripts/generate-reference-data.mjs > supabase/migrations/<horodatage>_reference_data.sql
// Le fichier produit est versionné ; ce script ne sert qu'à le régénérer.

// Codes à deux lettres connus de CLDR qui ne sont pas des pays ISO 3166-1
// officiellement attribués (réservations, regroupements, codes d'usage privé).
const NOT_ISO_3166_1 = new Set([
  "AC", "CP", "CQ", "DG", "EA", "EU", "EZ", "IC", "TA", "UN", "XA", "XB", "XK", "ZZ", "QO",
  // Anciens codes, que CLDR résout encore vers le pays actuel.
  "AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR",
]);

const fr = new Intl.DisplayNames(["fr"], { type: "region" });
const en = new Intl.DisplayNames(["en"], { type: "region" });

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const countries = [];
for (const a of letters) {
  for (const b of letters) {
    const code = a + b;
    if (NOT_ISO_3166_1.has(code)) continue;
    let nameEn;
    try {
      nameEn = en.of(code);
    } catch {
      continue;
    }
    if (!nameEn || nameEn === code || /unknown/i.test(nameEn)) continue;
    countries.push({ code, fr: fr.of(code), en: nameEn });
  }
}

if (countries.length !== 249) {
  console.error(`Attendu : 249 pays ISO 3166-1. Obtenu : ${countries.length}.`);
  process.exit(1);
}

const languages = [
  ["fr", "Français", "French", true, true],
  ["en", "Anglais", "English", true, true],
  ["pt", "Portugais", "Portuguese", false, true],
  ["ar", "Arabe", "Arabic", false, true],
];

const levels = [
  ["upper_secondary", "Lycée", "Upper secondary", 3, false],
  ["short_cycle", "Cycle court (BTS, DUT, HND)", "Short-cycle tertiary", 5, true],
  ["bachelor_1", "Licence 1", "Bachelor year 1", 6, true],
  ["bachelor_2", "Licence 2", "Bachelor year 2", 6, true],
  ["bachelor_3", "Licence 3", "Bachelor year 3", 6, true],
  ["bachelor_4", "Licence 4 / année d'honneur", "Bachelor year 4 / Honours", 6, true],
  ["master_1", "Master 1", "Master year 1", 7, true],
  ["master_2", "Master 2", "Master year 2", 7, true],
  ["doctorate", "Doctorat", "Doctorate", 8, true],
  ["professional", "Formation professionnelle", "Professional training", null, true],
];

const domains = [["sciences_technology", "Sciences et technologies", "Science and technology"]];
const programs = [["computer_science", "sciences_technology", "Informatique", "Computer science"]];

const specialties = [
  ["software_engineering", "Génie logiciel", "Software engineering"],
  ["networks_systems", "Réseaux et systèmes", "Networks and systems"],
  ["data_ai", "Données et intelligence artificielle", "Data and artificial intelligence"],
  ["cybersecurity", "Cybersécurité", "Cybersecurity"],
  ["information_systems", "Systèmes d'information", "Information systems"],
  ["web_mobile", "Développement web et mobile", "Web and mobile development"],
];

const subjects = [
  ["programming_fundamentals", "Bases de la programmation", "Programming fundamentals"],
  ["algorithms", "Algorithmique", "Algorithms"],
  ["data_structures", "Structures de données", "Data structures"],
  ["object_oriented_programming", "Programmation orientée objet", "Object-oriented programming"],
  ["discrete_mathematics", "Mathématiques discrètes", "Discrete mathematics"],
  ["probability_statistics", "Probabilités et statistiques", "Probability and statistics"],
  ["computer_architecture", "Architecture des ordinateurs", "Computer architecture"],
  ["operating_systems", "Systèmes d'exploitation", "Operating systems"],
  ["computer_networks", "Réseaux informatiques", "Computer networks"],
  ["databases", "Bases de données", "Databases"],
  ["software_engineering", "Génie logiciel", "Software engineering"],
  ["web_development", "Développement web", "Web development"],
  ["mobile_development", "Développement mobile", "Mobile development"],
  ["formal_languages_compilers", "Langages formels et compilation", "Formal languages and compilers"],
  ["theory_of_computation", "Calculabilité et complexité", "Theory of computation"],
  ["artificial_intelligence", "Intelligence artificielle", "Artificial intelligence"],
  ["machine_learning", "Apprentissage automatique", "Machine learning"],
  ["data_science", "Science des données", "Data science"],
  ["information_security", "Sécurité informatique", "Information security"],
  ["cryptography", "Cryptographie", "Cryptography"],
  ["distributed_systems", "Systèmes distribués", "Distributed systems"],
  ["cloud_computing", "Informatique en nuage", "Cloud computing"],
  ["human_computer_interaction", "Interaction homme-machine", "Human-computer interaction"],
  ["computer_graphics", "Informatique graphique", "Computer graphics"],
  ["embedded_systems", "Systèmes embarqués", "Embedded systems"],
  ["information_systems", "Systèmes d'information", "Information systems"],
  ["it_project_management", "Gestion de projet informatique", "IT project management"],
  ["research_methodology", "Méthodologie de recherche", "Research methodology"],
  ["ethics_law_computing", "Éthique et droit du numérique", "Ethics and law in computing"],
];

const q = (value) => (value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const labels = (f, e) => `jsonb_build_object('fr', ${q(f)}, 'en', ${q(e)})`;
const rows = (list) => list.map((row) => `  (${row.join(", ")})`).join(",\n");

const out = [];
out.push(`-- =============================================================================
-- B-12 — Données des référentiels
--
-- Fichier généré par scripts/generate-reference-data.mjs. Ne pas modifier à la
-- main : corriger le script ou docs/product/taxonomy-pilot.md, puis régénérer
-- dans une nouvelle migration.
--
-- Pays : ISO 3166-1 (249 entrées), libellés CLDR.
-- Taxonomie : docs/product/taxonomy-pilot.md.
--
-- Réversibilité : vider les tables de référentiels (aucune donnée d'utilisateur).
-- =============================================================================
`);

out.push("insert into public.countries (code, labels) values");
out.push(rows(countries.map((c) => [q(c.code), labels(c.fr, c.en)])) + ";\n");

out.push("insert into public.languages (code, labels, is_interface, is_active) values");
out.push(rows(languages.map(([code, f, e, ui, active]) => [q(code), labels(f, e), ui, active])) + ";\n");

out.push("insert into public.education_levels (code, labels, isced_level, is_active, position) values");
out.push(
  rows(
    levels.map(([code, f, e, isced, active], i) => [
      q(code),
      labels(f, e),
      isced ?? "null",
      active,
      (i + 1) * 10,
    ]),
  ) + ";\n",
);

out.push("insert into public.academic_domains (code, labels) values");
out.push(rows(domains.map(([code, f, e]) => [q(code), labels(f, e)])) + ";\n");

out.push("insert into public.academic_programs (code, domain_code, labels) values");
out.push(rows(programs.map(([code, domain, f, e]) => [q(code), q(domain), labels(f, e)])) + ";\n");

out.push("insert into public.program_specialties (program_code, code, labels, position) values");
out.push(rows(specialties.map(([code, f, e], i) => [q("computer_science"), q(code), labels(f, e), (i + 1) * 10])) + ";\n");

out.push("insert into public.subjects (program_code, code, labels, position) values");
out.push(rows(subjects.map(([code, f, e], i) => [q("computer_science"), q(code), labels(f, e), (i + 1) * 10])) + ";");

console.log(out.join("\n"));
