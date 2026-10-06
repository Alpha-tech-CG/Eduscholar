import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm, CheckboxField, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { deleteAccount } from "@/lib/account/actions";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("DeleteAccount");
  return { title: t("title"), robots: { index: false } };
}

export default async function DeleteAccountPage() {
  const user = await requireUser("/account/delete");
  const t = await getTranslations("DeleteAccount");

  return (
    <AuthPageShell
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/account" className="underline underline-offset-4">
            {t("cancel")}
          </Link>
        </p>
      }
    >
      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("account")}</dt>
        <dd className="font-medium">{user.email}</dd>
      </dl>
      <ul className="list-disc ps-5 text-sm">
        <li>{t("consequenceData")}</li>
        <li>{t("consequenceIrreversible")}</li>
        <li>{t("consequenceAudit")}</li>
      </ul>
      <AuthForm
        action={deleteAccount}
        submitLabel={t("submit")}
        pendingLabel={t("pending")}
        destructive
      >
        <TextField
          name="password"
          type="password"
          autoComplete="current-password"
          label={t("password")}
        />
        <CheckboxField name="confirmDeletion" label={t("confirm")} />
      </AuthForm>
    </AuthPageShell>
  );
}
