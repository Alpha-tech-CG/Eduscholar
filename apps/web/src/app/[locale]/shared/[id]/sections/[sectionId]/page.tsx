import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { CommentThreads } from "@/components/projects/comment-threads";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProjectComments } from "@/lib/projects/comment-queries";
import { documentLocale } from "@/lib/projects/document-loader";
import { loadSharedDocument } from "@/lib/projects/sharing-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Comments");
  return { title: t("sectionTitle"), robots: { index: false } };
}

const NOTICES = {
  commented: "noticeCommented",
  replied: "noticeReplied",
  "comment-deleted": "noticeDeleted",
  resolved: "noticeResolved",
  reopened: "noticeReopened",
} as const;

/** Une section d'un projet partagé : son texte, et les commentaires qu'elle porte. */
export default async function SharedSectionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/shared/[id]/sections/[sectionId]">) {
  const { id, sectionId } = await params;
  await requireOnboardedUser(`/shared/${id}/sections/${sectionId}`);
  const uiLocale = await getLocale();

  // Projet ou section inexistants, ou fermés à l'utilisateur : même réponse.
  const [loaded, comments] = await Promise.all([
    loadSharedDocument(id, documentLocale(undefined, uiLocale)),
    getProjectComments(id),
  ]);
  if (loaded.status !== "ok" || !comments) notFound();
  const section = loaded.document.sections.find((item) => item.id === sectionId);
  if (!section) notFound();

  const [t, { notice }] = await Promise.all([getTranslations("Comments"), searchParams]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  return (
    <AuthPageShell
      wide
      title={loaded.project.fullAccess ? `${section.number} ${section.title}` : section.title}
      intro={t("sharedIntro", { project: loaded.project.title })}
      footer={
        <p>
          <Link href={`/shared/${id}`} className="underline underline-offset-4">
            {t("backToProject")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      <section className="flex flex-col gap-3" data-testid="section-text">
        <h2 className="text-lg font-semibold">{t("textHeading")}</h2>
        {section.paragraphs.length === 0 ? (
          <p className="opacity-70">{t("textEmpty")}</p>
        ) : (
          section.paragraphs.map((lines, index) => (
            <p key={index} className="leading-relaxed">
              {lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ))
        )}
      </section>

      <CommentThreads
        scope="member"
        projectId={id}
        sectionId={sectionId}
        role={comments.role}
        threads={comments.bySection.get(sectionId) ?? []}
      />
    </AuthPageShell>
  );
}
