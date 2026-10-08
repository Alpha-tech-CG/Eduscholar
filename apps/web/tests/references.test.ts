import { describe, expect, it } from "vitest";
import { producedFlag, producedRows, refusalCode } from "@/lib/admin/responses";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import {
  buildReferencePayload,
  filterReferenceItems,
  labelsFromForm,
  otherLabelLanguages,
  paginateReferenceItems,
  parseReferenceItems,
  REFERENCE_KINDS,
  REFERENCE_PAGE_SIZE,
  REFERENCE_SHAPES,
  referenceActiveSchema,
  referenceKind,
  referenceQuery,
  type ReferenceItem,
} from "@/lib/references/schemas";

const item = (code: string, fr: string, en: string, more: Partial<ReferenceItem> = {}): ReferenceItem => ({
  code,
  labels: { fr, en },
  isActive: true,
  usageCount: 0,
  isInterface: false,
  position: null,
  iscedLevel: null,
  parentCode: null,
  license: null,
  ...more,
});

const input = { code: "reseaux", parentCode: "", labels: { fr: "Réseaux", en: "Networks" }, position: "", iscedLevel: "" };

describe("choix du référentiel", () => {
  it("n'admet que la liste fermée ; toute autre valeur donne le premier", () => {
    expect(REFERENCE_KINDS[0]).toBe("countries");
    for (const kind of REFERENCE_KINDS) expect(referenceKind(kind)).toBe(kind);
    for (const value of [undefined, "", "profiles", "auth.users", "Subjects", ["subjects"], "subjects;drop", 3]) {
      expect(referenceKind(value)).toBe("countries");
    }
  });

  it("les pays ne se créent pas, les licences ne s'écrivent pas", () => {
    expect(REFERENCE_SHAPES.countries).toMatchObject({ canCreate: false, writable: true });
    expect(REFERENCE_SHAPES.licenses).toMatchObject({ canCreate: false, writable: false });
    const creatable = REFERENCE_KINDS.filter((kind) => REFERENCE_SHAPES[kind].canCreate);
    expect(creatable).toEqual([
      "languages",
      "resource_types",
      "education_levels",
      "academic_domains",
      "academic_programs",
      "program_specialties",
      "subjects",
    ]);
  });
});

describe("lignes rendues par la base", () => {
  it("lit chaque forme de ligne", () => {
    const rows = parseReferenceItems([
      { code: "SN", labels: { fr: "Sénégal", en: "Senegal" }, is_active: true, usage_count: 3 },
      { code: "fr", labels: { fr: "Français", en: "French" }, is_active: true, is_interface: true, usage_count: 0 },
      { code: "licence", labels: { fr: "Licence", en: "Bachelor" }, is_active: false, position: 20, isced_level: 6, usage_count: 1 },
      { code: "informatique", domain_code: "sciences", labels: { fr: "Informatique", en: "Computing" }, is_active: true, usage_count: 0 },
      { program_code: "informatique", code: "reseaux", labels: { fr: "Réseaux", en: "Networks", pt: "Redes" }, is_active: true, position: 5, usage_count: 2 },
      {
        code: "cc-by-4.0", labels: { fr: "CC BY 4.0", en: "CC BY 4.0" }, is_active: true, position: 10, can_host: "yes",
        can_redistribute: "review", allows_commercial_use: true, requires_attribution: true, read_only: true, usage_count: 9,
      },
    ]);
    expect(rows).not.toBeNull();
    const [country, language, level, program, subject, license] = rows ?? [];
    expect(country).toMatchObject({ code: "SN", usageCount: 3, parentCode: null, license: null });
    expect(language?.isInterface).toBe(true);
    expect(level).toMatchObject({ isActive: false, position: 20, iscedLevel: 6 });
    expect(program?.parentCode).toBe("sciences");
    expect(subject).toMatchObject({ parentCode: "informatique", position: 5 });
    expect(otherLabelLanguages(subject?.labels ?? {})).toEqual(["pt"]);
    expect(license?.license).toEqual({
      canHost: "yes",
      canRedistribute: "review",
      allowsCommercialUse: true,
      requiresAttribution: true,
    });
  });

  it("refuse une liste dont une ligne n'a pas la forme attendue", () => {
    expect(parseReferenceItems([{ code: "SN", labels: {}, usage_count: 0 }])).toBeNull();
    expect(parseReferenceItems([{ labels: {}, is_active: true }])).toBeNull();
    expect(parseReferenceItems(["SN"])).toBeNull();
    expect(parseReferenceItems([])).toEqual([]);
  });

  it("une lecture refusée n'est pas une liste, une écriture refusée n'est pas faite", () => {
    const refusal = { data: { code: "42501", message: "recent_second_factor_required" }, error: null, status: 403 };
    expect(producedRows(refusal)).toBeNull();
    expect(producedRows({ data: [], error: null, status: 403 })).toBeNull();
    expect(producedRows({ data: [], error: { message: "rate_limited" }, status: 200 })).toBeNull();
    expect(producedRows({ data: [{ code: "SN" }], error: null, status: 200 })).toEqual([{ code: "SN" }]);

    expect(producedFlag({ data: { created: true }, error: null, status: 200 }, "created")).toBe(true);
    expect(producedFlag({ data: { created: false }, error: null, status: 200 }, "created")).toBe(false);
    expect(producedFlag(refusal, "created")).toBeNull();
    expect(producedFlag({ data: { created: true }, error: null, status: 403 }, "created")).toBeNull();
    expect(producedFlag({ data: { created: "true" }, error: null, status: 200 }, "created")).toBeNull();
    expect(producedFlag({ data: null, error: null, status: 200 }, "created")).toBeNull();
    expect(refusalCode(refusal)).toBe("recent_second_factor_required");
  });

  it.each(["read_only_reference", "last_active", "protected_reference"])("« %s » est un code affichable", (message) => {
    expect(catalogueErrorCode({ code: "P0001", message })).toBe(message);
  });
});

describe("filtre et pagination", () => {
  const items = [
    item("SN", "Sénégal", "Senegal"),
    item("CI", "Côte d'Ivoire", "Ivory Coast"),
    item("reseaux", "Réseaux", "Networks", { parentCode: "informatique", labels: { fr: "Réseaux", en: "Networks", pt: "Redes" } }),
  ];

  it("cherche dans le code, le rattachement et tous les libellés, sans accents ni casse", () => {
    const codes = (query: string) => filterReferenceItems(items, query).map(({ code }) => code);
    expect(codes("")).toEqual(["SN", "CI", "reseaux"]);
    expect(codes("   ")).toEqual(["SN", "CI", "reseaux"]);
    expect(codes("sn")).toEqual(["SN"]);
    expect(codes("senegal")).toEqual(["SN"]);
    expect(codes("SÉNÉGAL")).toEqual(["SN"]);
    expect(codes("cote d'iv")).toEqual(["CI"]);
    expect(codes("ivory")).toEqual(["CI"]);
    expect(codes("redes")).toEqual(["reseaux"]);
    expect(codes("informatique")).toEqual(["reseaux"]);
    expect(codes("introuvable")).toEqual([]);
    // Un texte de filtre n'est jamais lu comme un motif.
    expect(codes(".*")).toEqual([]);
  });

  it("borne le texte de filtre", () => {
    expect(referenceQuery("  réseaux ")).toBe("réseaux");
    expect(referenceQuery("x".repeat(300))).toHaveLength(100);
    for (const value of [undefined, null, 3, ["a"]]) expect(referenceQuery(value)).toBe("");
  });

  it("découpe en pages et ramène un numéro hors bornes à ce qui existe", () => {
    const many = Array.from({ length: REFERENCE_PAGE_SIZE * 2 + 3 }, (_, index) => item(`c${index}`, "a", "b"));
    expect(paginateReferenceItems(many, undefined)).toMatchObject({ page: 1, pageCount: 3, total: many.length });
    expect(paginateReferenceItems(many, "1").items).toHaveLength(REFERENCE_PAGE_SIZE);
    expect(paginateReferenceItems(many, "3").items.map(({ code }) => code)).toEqual(
      many.slice(-3).map(({ code }) => code),
    );
    expect(paginateReferenceItems(many, "99").page).toBe(3);
    for (const value of ["0", "-1", "abc", "1.5", ["2"], "1000"]) {
      expect(paginateReferenceItems(many, value).page).toBe(1);
    }
    expect(paginateReferenceItems([], "4")).toMatchObject({ page: 1, pageCount: 1, total: 0, items: [] });
  });
});

describe("formulaire d'une ligne", () => {
  it("n'envoie que les champs que le référentiel admet", () => {
    expect(buildReferencePayload("academic_domains", { ...input, position: "7", iscedLevel: "3" }, "create")).toEqual({
      ok: true,
      payload: { code: "reseaux", labels: { fr: "Réseaux", en: "Networks" } },
    });
    expect(buildReferencePayload("resource_types", { ...input, position: "7" }, "create")).toEqual({
      ok: true,
      payload: { code: "reseaux", labels: { fr: "Réseaux", en: "Networks" }, position: 7 },
    });
    expect(buildReferencePayload("education_levels", { ...input, position: "30", iscedLevel: "6" }, "update")).toEqual({
      ok: true,
      payload: { code: "reseaux", labels: { fr: "Réseaux", en: "Networks" }, position: 30, isced_level: 6 },
    });
    expect(buildReferencePayload("education_levels", { ...input, position: "30" }, "update")).toMatchObject({
      ok: true,
      payload: { isced_level: null },
    });
    expect(
      buildReferencePayload("subjects", { ...input, parentCode: "informatique", position: "0" }, "create"),
    ).toEqual({
      ok: true,
      payload: { code: "reseaux", labels: { fr: "Réseaux", en: "Networks" }, program_code: "informatique", position: 0 },
    });
    expect(buildReferencePayload("academic_programs", { ...input, parentCode: "sciences" }, "create")).toMatchObject({
      ok: true,
      payload: { domain_code: "sciences" },
    });
  });

  it("le rattachement est exigé, sauf pour laisser tel quel le domaine d'une filière", () => {
    expect(buildReferencePayload("subjects", { ...input, position: "0" }, "create")).toMatchObject({
      ok: false,
      field: "parentCode",
      error: "required",
    });
    expect(buildReferencePayload("subjects", { ...input, position: "0" }, "update")).toMatchObject({ ok: false, field: "parentCode" });
    expect(buildReferencePayload("academic_programs", input, "create")).toMatchObject({ ok: false, field: "parentCode" });
    const kept = buildReferencePayload("academic_programs", input, "update");
    expect(kept.ok && "domain_code" in kept.payload).toBe(false);
    expect(buildReferencePayload("subjects", { ...input, parentCode: "Informatique", position: "0" }, "create")).toMatchObject({
      ok: false,
      field: "parentCode",
      error: "invalid_choice",
    });
  });

  it.each([
    ["academic_domains", "Reseaux"],
    ["academic_domains", "1reseaux"],
    ["academic_domains", "réseaux"],
    ["academic_domains", "r"],
    ["academic_domains", "reseaux-info"],
    ["academic_domains", `a${"b".repeat(50)}`],
    ["countries", "sn"],
    ["countries", "SEN"],
    ["languages", "FR"],
    ["languages", "français"],
  ] as const)("%s : le code « %s » est refusé", (kind, code) => {
    expect(buildReferencePayload(kind, { ...input, code }, "create")).toMatchObject({
      ok: false,
      field: "code",
      error: "invalid_reference_code",
    });
  });

  it("admet les codes de pays et de langue", () => {
    expect(buildReferencePayload("countries", { ...input, code: "SN" }, "update").ok).toBe(true);
    expect(buildReferencePayload("languages", { ...input, code: "pt-BR" }, "create").ok).toBe(true);
  });

  it("libellés : français et anglais obligatoires, rognés, sans balise ni caractère de commande", () => {
    const labels = (value: Record<string, string>) => buildReferencePayload("academic_domains", { ...input, labels: value }, "update");
    expect(labels({ fr: "  Réseaux  ", en: " Networks " })).toMatchObject({
      ok: true,
      payload: { labels: { fr: "Réseaux", en: "Networks" } },
    });
    expect(labels({ fr: "Réseaux" })).toMatchObject({ ok: false, field: "label_en" });
    expect(labels({ en: "Networks" })).toMatchObject({ ok: false, field: "label_fr" });
    expect(labels({ fr: "   ", en: "Networks" })).toMatchObject({ ok: false, field: "label_fr" });
    expect(labels({ fr: "<b>Réseaux</b>", en: "Networks" })).toMatchObject({ ok: false, field: "label_fr" });
    expect(labels({ fr: "Réseaux", en: "Net\u0007works" })).toMatchObject({ ok: false, field: "label_en" });
    expect(labels({ fr: "x".repeat(121), en: "Networks" })).toMatchObject({ ok: false, field: "label_fr" });
    expect(labels({ fr: "x".repeat(120), en: "Networks" }).ok).toBe(true);
  });

  it("autres langues : gardées si remplies, retirées si vides", () => {
    const built = buildReferencePayload(
      "academic_domains",
      { ...input, labels: { fr: "Réseaux", en: "Networks", pt: "Redes", ar: "   " } },
      "update",
    );
    expect(built).toMatchObject({ ok: true, payload: { labels: { fr: "Réseaux", en: "Networks", pt: "Redes" } } });
    expect(built.ok && "ar" in built.payload.labels).toBe(false);
  });

  it("position et niveau CITE : des entiers bornés", () => {
    const position = (value: string) => buildReferencePayload("resource_types", { ...input, position: value }, "update");
    expect(position("99999").ok).toBe(true);
    for (const value of ["", "-1", "1.5", "100000", "dix", "1e3"]) {
      expect(position(value)).toMatchObject({ ok: false, field: "position", error: "invalid_position" });
    }
    const isced = (value: string) =>
      buildReferencePayload("education_levels", { ...input, position: "1", iscedLevel: value }, "update");
    expect(isced("8").ok).toBe(true);
    for (const value of ["9", "-1", "10", "x"]) {
      expect(isced(value)).toMatchObject({ ok: false, field: "iscedLevel", error: "invalid_isced" });
    }
  });

  it("ne lit dans le formulaire que les champs de libellé", () => {
    const form = new FormData();
    form.set("label_fr", "Réseaux");
    form.set("label_en", "Networks");
    form.set("label_pt", "Redes");
    form.set("label_", "x");
    form.set("label_FR", "x");
    form.set("label_toolong", "x");
    form.set("is_active", "true");
    form.set("code", "reseaux");
    expect(labelsFromForm(form)).toEqual({ fr: "Réseaux", en: "Networks", pt: "Redes" });
  });

  it("activer ou désactiver : référentiel de la liste fermée, drapeau explicite", () => {
    const parsed = referenceActiveSchema.safeParse({ kind: "subjects", code: "reseaux", parentCode: "informatique", active: "false" });
    expect(parsed.success && parsed.data.active).toBe(false);
    expect(referenceActiveSchema.safeParse({ kind: "profiles", code: "x", parentCode: "", active: "true" }).success).toBe(false);
    expect(referenceActiveSchema.safeParse({ kind: "subjects", code: "", parentCode: "", active: "true" }).success).toBe(false);
    expect(referenceActiveSchema.safeParse({ kind: "subjects", code: "x", parentCode: "", active: "oui" }).success).toBe(false);
  });
});
