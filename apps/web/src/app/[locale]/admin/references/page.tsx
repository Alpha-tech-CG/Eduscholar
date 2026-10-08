import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { confirmAdminIdentity } from "@/lib/admin/actions";
import { getAdminSession } from "@/lib/admin/queries";
import { requireUser } from "@/lib/auth/session";
import { getRawReference, referenceLabel } from "@/lib/reference/data";
import { saveReferenceItem, setReferenceActive } from "@/lib/references/actions";
import { listReferenceItems } from "@/lib/references/queries";
import {
  filterReferenceItems,
  otherLabelLanguages,
  paginateReferenceItems,
  REFERENCE_KINDS,
  REFERENCE_SHAPES,
  referenceKind,
  referenceQuery,
} from "@/lib/references/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("References");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  confirmed: "noticeConfirmed",
  created: "noticeCreated",
  updated: "noticeUpdated",
  activated: "noticeActivated",
  deactivated: "noticeDeactivated",
} as const;

const ALERT = "rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300";
const SUMMARY = "cursor-pointer py-2 underline underline-offset-4";

/**
 * Administration des référentiels. La page répond « introuvable » à qui n'est
 * pas administrateur ; ce n'est qu'un aiguillage, chaque opération étant
 * revérifiée par la base. Les formulaires proposés selon le référentiel ne
 * sont qu'un confort : la base refuse ce qui ne s'écrit pas.
 */
export default async function AdminReferencesPage({
  searchParams,
}: PageProps<"/[locale]/admin/references">) {
  await requireUser("/admin/references");
  const session = await getAdminSession();
  if (session.rank < 2) notFound();

  const [t, tAdmin, params] = await Promise.all([
    getTranslations("References"),
    getTranslations("Admin"),
    searchParams,
  ]);

  if (!session.recent) {
    return (
      <AuthPageShell title={tAdmin("confirmTitle")} intro={tAdmin("confirmIntro")}>
        <AuthForm action={confirmAdminIdentity} submitLabel={tAdmin("confirm")} pendingLabel={tAdmin("pending")}>
          <input type="hidden" name="from" value="references" />
          <TextField
            name="code"
            type="code"
            autoComplete="one-time-code"
            label={tAdmin("code")}
            hint={tAdmin("codeHint")}
          />
        </AuthForm>
      </AuthPageShell>
    );
  }

  // Référentiel et filtre lus dans l'adresse : une liste fermée, un texte borné.
  const kind = referenceKind(params.kind);
  const shape = REFERENCE_SHAPES[kind];
  const query = referenceQuery(params.q);
  const noticeKey =
    typeof params.notice === "string" && Object.hasOwn(NOTICES, params.notice)
      ? NOTICES[params.notice as keyof typeof NOTICES]
      : null;

  const [locale, loaded, reference] = await Promise.all([getLocale(), listReferenceItems(kind), getRawReference()]);
  // Le filtre et la pagination portent sur la liste déjà lue : aucune requête de plus.
  const listing =
    loaded.status === "ok" ? paginateReferenceItems(filterReferenceItems(loaded.items, query), params.page) : null;

  // Rattachements proposés : domaines pour une filière, filières pour une spécialité ou une matière.
  const parents = shape.parent === "domain_code" ? reference.academic_domains : reference.academic_programs;
  const parentLabel = (code: string) => {
    const found = parents.find((parent) => parent.code === code);
    return found ? t("parentWithCode", { label: referenceLabel(found.labels, locale), code }) : code;
  };
  const parentOptions = (current: string | null) => [
    ...parents.map((parent) => ({ value: parent.code, label: parentLabel(parent.code) })),
    // Un rattachement désactivé depuis reste affiché pour la ligne qui le porte.
    ...(current && !parents.some((parent) => parent.code === current) ? [{ value: current, label: current }] : []),
  ];
  const parentName = shape.parent === "domain_code" ? t("fields.domain") : t("fields.program");
  const pending = t("pending");
  const pageHref = (page: number) => ({
    pathname: "/admin/references" as const,
    query: { kind, ...(query ? { q: query } : {}), ...(page > 1 ? { page: String(page) } : {}) },
  });
  const context = (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="page" value={String(listing?.page ?? 1)} />
    </>
  );

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/admin" className="underline underline-offset-4">
            {t("backToAdmin")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("ruleAudit")}</li>
        <li>{t("ruleNoDelete")}</li>
        <li>{t("ruleCode")}</li>
      </ul>

      <nav aria-label={t("kindsLabel")}>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {REFERENCE_KINDS.map((value) => (
            <li key={value}>
              <Link
                href={{ pathname: "/admin/references", query: { kind: value } }}
                aria-current={value === kind ? "page" : undefined}
                className="inline-block py-3 underline underline-offset-4 aria-[current=page]:font-semibold aria-[current=page]:no-underline"
              >
                {t(`kinds.${value}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold" data-testid="reference-kind">
          {t(`kinds.${kind}`)}
        </h2>
        <p className="text-sm opacity-80">{t(`kindHelp.${kind}`)}</p>

        {/* Formulaire ordinaire, sans JavaScript : le filtre voyage dans l'adresse. */}
        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="kind" value={kind} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="reference-filter" className="font-medium">
              {t("filterLabel")}
            </label>
            <input
              id="reference-filter"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={100}
              autoComplete="off"
              className="rounded border border-foreground/30 bg-background px-3 py-2"
            />
          </div>
          <button type="submit" className="rounded border border-foreground/30 px-4 py-2 font-medium">
            {t("filter")}
          </button>
          {query ? (
            <Link
              href={{ pathname: "/admin/references", query: { kind } }}
              className="inline-block py-3 underline underline-offset-4"
            >
              {t("clearFilter")}
            </Link>
          ) : null}
        </form>

        {loaded.status === "rate_limited" ? (
          <p role="alert" className={ALERT}>
            {t("rateLimited")}
          </p>
        ) : listing === null ? (
          <p role="alert" className={ALERT}>
            {t("loadFailed")}
          </p>
        ) : (
          <>
            <p className="text-sm opacity-80" data-testid="reference-total">
              {query ? t("totalFiltered", { count: listing.total }) : t("total", { count: listing.total })}
            </p>

            {listing.total === 0 ? (
              <p className="opacity-70">{query ? t("emptyFiltered") : t("empty")}</p>
            ) : !shape.writable ? (
              // Lecture seule : un tableau, qui défile dans son propre conteneur.
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{t(`kinds.${kind}`)}</caption>
                  <thead>
                    <tr className="border-b border-foreground/20">
                      <th scope="col" className="py-2 pe-4 font-medium">{t("fields.code")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("fields.labelFr")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("fields.labelEn")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("fields.state")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("fields.usage")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("license.canHost")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("license.canRedistribute")}</th>
                      <th scope="col" className="py-2 pe-4 font-medium">{t("license.commercialUse")}</th>
                      <th scope="col" className="py-2 font-medium">{t("license.attribution")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listing.items.map((item) => (
                      <tr key={item.code} data-testid="reference-item" className="border-b border-foreground/10">
                        <th scope="row" className="py-2 pe-4 font-normal">
                          <code>{item.code}</code>
                        </th>
                        <td className="py-2 pe-4">{item.labels.fr ?? ""}</td>
                        <td className="py-2 pe-4">{item.labels.en ?? ""}</td>
                        <td className="py-2 pe-4">{t(item.isActive ? "active" : "inactive")}</td>
                        <td className="py-2 pe-4">{item.usageCount}</td>
                        <td className="py-2 pe-4">{t(`license.values.${triState(item.license?.canHost)}`)}</td>
                        <td className="py-2 pe-4">{t(`license.values.${triState(item.license?.canRedistribute)}`)}</td>
                        <td className="py-2 pe-4">
                          {t(`license.values.${item.license?.allowsCommercialUse ? "yes" : "no"}`)}
                        </td>
                        <td className="py-2">
                          {t(`license.values.${item.license?.requiresAttribution ? "yes" : "no"}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {listing.items.map((item) => {
                  const others = otherLabelLanguages(item.labels);
                  const identity = (
                    <>
                      {context}
                      <input type="hidden" name="code" value={item.code} />
                      {shape.parentIsKey ? <input type="hidden" name="parentCode" value={item.parentCode ?? ""} /> : null}
                    </>
                  );
                  return (
                    <li
                      key={`${item.parentCode ?? ""}/${item.code}`}
                      data-testid="reference-item"
                      data-code={item.code}
                      className="flex flex-col gap-3 rounded border border-foreground/20 p-3"
                    >
                      <h3 className="font-medium break-words">{item.labels.fr ?? item.code}</h3>
                      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                        <dt className="opacity-70">{t("fields.code")}</dt>
                        <dd className="break-all">
                          <code>{item.code}</code>
                        </dd>
                        <dt className="opacity-70">{t("fields.labelEn")}</dt>
                        <dd className="break-words" lang="en">
                          {item.labels.en ?? ""}
                        </dd>
                        {others.map((language) => (
                          <div key={language} className="contents">
                            <dt className="opacity-70">{t("fields.labelOther", { language })}</dt>
                            <dd className="break-words" lang={language}>
                              {item.labels[language]}
                            </dd>
                          </div>
                        ))}
                        {shape.parent ? (
                          <>
                            <dt className="opacity-70">{parentName}</dt>
                            <dd className="break-words">{item.parentCode ? parentLabel(item.parentCode) : t("none")}</dd>
                          </>
                        ) : null}
                        {shape.hasPosition ? (
                          <>
                            <dt className="opacity-70">{t("fields.position")}</dt>
                            <dd>{item.position ?? 0}</dd>
                          </>
                        ) : null}
                        {shape.hasIsced ? (
                          <>
                            <dt className="opacity-70">{t("fields.isced")}</dt>
                            <dd>{item.iscedLevel ?? t("none")}</dd>
                          </>
                        ) : null}
                        <dt className="opacity-70">{t("fields.state")}</dt>
                        <dd data-testid="reference-state">
                          {t(item.isActive ? "active" : "inactive")}
                          {item.isInterface ? `${t("separator")}${t("interfaceLanguage")}` : ""}
                        </dd>
                        <dt className="opacity-70">{t("fields.usage")}</dt>
                        <dd data-testid="reference-usage">{t("usage", { count: item.usageCount })}</dd>
                      </dl>

                      <details>
                        <summary className={SUMMARY}>{t("editSummary")}</summary>
                        <div className="mt-3 flex flex-col gap-3">
                          <AuthForm action={saveReferenceItem} submitLabel={t("save")} pendingLabel={pending}>
                            {identity}
                            <input type="hidden" name="mode" value="update" />
                            <OptionalTextField
                              name="label_fr"
                              label={t("fields.labelFr")}
                              defaultValue={item.labels.fr ?? ""}
                              maxLength={120}
                              required
                            />
                            <OptionalTextField
                              name="label_en"
                              label={t("fields.labelEn")}
                              defaultValue={item.labels.en ?? ""}
                              maxLength={120}
                              required
                            />
                            {others.map((language) => (
                              <OptionalTextField
                                key={language}
                                name={`label_${language}`}
                                label={t("fields.labelOther", { language })}
                                hint={t("fields.labelOtherHint")}
                                defaultValue={item.labels[language]}
                                maxLength={120}
                              />
                            ))}
                            {shape.parent && !shape.parentIsKey ? (
                              <SelectField
                                name="parentCode"
                                label={parentName}
                                placeholder={t("keepParent")}
                                options={parentOptions(item.parentCode)}
                                defaultValue={item.parentCode ?? undefined}
                              />
                            ) : null}
                            {shape.hasPosition ? (
                              <OptionalTextField
                                name="position"
                                label={t("fields.position")}
                                hint={t("fields.positionHint")}
                                defaultValue={String(item.position ?? 0)}
                                maxLength={5}
                                kind="numeric"
                                required
                              />
                            ) : null}
                            {shape.hasIsced ? (
                              <OptionalTextField
                                name="iscedLevel"
                                label={t("fields.isced")}
                                hint={t("fields.iscedHint")}
                                defaultValue={item.iscedLevel === null ? "" : String(item.iscedLevel)}
                                maxLength={1}
                                kind="numeric"
                              />
                            ) : null}
                          </AuthForm>
                        </div>
                      </details>

                      {item.isActive ? (
                        <details>
                          <summary className={SUMMARY}>{t("deactivateSummary")}</summary>
                          <div className="mt-3 flex flex-col gap-3">
                            <p className="text-sm" data-testid="deactivate-help">
                              {t("deactivateHelp", { count: item.usageCount })}
                            </p>
                            <AuthForm
                              action={setReferenceActive}
                              submitLabel={t("deactivate")}
                              pendingLabel={pending}
                              destructive
                            >
                              {identity}
                              <input type="hidden" name="active" value="false" />
                            </AuthForm>
                          </div>
                        </details>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm opacity-80">{t("activateHelp")}</p>
                          <AuthForm action={setReferenceActive} submitLabel={t("activate")} pendingLabel={pending}>
                            {identity}
                            <input type="hidden" name="active" value="true" />
                          </AuthForm>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {listing.pageCount > 1 ? (
              <nav aria-label={t("pagination.label")} className="flex flex-wrap items-center gap-4 text-sm">
                {listing.page > 1 ? (
                  <Link href={pageHref(listing.page - 1)} className="py-3 underline underline-offset-4">
                    {t("pagination.previous")}
                  </Link>
                ) : null}
                <span data-testid="references-page">
                  {t("pagination.page", { page: listing.page, pages: listing.pageCount })}
                </span>
                {listing.page < listing.pageCount ? (
                  <Link href={pageHref(listing.page + 1)} className="py-3 underline underline-offset-4">
                    {t("pagination.next")}
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>

      {!shape.writable ? (
        <p data-testid="read-only-reference" className="rounded border border-foreground/40 p-3">
          {t("readOnly")}
        </p>
      ) : shape.canCreate ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("createHeading", { kind: t(`kinds.${kind}`) })}</h2>
          <p data-testid="create-inactive" className="rounded border border-foreground/40 p-3 text-sm">
            {t("createInactive")}
          </p>
          <AuthForm action={saveReferenceItem} submitLabel={t("create")} pendingLabel={pending}>
            {context}
            <input type="hidden" name="mode" value="create" />
            {shape.parent ? (
              <SelectField
                name="parentCode"
                label={parentName}
                placeholder={t("choose")}
                options={parentOptions(null)}
                required
              />
            ) : null}
            <OptionalTextField
              name="code"
              label={t("fields.code")}
              hint={t(kind === "languages" ? "fields.codeHintLanguage" : "fields.codeHint")}
              maxLength={50}
              required
            />
            <OptionalTextField name="label_fr" label={t("fields.labelFr")} maxLength={120} required />
            <OptionalTextField name="label_en" label={t("fields.labelEn")} maxLength={120} required />
            {shape.hasPosition ? (
              <OptionalTextField
                name="position"
                label={t("fields.position")}
                hint={t("fields.positionHint")}
                defaultValue="0"
                maxLength={5}
                kind="numeric"
                required
              />
            ) : null}
            {shape.hasIsced ? (
              <OptionalTextField
                name="iscedLevel"
                label={t("fields.isced")}
                hint={t("fields.iscedHint")}
                maxLength={1}
                kind="numeric"
              />
            ) : null}
          </AuthForm>
        </section>
      ) : (
        <p data-testid="no-creation" className="rounded border border-foreground/40 p-3">
          {t("noCreation")}
        </p>
      )}
    </AuthPageShell>
  );
}

/** Indicateur d'une licence : oui, non, ou à examiner au cas par cas. */
function triState(value: string | undefined): "yes" | "no" | "review" {
  return value === "yes" ? "yes" : value === "no" ? "no" : "review";
}
