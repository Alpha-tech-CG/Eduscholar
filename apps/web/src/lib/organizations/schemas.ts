import { z } from "zod";

// Organisations : forme des entrées. Rien ici n'est une règle de sécurité —
// la base revérifie chaque valeur et décide seule de qui peut quoi.

export const ORG_ROLES = ["org_admin", "librarian", "teacher", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_STATUSES = ["pending", "verified", "suspended"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

/** Erreurs de champ propres aux formulaires des organisations. */
export type OrganizationFieldErrorCode = "invalid_org_name" | "invalid_slug";

/** Jeton d'invitation : soixante-quatre chiffres hexadécimaux. */
export const ORG_INVITATION_TOKEN = /^[0-9a-f]{64}$/;

export const ORG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Nombre d'organisations par page de la liste d'administration. */
export const ORGANIZATION_PAGE_SIZE = 25;
const LAST_PAGE = 400;

/** Numéro de page lu dans l'adresse : un entier de 1 à 400, sinon 1. */
export function organizationPage(value: unknown): number {
  const page = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(page, 1), LAST_PAGE);
}

/** Il existe une page après celle-ci, d'après le nombre de lignes rendues. */
export function hasNextOrganizationPage(page: number, rowCount: number): boolean {
  return rowCount > ORGANIZATION_PAGE_SIZE && page < LAST_PAGE;
}

// Deux à deux cents caractères, sans caractère de contrôle.
const name = z
  .string()
  .trim()
  .min(2)
  .max(200)
  .refine((value) => !/\p{Cc}/u.test(value));

// Minuscules, chiffres et tirets simples, comme dans une adresse.
const slug = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const reason = z.string().trim().max(500);

export const createOrganizationSchema = z.object({
  name,
  slug,
  countryCode: z.union([z.literal(""), z.string().regex(/^[A-Z]{2}$/)]),
});

export const renameOrganizationSchema = z.object({ organizationId: z.uuid(), name, slug });

/** « verify » : en attente → vérifiée ; « restore » : suspendue → vérifiée. */
export const ORG_STATUS_INTENTS = ["verify", "suspend", "restore"] as const;
export type OrgStatusIntent = (typeof ORG_STATUS_INTENTS)[number];

export const organizationStatusSchema = z.object({
  organizationId: z.uuid(),
  intent: z.enum(ORG_STATUS_INTENTS),
  reason,
});

/** Suspendre et rétablir se motivent ; la base l'exige de toute façon. */
export function statusNeedsReason(intent: OrgStatusIntent): boolean {
  return intent !== "verify";
}

export const dissolveOrganizationSchema = z.object({ organizationId: z.uuid(), reason });

export const inviteOrgAdminSchema = z.object({ organizationId: z.uuid(), email });

export const inviteOrgMemberSchema = z.object({
  organizationId: z.uuid(),
  email,
  role: z.enum(ORG_ROLES),
});

export const orgMemberRoleSchema = z.object({
  organizationId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(ORG_ROLES),
});
