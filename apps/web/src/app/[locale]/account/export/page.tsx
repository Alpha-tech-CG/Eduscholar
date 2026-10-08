import { Captcha } from "@/components/auth/captcha";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("DataExport");
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = { password: "errorPassword", rate: "errorRate", unavailable: "errorUnavailable" } as const;

export default async function DataExportPage({
  searchParams,
}: PageProps<"/[locale]/account/export">) {
  await requireUser("/account/export");
  const [locale, t, { error }] = await Promise.all([
    getLocale(),
    getTranslations("DataExport"),
    searchParams,
  ]);
  const errorKey =
    typeof error === "string" && Object.hasOwn(ERRORS, error)
      ? ERRORS[error as keyof typeof ERRORS]
      : null;

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
      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("contains")}</li>
        <li>{t("excludes")}</li>
        <li>{t("trace")}</li>
      </ul>

      {errorKey ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t(errorKey)}
        </p>
      ) : null}

      {/* Formulaire ordinaire vers un gestionnaire de route : la réponse est un
          fichier, ce qu'une action serveur ne sait pas rendre. */}
      <form method="post" action={`/${locale}/account/export/download`} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="export-password" className="font-medium">
            {t("password")}
          </label>
          <input
            id="export-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border border-foreground/30 bg-background px-3 py-2"
          />
          <p className="text-sm opacity-70">{t("passwordHint")}</p>
        </div>
        <button
          type="submit"
          className="self-start rounded bg-foreground px-4 py-3 font-medium text-background"
        >
          {t("submit")}
        </button>
        <Captcha />
      </form>
    </AuthPageShell>
  );
}
