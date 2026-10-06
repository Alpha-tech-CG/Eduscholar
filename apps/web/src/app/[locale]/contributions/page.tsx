import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { getMySubmissions } from "@/lib/catalogue/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.contributions");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = ["submitted", "updated", "withdrawn"] as const;

export default async function ContributionsPage({
  searchParams,
}: PageProps<"/[locale]/contributions">) {
  await requireOnboardedUser("/contributions");
  const [t, tStatus, format, submissions, { notice }] = await Promise.all([
    getTranslations("Catalogue.contributions"),
    getTranslations("Catalogue.editorialStatus"),
    getFormatter(),
    getMySubmissions(),
    searchParams,
  ]);
  const noticeKey = NOTICES.find((value) => value === notice);

  return (
    <AuthPageShell wide title={t("title")} intro={t("intro")}>
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(`notices.${noticeKey}`)}
        </p>
      ) : null}

      <p>
        <Link
          href="/contribute"
          className="inline-block rounded bg-foreground px-4 py-2 font-medium text-background"
        >
          {t("new")}
        </Link>
      </p>

      {submissions.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {submissions.map((resource) => (
            <li key={resource.id} className="rounded border border-foreground/20 p-3">
              <Link
                href={`/contributions/${resource.id}`}
                className="font-medium underline underline-offset-4"
              >
                {resource.title}
              </Link>
              <p className="text-sm opacity-80">
                <span data-testid="submission-status">
                  {tStatus(resource.editorialStatus as "pending")}
                </span>
                <span aria-hidden="true">{t("separator")}</span>
                <time dateTime={resource.createdAt}>
                  {format.dateTime(new Date(resource.createdAt), { dateStyle: "medium" })}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </AuthPageShell>
  );
}
