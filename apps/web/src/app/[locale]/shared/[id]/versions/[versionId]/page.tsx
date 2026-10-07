import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { VersionDetail } from "@/components/projects/version-detail";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { documentLocale } from "@/lib/projects/document-loader";
import { decideVersion } from "@/lib/projects/version-actions";
import { DECISIONS, loadVersion } from "@/lib/projects/version-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Versions");
  return { title: t("versionTitle"), robots: { index: false } };
}

/**
 * Une version soumise d'un projet partagé. L'encadreur y rend sa décision ; un
 * simple lecteur la lit.
 */
export default async function SharedVersionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/shared/[id]/versions/[versionId]">) {
  const { id, versionId } = await params;
  await requireOnboardedUser(`/shared/${id}/versions/${versionId}`);
  const [t, uiLocale, { lang, notice }] = await Promise.all([
    getTranslations("Versions"),
    getLocale(),
    searchParams,
  ]);
  const locale = documentLocale(lang, uiLocale);

  // Version inexistante, d'un autre projet, ou d'un projet fermé à l'utilisateur : même réponse.
  const version = await loadVersion(versionId, locale);
  if (version.status === "not_found") notFound();
  if (version.projectId !== id || version.role === "owner") notFound();

  const name = t("versionName", { number: version.number });
  const heading = version.label ? [name, version.label].join(t("separator")) : name;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3 print:hidden">
        {notice === "decided" ? (
          <p role="status" className="rounded border border-foreground/20 p-3">
            {t("noticeDecided")}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold">
          {heading}
        </h1>
        <p>
          <Link href={`/shared/${id}/versions`} className="underline underline-offset-4">
            {t("backToVersions")}
          </Link>
        </p>
      </div>

      {version.status === "too_large" ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("tooLarge")}
        </p>
      ) : (
        <VersionDetail version={version} locale={locale} uiLocale={uiLocale} />
      )}

      {version.status === "ok" && version.role === "supervisor" ? (
        <section className="flex flex-col gap-3 print:hidden">
          <hr className="border-foreground/20" />
          <h2 className="text-lg font-semibold">{t("decideHeading")}</h2>
          <p className="text-sm opacity-80">{t("decideIntro")}</p>
          {/* Le formulaire affiche lui-même ses erreurs : il lui faut leurs libellés. */}
          <NextIntlClientProvider messages={{ Auth: (await getMessages()).Auth }}>
            <AuthForm action={decideVersion} submitLabel={t("decide")} pendingLabel={t("pending")}>
              <input type="hidden" name="projectId" value={id} />
              <input type="hidden" name="versionId" value={versionId} />
              <SelectField
                name="decision"
                label={t("fields.decision")}
                placeholder={t("choose")}
                options={DECISIONS.map((decision) => ({ value: decision, label: t(`decisions.${decision}`) }))}
                required
              />
              <OptionalTextField
                name="comment"
                label={t("fields.comment")}
                hint={t("fields.commentHint")}
                maxLength={2000}
                rows={4}
              />
            </AuthForm>
          </NextIntlClientProvider>
        </section>
      ) : null}
    </section>
  );
}
