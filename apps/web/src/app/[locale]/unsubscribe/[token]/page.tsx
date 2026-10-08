import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { unsubscribe } from "@/lib/notifications/actions";
import { UNSUBSCRIBE_TOKEN } from "@/lib/notifications/queries";

// Le jeton est dans l'adresse : la page n'est jamais gardée en cache.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Unsubscribe");
  // Le jeton est dans l'adresse : la page ne s'indexe pas et ne transmet pas son adresse.
  return { title: t("title"), robots: { index: false }, referrer: "no-referrer" };
}

/**
 * Désabonnement des courriels de notification, sans connexion. Ouvrir la page
 * ne fait rien : un logiciel de messagerie qui suit les liens d'un courriel ne
 * désabonne personne. La page ne dit pas si le lien est valable.
 */
export default async function UnsubscribePage({ params }: PageProps<"/[locale]/unsubscribe/[token]">) {
  const { token } = await params;
  if (token !== "done" && !UNSUBSCRIBE_TOKEN.test(token)) notFound();
  const t = await getTranslations("Unsubscribe");
  const footer = (
    <p>
      <Link href="/" className="underline underline-offset-4">
        {t("toHome")}
      </Link>
    </p>
  );

  if (token === "done") {
    return (
      <AuthPageShell title={t("title")} footer={footer}>
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("done")}
        </p>
        <p>{t("reactivate")}</p>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title={t("title")} footer={footer}>
      <p>{t("intro")}</p>
      <AuthForm action={unsubscribe} submitLabel={t("confirm")} pendingLabel={t("pending")}>
        <input type="hidden" name="token" value={token} />
      </AuthForm>
    </AuthPageShell>
  );
}
