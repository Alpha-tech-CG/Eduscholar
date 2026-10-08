import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { requestAccess } from "@/lib/projects/sharing-actions";
import { INVITATION_TOKEN } from "@/lib/projects/sharing-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Sharing");
  // Le jeton est dans l'adresse : la page ne s'indexe pas et ne transmet pas son adresse.
  return { title: t("join.title"), robots: { index: false }, referrer: "no-referrer" };
}

/**
 * Lien de partage d'un projet. Il ne donne aucun droit et la page ne dit rien
 * du projet, que le lien soit valable ou non : on peut seulement demander à le
 * suivre, et c'est son propriétaire qui décide.
 */
export default async function JoinPage({ params }: PageProps<"/[locale]/join/[token]">) {
  const { token } = await params;
  const valid = INVITATION_TOKEN.test(token);
  const { user } = await requireOnboardedUser(valid ? `/join/${token}` : "/shared");
  const t = await getTranslations("Sharing");

  return (
    <AuthPageShell
      title={t("join.title")}
      footer={
        <p>
          <Link href="/shared" className="underline underline-offset-4">
            {t("toShared")}
          </Link>
        </p>
      }
    >
      <p>{t("join.intro")}</p>
      <p className="text-sm opacity-80">{t("join.disclosure", { email: user.email ?? "" })}</p>
      <AuthForm action={requestAccess} submitLabel={t("join.request")} pendingLabel={t("pending")}>
        <input type="hidden" name="token" value={valid ? token : ""} />
      </AuthForm>
    </AuthPageShell>
  );
}
