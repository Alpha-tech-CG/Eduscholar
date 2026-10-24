import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField, ToggleField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link, redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { savePrivacy } from "@/lib/profile/actions";
import { getOwnProfile, getOwnPublicProfile } from "@/lib/profile/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Privacy");
  return { title: t("title"), robots: { index: false } };
}

export default async function PrivacyPage() {
  await requireUser("/account/privacy");
  const locale = await getLocale();

  // Rien ne se publie avant la complétion du profil (règle de la base).
  const profile = await getOwnProfile();
  if (!profile?.onboarded) {
    return redirect({ href: "/account/profile", locale });
  }

  const [settings, t] = await Promise.all([getOwnPublicProfile(), getTranslations("Privacy")]);

  return (
    <AuthPageShell
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/account" className="underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      }
    >
      <AuthForm action={savePrivacy} submitLabel={t("submit")} pendingLabel={t("pending")}>
        <OptionalTextField
          name="displayName"
          label={t("displayName")}
          hint={t("displayNameHint")}
          defaultValue={settings?.displayName ?? undefined}
          maxLength={80}
        />
        <ToggleField
          name="isPublic"
          label={t("isPublic")}
          hint={t("isPublicHint")}
          defaultChecked={settings?.isPublic ?? false}
        />
      </AuthForm>
      <p className="text-sm opacity-70">{t("requestsNote")}</p>
    </AuthPageShell>
  );
}
