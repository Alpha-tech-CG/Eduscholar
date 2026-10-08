import { describe, expect, it } from "vitest";
import { producedValue, refusalCode, succeeded } from "@/lib/admin/responses";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { buildOrganizationInvitation } from "@/lib/mail/notices";
import {
  createOrganizationSchema,
  dissolveOrganizationSchema,
  hasNextOrganizationPage,
  inviteOrgAdminSchema,
  inviteOrgMemberSchema,
  ORG_INVITATION_TOKEN,
  ORG_UUID,
  ORGANIZATION_PAGE_SIZE,
  organizationPage,
  organizationStatusSchema,
  orgMemberRoleSchema,
  renameOrganizationSchema,
  statusNeedsReason,
} from "@/lib/organizations/schemas";

const id = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const jeton = "ab".repeat(32);

describe("formulaires des organisations", () => {
  it("création : nom, identifiant d'adresse, pays facultatif", () => {
    const parsed = createOrganizationSchema.safeParse({
      name: "  Université de Dakar  ",
      slug: "universite-de-dakar",
      countryCode: "",
    });
    expect(parsed.success && parsed.data).toEqual({
      name: "Université de Dakar",
      slug: "universite-de-dakar",
      countryCode: "",
    });
    expect(createOrganizationSchema.safeParse({ name: "UD", slug: "ud", countryCode: "SN" }).success).toBe(true);
  });

  it.each([
    ["nom trop court", { name: "U", slug: "ud", countryCode: "" }],
    ["nom trop long", { name: "x".repeat(201), slug: "ud", countryCode: "" }],
    ["nom à caractère de contrôle", { name: "Uni\u0007versité", slug: "ud", countryCode: "" }],
    ["identifiant en majuscules", { name: "Université", slug: "Universite", countryCode: "" }],
    ["identifiant accentué", { name: "Université", slug: "université", countryCode: "" }],
    ["identifiant à tiret double", { name: "Université", slug: "uni--dakar", countryCode: "" }],
    ["identifiant à tiret final", { name: "Université", slug: "uni-", countryCode: "" }],
    ["identifiant à barre oblique", { name: "Université", slug: "uni/dakar", countryCode: "" }],
    ["identifiant trop long", { name: "Université", slug: "a".repeat(81), countryCode: "" }],
    ["pays en minuscules", { name: "Université", slug: "ud", countryCode: "sn" }],
  ])("création refusée : %s", (_label, input) => {
    expect(createOrganizationSchema.safeParse(input).success).toBe(false);
  });

  it("renommage : mêmes règles, et un identifiant d'organisation", () => {
    expect(renameOrganizationSchema.safeParse({ organizationId: id, name: "Nouveau nom", slug: "nouveau" }).success).toBe(true);
    expect(renameOrganizationSchema.safeParse({ organizationId: "x", name: "Nouveau nom", slug: "nouveau" }).success).toBe(false);
    expect(renameOrganizationSchema.safeParse({ organizationId: id, name: "Nouveau nom", slug: "Nouveau" }).success).toBe(false);
  });

  it("état : trois intentions, motif exigé pour suspendre et pour rétablir", () => {
    for (const intent of ["verify", "suspend", "restore"]) {
      expect(organizationStatusSchema.safeParse({ organizationId: id, intent, reason: "" }).success).toBe(true);
    }
    expect(organizationStatusSchema.safeParse({ organizationId: id, intent: "dissolve", reason: "" }).success).toBe(false);
    expect(organizationStatusSchema.safeParse({ organizationId: id, intent: "suspend", reason: "x".repeat(501) }).success).toBe(false);
    expect(statusNeedsReason("verify")).toBe(false);
    expect(statusNeedsReason("suspend")).toBe(true);
    expect(statusNeedsReason("restore")).toBe(true);
  });

  it("dissolution : le motif est rogné", () => {
    const parsed = dissolveOrganizationSchema.safeParse({ organizationId: id, reason: "  Fermeture  " });
    expect(parsed.success && parsed.data.reason).toBe("Fermeture");
  });

  it("invitations : adresse mise en minuscules, rôle parmi les quatre", () => {
    const admin = inviteOrgAdminSchema.safeParse({ organizationId: id, email: "  Awa.Diop@Exemple.Invalid " });
    expect(admin.success && admin.data.email).toBe("awa.diop@exemple.invalid");
    expect(inviteOrgAdminSchema.safeParse({ organizationId: id, email: "pas-une-adresse" }).success).toBe(false);

    for (const role of ["org_admin", "librarian", "teacher", "member"]) {
      expect(inviteOrgMemberSchema.safeParse({ organizationId: id, email: "a@exemple.invalid", role }).success).toBe(true);
    }
    for (const role of ["", "platform_admin", "super_admin", "owner"]) {
      expect(inviteOrgMemberSchema.safeParse({ organizationId: id, email: "a@exemple.invalid", role }).success).toBe(false);
      expect(orgMemberRoleSchema.safeParse({ organizationId: id, userId: other, role }).success).toBe(false);
    }
    expect(orgMemberRoleSchema.safeParse({ organizationId: id, userId: other, role: "teacher" }).success).toBe(true);
    expect(orgMemberRoleSchema.safeParse({ organizationId: id, userId: "moi", role: "teacher" }).success).toBe(false);
  });

  it("jeton et identifiant : formes exactes", () => {
    expect(ORG_INVITATION_TOKEN.test(jeton)).toBe(true);
    expect(ORG_INVITATION_TOKEN.test(jeton.toUpperCase())).toBe(false);
    expect(ORG_INVITATION_TOKEN.test(`${jeton}0`)).toBe(false);
    expect(ORG_INVITATION_TOKEN.test(`${jeton.slice(2)}/.`)).toBe(false);
    expect(ORG_UUID.test(id)).toBe(true);
    expect(ORG_UUID.test("invitations")).toBe(false);
  });

  it("pagination : un entier borné, sinon la première page", () => {
    expect(organizationPage("3")).toBe(3);
    expect(organizationPage("0")).toBe(1);
    expect(organizationPage("999")).toBe(400);
    for (const value of [undefined, "", "-1", "1e3", "2.5", "abc", ["2"], "1000"]) {
      expect(organizationPage(value)).toBe(1);
    }
    expect(hasNextOrganizationPage(1, ORGANIZATION_PAGE_SIZE + 1)).toBe(true);
    expect(hasNextOrganizationPage(1, ORGANIZATION_PAGE_SIZE)).toBe(false);
    expect(hasNextOrganizationPage(400, ORGANIZATION_PAGE_SIZE + 1)).toBe(false);
  });
});

describe("réponses des fonctions d'administration des organisations", () => {
  const refusal = { data: { code: "42501", message: "own_organization" }, error: null, status: 403 };

  it("une écriture n'est faite que si la réponse est un succès sans erreur ni contenu", () => {
    expect(succeeded({ data: null, error: null, status: 200 })).toBe(true);
    expect(succeeded({ data: null, error: null, status: 204 })).toBe(true);
    expect(succeeded(refusal)).toBe(false);
    // Un refus que le client de l'API présenterait comme un succès reste un refus.
    expect(succeeded({ ...refusal, status: 200 })).toBe(false);
    expect(succeeded({ data: null, error: null, status: 403 })).toBe(false);
    expect(succeeded({ data: null, error: { message: "not_found" }, status: 400 })).toBe(false);
  });

  it("une création ou une invitation n'est faite que si la valeur attendue est rendue", () => {
    expect(producedValue({ data: { id }, error: null, status: 200 }, "id", ORG_UUID)).toBe(id);
    expect(producedValue({ data: { token: jeton }, error: null, status: 200 }, "token", ORG_INVITATION_TOKEN)).toBe(jeton);
    expect(producedValue(refusal, "token", ORG_INVITATION_TOKEN)).toBeNull();
    expect(producedValue({ data: { token: jeton }, error: null, status: 403 }, "token", ORG_INVITATION_TOKEN)).toBeNull();
    expect(producedValue({ data: { token: "court" }, error: null, status: 200 }, "token", ORG_INVITATION_TOKEN)).toBeNull();
    expect(producedValue({ data: { id: jeton }, error: null, status: 200 }, "token", ORG_INVITATION_TOKEN)).toBeNull();
    expect(producedValue({ data: null, error: null, status: 200 }, "id", ORG_UUID)).toBeNull();
    expect(producedValue({ data: [{ id }], error: null, status: 200 }, "id", ORG_UUID)).toBeNull();
    expect(producedValue({ data: { id }, error: { message: "x" }, status: 200 }, "id", ORG_UUID)).toBeNull();
  });

  it("le code d'un refus vient de l'erreur ou, à défaut, du corps rendu", () => {
    expect(refusalCode(refusal)).toBe("own_organization");
    expect(refusalCode({ data: { code: "42501", message: "recent_second_factor_required" }, error: null })).toBe(
      "recent_second_factor_required",
    );
    expect(refusalCode({ data: null, error: { code: "P0001", message: "slug_taken" } })).toBe("slug_taken");
    expect(refusalCode({ data: null, error: { code: "22023", message: "invalid_payload" } })).toBe("validation");
    expect(refusalCode({ data: null, error: null })).toBe("forbidden");
    expect(refusalCode({ data: [], error: null })).toBe("forbidden");
    // Un message inattendu n'est jamais relayé tel quel.
    expect(refusalCode({ data: { code: "42501", message: "détail interne" }, error: null })).toBe("forbidden");
    expect(refusalCode({ data: null, error: { code: "XX000", message: "détail interne" } })).toBe("unavailable");
  });

  it.each(["last_org_admin", "own_organization", "slug_taken", "org_admin_exists", "organization_has_resources"])(
    "« %s » est un code affichable",
    (message) => {
      expect(catalogueErrorCode({ code: "P0001", message })).toBe(message);
    },
  );
});

describe("invitation à rejoindre une organisation", () => {
  const link = `https://plateforme.exemple.invalid/fr/organizations/invitations/${jeton}`;
  const { subject, text, html } = buildOrganizationInvitation(link);

  it("est bilingue", () => {
    expect(subject).toBe(
      "EduScholar — Invitation à rejoindre une organisation / Invitation to join an organisation",
    );
    for (const body of [text, html]) {
      expect(body).toContain("Bonjour,");
      expect(body).toContain("Hello,");
      expect(body).toContain("rejoindre une organisation");
      expect(body).toContain("join an organisation");
    }
  });

  it("porte un seul lien, celui de la plateforme, répété dans chaque langue", () => {
    expect(text.split(link).length - 1).toBe(2);
    expect(html.match(/<a\b/g)).toHaveLength(2);
    expect(html.match(/href="/g)).toHaveLength(2);
    expect(html.split(`href="${link}"`).length - 1).toBe(2);
    for (const body of [text, html]) {
      expect(body.split(link).join("")).not.toMatch(/https?:\/\/|www\./i);
    }
    expect(html).not.toMatch(/<script|<img/i);
  });

  it("ne nomme ni l'organisation, ni le rôle, ni personne : seul le lien varie", () => {
    const autre = `https://plateforme.exemple.invalid/en/organizations/invitations/${"cd".repeat(32)}`;
    const second = buildOrganizationInvitation(autre);
    expect(second.subject).toBe(subject);
    expect(second.text.split(autre).join("LIEN")).toBe(text.split(link).join("LIEN"));
    expect(second.html.split(autre).join("LIEN")).toBe(html.split(link).join("LIEN"));
    // La fonction ne reçoit que le lien : aucun nom, aucune adresse, aucun guillemet de citation.
    expect(buildOrganizationInvitation.length).toBe(1);
    for (const body of [text, html.replace(/style="[^"]*"/g, "")]) {
      expect(body.split(link).join("")).not.toMatch(/@|«|“|\d{6,}|[0-9a-f]{20,}/i);
    }
  });

  it("échappe le lien dans le HTML", () => {
    const forged = 'https://exemple.invalid/"><b>x</b>';
    expect(buildOrganizationInvitation(forged).html).not.toContain("<b>");
  });
});
