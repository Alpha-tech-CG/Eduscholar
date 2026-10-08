import "server-only";
import { z } from "zod";
import { createSessionClient } from "@/lib/supabase/server";
import {
  hasNextOrganizationPage,
  ORG_INVITATION_TOKEN,
  ORG_ROLES,
  ORG_STATUSES,
  ORG_UUID,
  ORGANIZATION_PAGE_SIZE,
  type OrgRole,
  type OrgStatus,
} from "./schemas";

// Organisations. Tout est lu par des fonctions de la base, sous la session de
// l'utilisateur : ce sont elles qui vérifient, à chaque appel, qu'il administre
// la plateforme, administre l'organisation demandée, ou en est membre. Aucune
// table d'organisation n'est lue directement.

const role = z.enum(ORG_ROLES);
const status = z.enum(ORG_STATUSES);

export type AdminOrganization = {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  countryCode: string | null;
  memberCount: number;
  adminCount: number;
  /** Motif de la suspension en cours. */
  suspensionReason: string | null;
  createdAt: string;
  /** Un administrateur de reprise a été invité depuis la suspension. */
  recoverySinceSuspension: boolean;
};

export type AdminOrganizationList = {
  organizations: AdminOrganization[];
  /** Page affichée, à partir de 1. */
  page: number;
  /** Il existe une page suivante. */
  hasNext: boolean;
};

/** Organisations de la plateforme, page par page. `null` si la lecture échoue ou est refusée. */
export async function listOrganizations(page = 1): Promise<AdminOrganizationList | null> {
  const supabase = await createSessionClient();
  // Une organisation de plus que la page : elle dit s'il y en a une suivante.
  const { data, error, status: httpStatus } = await supabase.rpc("admin_list_organizations", {
    page_limit: ORGANIZATION_PAGE_SIZE + 1,
    page_offset: (page - 1) * ORGANIZATION_PAGE_SIZE,
  });
  // Une lecture refusée ne rend aucune ligne : elle ne passe pas pour une liste vide.
  if (error || httpStatus !== 200) return null;

  const rows = data ?? [];
  return {
    organizations: rows.slice(0, ORGANIZATION_PAGE_SIZE).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: status.catch("pending").parse(row.status),
      countryCode: row.country_code,
      memberCount: Number(row.member_count),
      adminCount: Number(row.admin_count),
      suspensionReason: row.suspension_reason,
      createdAt: row.created_at,
      recoverySinceSuspension: row.recovery_since_suspension === true,
    })),
    page,
    hasNext: hasNextOrganizationPage(page, rows.length),
  };
}

export type MyOrganization = {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  role: OrgRole;
  joinedAt: string;
};

/** Organisations dont l'utilisateur est membre, suspendues comprises. `null` si la lecture échoue. */
export async function getMyOrganizations(): Promise<MyOrganization[] | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("my_organizations");
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.organization_id,
    slug: row.slug,
    name: row.name,
    status: status.catch("pending").parse(row.status),
    role: role.catch("member").parse(row.role),
    joinedAt: row.joined_at,
  }));
}

const membersSchema = z.object({
  members: z.array(
    z.object({ user_id: z.uuid(), email: z.string().nullable(), role, joined_at: z.string() }),
  ),
  invitations: z.array(
    z.object({ id: z.uuid(), email: z.string(), role, expires_at: z.string(), created_at: z.string() }),
  ),
  platform_invitation_pending: z.boolean(),
});

export type OrganizationMembers = {
  members: { userId: string; email: string | null; role: OrgRole; joinedAt: string }[];
  invitations: { id: string; email: string; role: OrgRole; expiresAt: string }[];
  /** La plateforme a invité un administrateur, qui n'a pas encore accepté. */
  platformInvitationPending: boolean;
};

export type LoadedOrganizationMembers =
  | { status: "ok"; data: OrganizationMembers }
  /** Organisation inexistante, suspendue, ou que l'utilisateur n'administre pas : même réponse. */
  | { status: "not_found" }
  /** Trop de lectures : la base ne le dit qu'à un administrateur de l'organisation. */
  | { status: "rate_limited" };

/** Membres et invitations en attente d'une organisation, pour son administrateur. */
export async function getOrganizationMembers(organizationId: string): Promise<LoadedOrganizationMembers> {
  if (!ORG_UUID.test(organizationId)) return { status: "not_found" };
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("org_members", { organization_id: organizationId });
  if (error) return { status: error.message === "rate_limited" ? "rate_limited" : "not_found" };
  const parsed = membersSchema.safeParse(data);
  if (!parsed.success) return { status: "not_found" };

  return {
    status: "ok",
    data: {
      members: parsed.data.members.map((member) => ({
        userId: member.user_id,
        email: member.email,
        role: member.role,
        joinedAt: member.joined_at,
      })),
      invitations: parsed.data.invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expires_at,
      })),
      platformInvitationPending: parsed.data.platform_invitation_pending,
    },
  };
}

const previewSchema = z.object({
  organization_name: z.string(),
  role,
  requires_second_factor: z.boolean(),
});

export type OrgInvitationPreview = {
  organizationName: string;
  role: OrgRole;
  /** Le rôle exige un second facteur que le compte n'a pas encore. */
  requiresSecondFactor: boolean;
};

/**
 * Ce que désigne un jeton d'invitation, s'il est valable et adressé à
 * l'utilisateur connecté. `null` dans tous les autres cas, sans distinction.
 */
export async function getOrgInvitationPreview(token: string): Promise<OrgInvitationPreview | null> {
  if (!ORG_INVITATION_TOKEN.test(token)) return null;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("org_invitation_preview", { token });
  const parsed = previewSchema.safeParse(data);
  if (error || !parsed.success) return null;
  return {
    organizationName: parsed.data.organization_name,
    role: parsed.data.role,
    requiresSecondFactor: parsed.data.requires_second_factor,
  };
}
