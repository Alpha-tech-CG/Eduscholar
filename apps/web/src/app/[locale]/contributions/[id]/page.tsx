import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ResourceFormFields } from "@/components/catalogue/resource-form-fields";
import { ResourceSummary } from "@/components/catalogue/resource-summary";
import { Link } from "@/i18n/navigation";
import { updateSubmission, withdrawSubmission } from "@/lib/catalogue/actions";
import { getMySubmissions, getResourceHistory } from "@/lib/catalogue/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.contributions");
  return { title: t("detailTitle"), robots: { index: false } };
}

const EDITABLE = new Set(["pending", "changes_requested"]);
const WITHDRAWABLE = new Set(["pending", "under_review", "changes_requested", "verified", "rejected"]);

export default async function ContributionPage({
  params,
}: PageProps<"/[locale]/contributions/[id]">) {
  const { id } = await params;
  await requireOnboardedUser(`/contributions/${id}`);

  // Seules ses propres soumissions : une fiche publiée par un autre, bien que
  // lisible, n'a rien à faire ici.
  const resource = (await getMySubmissions()).find((item) => item.id === id);
  if (!resource) notFound();

  const [t, tStatus, tAction, format, history] = await Promise.all([
    getTranslations("Catalogue.contributions"),
    getTranslations("Catalogue.editorialStatus"),
    getTranslations("Catalogue.historyAction"),
    getFormatter(),
    getResourceHistory(resource.id),
  ]);

  return (
    <AuthPageShell
      wide
      title={resource.title}
      footer={
        <p>
          <Link href="/contributions" className="underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      }
    >
      <p className="font-medium">
        <span>{t("statusLabel")}</span>
        <span data-testid="submission-status">{tStatus(resource.editorialStatus as "pending")}</span>
      </p>

      <ResourceSummary resource={resource} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("history")}</h2>
        <ol className="flex flex-col gap-2">
          {history.map((entry) => (
            <li key={entry.id} className="rounded border border-foreground/20 p-3 text-sm">
              <p className="font-medium">
                <span>{tAction(entry.action as "submitted")}</span>
                <span aria-hidden="true">{t("separator")}</span>
                <time dateTime={entry.occurredAt}>
                  {format.dateTime(new Date(entry.occurredAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </p>
              {entry.reason ? <p data-testid="history-reason">{entry.reason}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      {EDITABLE.has(resource.editorialStatus) ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t("edit")}</h2>
          <AuthForm
            action={updateSubmission}
            submitLabel={t("saveChanges")}
            pendingLabel={t("pending")}
          >
            <input type="hidden" name="resourceId" value={resource.id} />
            <ResourceFormFields resource={resource} />
          </AuthForm>
        </section>
      ) : null}

      {WITHDRAWABLE.has(resource.editorialStatus) ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("withdraw")}</h2>
          <p className="text-sm opacity-80">{t("withdrawIntro")}</p>
          <AuthForm
            action={withdrawSubmission}
            submitLabel={t("withdrawSubmit")}
            pendingLabel={t("pending")}
            destructive
          >
            <input type="hidden" name="resourceId" value={resource.id} />
          </AuthForm>
        </section>
      ) : null}
    </AuthPageShell>
  );
}
