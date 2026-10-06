import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxField, OptionalTextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { SourceFormFields } from "@/components/projects/source-form-fields";
import { Link } from "@/i18n/navigation";
import { getResource } from "@/lib/catalogue/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { deleteSource, saveNote, updateSource } from "@/lib/projects/source-actions";
import { getSource } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.sources");
  return { title: t("sourceTitle"), robots: { index: false } };
}

const NOTICES = { added: "added", saved: "saved", "note-saved": "noteSaved" } as const;

export default async function ProjectSourcePage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/sources/[sourceId]">) {
  const { id, sourceId } = await params;
  await requireOnboardedUser(`/projects/${id}/sources/${sourceId}`);

  // La source d'un autre, d'un autre projet ou inexistante : même réponse.
  const found = await getSource(id, sourceId);
  if (!found) notFound();
  const { source, note } = found;

  const [t, tNote, { notice }] = await Promise.all([
    getTranslations("Projects.sources"),
    getTranslations("Projects.sources.note"),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;
  const safeUrl = source.url && /^https?:\/\//.test(source.url) ? source.url : null;

  // Source reprise du catalogue : la fiche y est-elle encore publiée ? Si elle a
  // été retirée ou suspendue, la source garde ses métadonnées, mais plus la
  // caution du catalogue : ni mention, ni lien cliquable vers l'adresse copiée.
  const origin = source.resourceId ? await getResource(source.resourceId) : null;
  const stillPublished =
    origin !== null && origin.editorialStatus === "published" && origin.visibility === "public";
  const withdrawn = source.resourceId !== null && !stillPublished;

  const noteFields: Array<{ name: string; value: string | null; rows?: number; max: number }> = [
    { name: "problem", value: note?.problem ?? null, rows: 3, max: 3000 },
    { name: "concepts", value: note?.concepts ?? null, rows: 3, max: 3000 },
    { name: "method", value: note?.method ?? null, rows: 3, max: 3000 },
    { name: "populationField", value: note?.populationField ?? null, rows: 2, max: 3000 },
    { name: "results", value: note?.results ?? null, rows: 3, max: 3000 },
    { name: "limits", value: note?.limits ?? null, rows: 3, max: 3000 },
    { name: "usefulQuote", value: note?.usefulQuote ?? null, rows: 3, max: 2000 },
    { name: "quotePages", value: note?.quotePages ?? null, max: 50 },
    { name: "projectLink", value: note?.projectLink ?? null, rows: 3, max: 3000 },
    { name: "targetChapter", value: note?.targetChapter ?? null, max: 200 },
  ];

  return (
    <AuthPageShell
      wide
      title={source.title}
      footer={
        <p>
          <Link href={`/projects/${source.projectId}/sources`} className="underline underline-offset-4">
            {t("backToSources")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      {source.resourceId && stillPublished ? (
        <p className="text-sm">
          <span>{t("fromCatalogue")}</span>
          <Link href={`/resources/${source.resourceId}`} className="underline underline-offset-4">
            {t("openResource")}
          </Link>
        </p>
      ) : null}
      {withdrawn ? (
        <p data-testid="withdrawn-notice" className="rounded border border-foreground/30 p-3 text-sm">
          {t("withdrawn")}
        </p>
      ) : null}
      {safeUrl && withdrawn ? (
        <p className="text-sm break-all opacity-80" data-testid="source-url-text">
          {safeUrl}
        </p>
      ) : safeUrl ? (
        <p className="text-sm break-all">
          <a
            href={safeUrl}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="underline underline-offset-4"
          >
            {safeUrl}
          </a>
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{tNote("heading")}</h2>
        <p className="text-sm opacity-80">{tNote("intro")}</p>
        <AuthForm action={saveNote} submitLabel={tNote("save")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={source.projectId} />
          <input type="hidden" name="sourceId" value={source.id} />
          {noteFields.map(({ name, value, rows, max }) => (
            <OptionalTextField
              key={name}
              name={name}
              label={tNote(name as "problem")}
              hint={name === "usefulQuote" ? tNote("usefulQuoteHint") : undefined}
              maxLength={max}
              rows={rows}
              defaultValue={value ?? ""}
            />
          ))}
        </AuthForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("referenceHeading")}</h2>
        <p className="text-sm opacity-80">{t("referenceIntro")}</p>
        <AuthForm action={updateSource} submitLabel={t("saveReference")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={source.projectId} />
          <input type="hidden" name="sourceId" value={source.id} />
          <SourceFormFields source={source} />
        </AuthForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("deleteHeading")}</h2>
        <p className="text-sm opacity-80">{t("deleteIntro")}</p>
        <AuthForm
          action={deleteSource}
          submitLabel={t("delete")}
          pendingLabel={t("pending")}
          destructive
        >
          <input type="hidden" name="projectId" value={source.projectId} />
          <input type="hidden" name="sourceId" value={source.id} />
          <CheckboxField name="confirm" label={t("deleteConfirm")} />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
