import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxField } from "@/components/auth/form";
import { DocumentArticle } from "@/components/projects/document-article";
import { Link } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { documentLocale } from "@/lib/projects/document-loader";
import { getProjectComments, openThreadCounts } from "@/lib/projects/comment-queries";
import { leaveProject } from "@/lib/projects/sharing-actions";
import { loadSharedDocument } from "@/lib/projects/sharing-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Sharing");
  // Titre générique : celui du projet n'est affiché qu'à ses membres.
  return { title: t("sharedProjectTitle"), robots: { index: false } };
}

/**
 * Un projet partagé, en lecture seule : sa problématique et son document. La
 * base vérifie à chaque lecture que l'utilisateur en est encore membre.
 */
export default async function SharedProjectPage({
  params,
  searchParams,
}: PageProps<"/[locale]/shared/[id]">) {
  const { id } = await params;
  const { user } = await requireOnboardedUser(`/shared/${id}`);
  const [t, uiLocale, messages, { notice, lang }] = await Promise.all([
    getTranslations("Sharing"),
    getLocale(),
    getMessages(),
    searchParams,
  ]);
  const locale = documentLocale(lang, uiLocale);

  // La même lecture lourde que le document du propriétaire : même limite.
  if ((await checkAttempt("document", user.id)) !== "allowed") {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("rateLimited")}
        </p>
      </section>
    );
  }

  // Projet inexistant, supprimé, ou dont on n'est pas membre : même réponse.
  const loaded = await loadSharedDocument(id, locale);
  if (loaded.status === "not_found") notFound();
  const { project } = loaded;

  const comments = await getProjectComments(id);
  const openThreads = comments ? openThreadCounts(comments) : new Map<string, number>();
  const sections = loaded.status === "ok" ? loaded.document.sections : [];

  const facts: Array<[string, string | null]> = [
    [t("facts.problemStatement"), project.facts.problemStatement],
    [t("facts.mainQuestion"), project.facts.mainQuestion],
    [t("facts.generalObjective"), project.facts.generalObjective],
    [t("facts.methodology"), project.facts.methodology],
  ];

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-4 print:hidden">
        {notice === "joined" ? (
          <p role="status" className="rounded border border-foreground/20 p-3">
            {t("noticeJoined")}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <p className="opacity-80" data-testid="shared-role">
          {t("readOnly", { role: t(`roles.${project.role}`) })}
        </p>
        {facts.map(([heading, value]) =>
          value ? (
            <section key={heading} className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{heading}</h2>
              <p className="whitespace-pre-line">{value}</p>
            </section>
          ) : null,
        )}
        {sections.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t("sectionsHeading")}</h2>
            <p className="text-sm opacity-80">{t("sectionsIntro")}</p>
            <ul className="flex flex-col gap-1">
              {sections.map((section) => (
                <li key={section.id} data-testid="shared-section" className={["", "ps-6", "ps-12"][section.level - 1]}>
                  <Link
                    href={`/shared/${id}/sections/${section.id}`}
                    className="underline underline-offset-4"
                  >
                    {section.number} {section.title}
                  </Link>
                  {(openThreads.get(section.id) ?? 0) > 0 ? (
                    <span className="ms-2 text-sm opacity-80">
                      {t("openThreads", { count: openThreads.get(section.id) ?? 0 })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p>
          <Link href={`/shared/${id}/versions`} className="underline underline-offset-4">
            {t("toVersions")}
          </Link>
        </p>
        <p>
          <Link href="/shared" className="underline underline-offset-4">
            {t("backToShared")}
          </Link>
        </p>
        <hr className="border-foreground/20" />
      </div>

      {loaded.status === "too_large" ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("tooLarge")}
        </p>
      ) : (
        <DocumentArticle
          document={loaded.document}
          locale={locale}
          uiLocale={uiLocale}
          emptyLabel={t("documentEmpty")}
        />
      )}

      <section className="flex flex-col gap-3 print:hidden">
        <hr className="border-foreground/20" />
        <h2 className="text-lg font-semibold">{t("leaveHeading")}</h2>
        <p className="text-sm opacity-80">{t("leaveIntro")}</p>
        {/* Le formulaire affiche lui-même ses erreurs : il lui faut leurs libellés. */}
        <NextIntlClientProvider messages={{ Auth: messages.Auth }}>
          <AuthForm action={leaveProject} submitLabel={t("leave")} pendingLabel={t("pending")} destructive>
            <input type="hidden" name="projectId" value={id} />
            <CheckboxField name="confirm" label={t("leaveConfirm")} />
          </AuthForm>
        </NextIntlClientProvider>
      </section>
    </section>
  );
}
