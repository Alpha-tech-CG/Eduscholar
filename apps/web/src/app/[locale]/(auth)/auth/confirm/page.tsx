import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { confirmEmailToken, signOut } from "@/lib/auth/actions";
import { confirmTokenSchema } from "@/lib/auth/schemas";
import { getCurrentUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.confirm");
  return {
    title: t("title"),
    robots: { index: false },
    // Le jeton est dans l'adresse : il ne doit partir vers aucun autre site.
    referrer: "no-referrer",
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Page d'arrivée des liens reçus par courriel. Elle ne consomme pas le jeton :
 * c'est le bouton qui le fait. Un logiciel qui ouvre le lien pour l'analyser ne
 * valide donc rien à la place de l'utilisateur.
 */
export default async function ConfirmPage({
  searchParams,
}: PageProps<"/[locale]/auth/confirm">) {
  const params = await searchParams;
  const parsed = confirmTokenSchema.safeParse({
    tokenHash: first(params.token_hash),
    type: first(params.type),
  });
  const t = await getTranslations("Auth");

  if (!parsed.success) {
    return (
      <AuthPageShell title={t("confirm.title")}>
        <p role="alert">{t("errors.invalid_link")}</p>
        <p>
          <Link href="/sign-in" className="underline underline-offset-4">
            {t("signIn.title")}
          </Link>
        </p>
      </AuthPageShell>
    );
  }

  // Une personne déjà connectée ne voit pas sa session remplacée par celle
  // d'un autre compte : elle doit d'abord se déconnecter.
  const user = await getCurrentUser();
  if (user) {
    return (
      <AuthPageShell title={t("confirm.signedInTitle")}>
        <p role="alert">{t("confirm.signedIn", { email: user.email ?? "" })}</p>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded border border-foreground/30 px-4 py-2 font-medium"
          >
            {t("confirm.signOutFirst")}
          </button>
        </form>
      </AuthPageShell>
    );
  }

  const isRecovery = parsed.data.type === "recovery";

  return (
    <AuthPageShell
      title={isRecovery ? t("confirm.recoveryTitle") : t("confirm.title")}
      intro={isRecovery ? t("confirm.recoveryIntro") : t("confirm.intro")}
    >
      <AuthForm
        action={confirmEmailToken}
        submitLabel={isRecovery ? t("confirm.recoverySubmit") : t("confirm.submit")}
        pendingLabel={t("pending")}
      >
        <input type="hidden" name="tokenHash" value={parsed.data.tokenHash} />
        <input type="hidden" name="type" value={parsed.data.type} />
      </AuthForm>
    </AuthPageShell>
  );
}
