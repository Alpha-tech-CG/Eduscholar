import { z } from "zod";

// Référentiels de la plateforme : forme des entrées de l'écran
// d'administration. Rien ici n'est une règle de sécurité — la base revérifie
// chaque valeur, et décide seule de ce qui s'écrit, se crée ou se désactive.

/** Liste fermée, dans l'ordre du sélecteur. Le premier est le choix par défaut. */
export const REFERENCE_KINDS = [
  "countries",
  "languages",
  "resource_types",
  "education_levels",
  "academic_domains",
  "academic_programs",
  "program_specialties",
  "subjects",
  "licenses",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** Référentiel lu dans l'adresse : une valeur de la liste fermée, sinon le premier. */
export function referenceKind(value: unknown): ReferenceKind {
  return REFERENCE_KINDS.find((kind) => kind === value) ?? REFERENCE_KINDS[0];
}

type KindShape = {
  code: RegExp;
  /** Rattachement : domaine d'une filière, filière d'une spécialité ou d'une matière. */
  parent: "domain_code" | "program_code" | null;
  /** Le rattachement fait partie de la clé : il ne change jamais. */
  parentIsKey: boolean;
  hasPosition: boolean;
  hasIsced: boolean;
  canCreate: boolean;
  writable: boolean;
};

const SIMPLE_CODE = /^[a-z][a-z0-9_]{1,49}$/;
const plain = { parent: null, parentIsKey: false, hasPosition: false, hasIsced: false, canCreate: true, writable: true };

/** Ce que chaque référentiel porte. Sert à dessiner les formulaires ; la base tient les mêmes règles. */
export const REFERENCE_SHAPES: Record<ReferenceKind, KindShape> = {
  countries: { ...plain, code: /^[A-Z]{2}$/, canCreate: false },
  languages: { ...plain, code: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/ },
  resource_types: { ...plain, code: SIMPLE_CODE, hasPosition: true },
  education_levels: { ...plain, code: SIMPLE_CODE, hasPosition: true, hasIsced: true },
  academic_domains: { ...plain, code: SIMPLE_CODE },
  academic_programs: { ...plain, code: SIMPLE_CODE, parent: "domain_code" },
  program_specialties: { ...plain, code: SIMPLE_CODE, parent: "program_code", parentIsKey: true, hasPosition: true },
  subjects: { ...plain, code: SIMPLE_CODE, parent: "program_code", parentIsKey: true, hasPosition: true },
  licenses: { ...plain, code: /^[a-z0-9][a-z0-9.-]{1,49}$/, hasPosition: true, canCreate: false, writable: false },
};

/** Erreurs de champ propres aux formulaires des référentiels. */
export type ReferenceFieldErrorCode =
  | "invalid_reference_code"
  | "invalid_reference_label"
  | "invalid_position"
  | "invalid_isced";

// --- Lignes rendues par la base -------------------------------------------------

const itemSchema = z.object({
  code: z.string(),
  labels: z.record(z.string(), z.string()).nullable().catch(null),
  is_active: z.boolean(),
  usage_count: z.number().catch(0),
  is_interface: z.boolean().optional(),
  position: z.number().optional(),
  isced_level: z.number().nullable().optional(),
  domain_code: z.string().nullable().optional(),
  program_code: z.string().optional(),
  can_host: z.string().optional(),
  can_redistribute: z.string().optional(),
  allows_commercial_use: z.boolean().optional(),
  requires_attribution: z.boolean().optional(),
});

export type ReferenceItem = {
  code: string;
  /** Un libellé par langue ; `fr` et `en` sont toujours là. */
  labels: Record<string, string>;
  isActive: boolean;
  /** Nombre de profils, fiches ou projets qui portent ce code. */
  usageCount: number;
  isInterface: boolean;
  position: number | null;
  iscedLevel: number | null;
  /** Domaine d'une filière, ou filière d'une spécialité ou d'une matière. */
  parentCode: string | null;
  license: {
    canHost: string;
    canRedistribute: string;
    allowsCommercialUse: boolean;
    requiresAttribution: boolean;
  } | null;
};

/** Lit les lignes rendues par `admin_reference_items`. `null` si une ligne n'a pas la forme attendue. */
export function parseReferenceItems(rows: unknown[]): ReferenceItem[] | null {
  const parsed = z.array(itemSchema).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    code: row.code,
    labels: row.labels ?? {},
    isActive: row.is_active,
    usageCount: row.usage_count,
    isInterface: row.is_interface === true,
    position: row.position ?? null,
    iscedLevel: row.isced_level ?? null,
    parentCode: row.program_code ?? row.domain_code ?? null,
    license:
      row.can_host === undefined
        ? null
        : {
            canHost: row.can_host,
            canRedistribute: row.can_redistribute ?? "",
            allowsCommercialUse: row.allows_commercial_use === true,
            requiresAttribution: row.requires_attribution === true,
          },
  }));
}

/** Langues d'un libellé autres que le français et l'anglais, triées. */
export function otherLabelLanguages(labels: Record<string, string>): string[] {
  return Object.keys(labels)
    .filter((language) => language !== "fr" && language !== "en" && /^[a-z]{2,3}$/.test(language))
    .sort();
}

// --- Filtre et pagination, sur la liste déjà lue -----------------------------------

/** Texte de filtre lu dans l'adresse : rogné, cent caractères au plus. */
export function referenceQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();

/** Lignes dont le code, le rattachement ou un libellé contient le texte, sans égard aux accents ni à la casse. */
export function filterReferenceItems(items: ReferenceItem[], query: string): ReferenceItem[] {
  const needle = fold(query.trim());
  if (needle === "") return items;
  return items.filter((item) =>
    [item.code, item.parentCode ?? "", ...Object.values(item.labels)].some((text) => fold(text).includes(needle)),
  );
}

export const REFERENCE_PAGE_SIZE = 25;

export type ReferencePage = {
  items: ReferenceItem[];
  /** Page affichée, à partir de 1 ; ramenée à la dernière si l'adresse en demande trop. */
  page: number;
  pageCount: number;
  total: number;
};

/** Découpe la liste filtrée en pages. Le numéro lu dans l'adresse est borné à ce qui existe. */
export function paginateReferenceItems(items: ReferenceItem[], value: unknown): ReferencePage {
  const pageCount = Math.max(1, Math.ceil(items.length / REFERENCE_PAGE_SIZE));
  const asked = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : 1;
  const page = Math.min(Math.max(asked, 1), pageCount);
  return {
    items: items.slice((page - 1) * REFERENCE_PAGE_SIZE, page * REFERENCE_PAGE_SIZE),
    page,
    pageCount,
    total: items.length,
  };
}

// --- Formulaires ----------------------------------------------------------------------

// Cent vingt caractères, sans balise ni caractère de commande.
const label = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[<>]|\p{Cc}/u.test(value));

export type ReferenceSaveInput = {
  code: string;
  parentCode: string;
  /** Libellés saisis, par langue. Un libellé vide d'une autre langue que `fr` et `en` est retiré. */
  labels: Record<string, string>;
  position: string;
  iscedLevel: string;
};

export type ReferencePayload = {
  code: string;
  labels: Record<string, string>;
  position?: number;
  isced_level?: number | null;
  domain_code?: string;
  program_code?: string;
};

export type ReferenceSaveResult =
  | { ok: true; payload: ReferencePayload }
  | { ok: false; field: string; error: ReferenceFieldErrorCode | "invalid_choice" | "required" };

/**
 * Construit ce qui est envoyé à `admin_save_reference_item` : les seuls champs
 * que le référentiel admet. Rend le premier champ fautif sinon.
 */
export function buildReferencePayload(
  kind: ReferenceKind,
  input: ReferenceSaveInput,
  mode: "create" | "update",
): ReferenceSaveResult {
  const shape = REFERENCE_SHAPES[kind];
  const code = input.code.trim();
  if (code.length > 50 || !shape.code.test(code)) return { ok: false, field: "code", error: "invalid_reference_code" };

  const payload: ReferencePayload = { code, labels: {} };

  if (shape.parent) {
    const parent = input.parentCode.trim();
    // Un simple rattachement (le domaine d'une filière) peut rester tel qu'il
    // est à la modification ; celui qui fait partie de la clé est toujours donné.
    const optional = mode === "update" && !shape.parentIsKey && parent === "";
    if (!optional) {
      if (!SIMPLE_CODE.test(parent)) {
        return { ok: false, field: "parentCode", error: parent === "" ? "required" : "invalid_choice" };
      }
      payload[shape.parent] = parent;
    }
  }

  for (const language of Object.keys(input.labels).sort()) {
    if (!/^[a-z]{2,3}$/.test(language)) return { ok: false, field: `label_${language}`, error: "invalid_reference_label" };
    const required = language === "fr" || language === "en";
    const raw = input.labels[language] ?? "";
    // Un libellé facultatif laissé vide est retiré.
    if (!required && raw.trim() === "") continue;
    const parsed = label.safeParse(raw);
    if (!parsed.success) return { ok: false, field: `label_${language}`, error: "invalid_reference_label" };
    payload.labels[language] = parsed.data;
  }
  for (const language of ["fr", "en"]) {
    if (!payload.labels[language]) return { ok: false, field: `label_${language}`, error: "invalid_reference_label" };
  }

  if (shape.hasPosition) {
    const position = input.position.trim();
    if (!/^\d{1,5}$/.test(position)) return { ok: false, field: "position", error: "invalid_position" };
    payload.position = Number(position);
  }
  if (shape.hasIsced) {
    const isced = input.iscedLevel.trim();
    if (isced !== "" && !/^[0-8]$/.test(isced)) return { ok: false, field: "iscedLevel", error: "invalid_isced" };
    payload.isced_level = isced === "" ? null : Number(isced);
  }
  return { ok: true, payload };
}

/** Libellés saisis dans un formulaire : les champs `label_xx`. */
export function labelsFromForm(formData: FormData): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    const language = /^label_([a-z]{2,3})$/.exec(name)?.[1];
    if (language && typeof value === "string") labels[language] = value.slice(0, 200);
  }
  return labels;
}

/** Activer ou désactiver une ligne : le rattachement n'est donné que s'il fait partie de la clé. */
export const referenceActiveSchema = z.object({
  kind: z.enum(REFERENCE_KINDS),
  code: z.string().min(1).max(50),
  parentCode: z.string().max(50),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});
