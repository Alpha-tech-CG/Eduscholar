"use client";

import { useTranslations } from "next-intl";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { setAccountStatus, setRole } from "@/lib/admin/actions";

type AccountActionsProps = {
  userId: string;
  roles: string[];
  suspended: boolean;
  /** Rang de l'administrateur : 2 administrateur, 3 super-administrateur. */
  adminRank: number;
};

const RANK: Record<string, number> = { moderator: 1, platform_admin: 2, super_admin: 3 };

/**
 * Actions possibles sur un compte. La liste n'est qu'un confort : la base
 * refuse toute opération qui n'est pas permise à l'appelant.
 */
export function AccountActions({ userId, roles, suspended, adminRank }: AccountActionsProps) {
  const t = useTranslations("Admin");
  const targetRank = Math.max(0, ...roles.map((role) => RANK[role] ?? 0));
  const manageable = (["moderator", "platform_admin"] as const).filter(
    (role) => role === "moderator" || adminRank >= 3,
  );

  return (
    <div className="flex flex-col gap-4">
      {manageable.map((role) => {
        const held = roles.includes(role);
        return (
          <AuthForm
            key={role}
            action={setRole}
            submitLabel={t(held ? "revoke" : "grant", { role: t(`roles.${role}`) })}
            pendingLabel={t("pending")}
            destructive={held}
          >
            <input type="hidden" name="targetUser" value={userId} />
            <input type="hidden" name="role" value={role} />
            <input type="hidden" name="grant" value={held ? "false" : "true"} />
          </AuthForm>
        );
      })}

      {targetRank >= adminRank ? (
        <p className="text-sm opacity-70">{t("cannotSuspend")}</p>
      ) : suspended ? (
        <AuthForm action={setAccountStatus} submitLabel={t("restore")} pendingLabel={t("pending")}>
          <input type="hidden" name="targetUser" value={userId} />
          <input type="hidden" name="suspended" value="false" />
          <input type="hidden" name="reason" value="" />
        </AuthForm>
      ) : (
        <AuthForm
          action={setAccountStatus}
          submitLabel={t("suspend")}
          pendingLabel={t("pending")}
          destructive
        >
          <input type="hidden" name="targetUser" value={userId} />
          <input type="hidden" name="suspended" value="true" />
          <OptionalTextField
            name="reason"
            label={t("reason")}
            hint={t("reasonHint")}
            maxLength={500}
            rows={2}
            required
          />
        </AuthForm>
      )}
    </div>
  );
}
