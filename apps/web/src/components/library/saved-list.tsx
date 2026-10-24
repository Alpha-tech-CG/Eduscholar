import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import type { SavedResources } from "@/lib/library/queries";

type SavedListProps = {
  saved: SavedResources;
  emptyLabel: string;
  /** Adresse de la liste, pour les liens de pagination. */
  pathname: string;
  /** Formulaire de retrait d'un élément, que sa fiche soit encore publiée ou non. */
  removeForm: (resourceId: string) => ReactNode;
  /** Note et tags personnels d'un élément, et leurs formulaires. */
  details?: (resourceId: string) => ReactNode;
  /** Paramètres gardés par les liens de pagination (filtre par tag). */
  query?: Record<string, string>;
};

/** Liste de fiches gardées : favoris ou contenu d'une collection. */
export async function SavedList({
  saved,
  emptyLabel,
  pathname,
  removeForm,
  details,
  query = {},
}: SavedListProps) {
  const [t, tAccess] = await Promise.all([
    getTranslations("Library"),
    getTranslations("Catalogue.accessStatus"),
  ]);
  const shown = saved.resources.length + saved.unavailableIds.length;

  if (saved.failed) {
    return (
      <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
        {t("loadFailed")}
      </p>
    );
  }
  if (shown === 0) return <p className="opacity-70">{emptyLabel}</p>;

  const pageHref = (page: number) =>
    page > 1 || Object.keys(query).length > 0
      ? { pathname, query: page > 1 ? { ...query, page: String(page) } : query }
      : pathname;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {saved.resources.map((resource) => (
          <li
            key={resource.id}
            className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
          >
            <Link
              href={`/resources/${resource.id}`}
              className="font-medium underline underline-offset-4"
            >
              {resource.title}
            </Link>
            <p className="text-sm opacity-80">
              {[resource.authors.slice(0, 3).join(", "), resource.publicationYear?.toString()]
                .filter(Boolean)
                .join(t("separator"))}
            </p>
            <p className="text-sm">
              <span className="rounded border border-foreground/30 px-2 py-0.5">
                {tAccess(resource.accessStatus as "unknown")}
              </span>
            </p>
            {details ? details(resource.id) : null}
            {removeForm(resource.id)}
          </li>
        ))}
        {saved.unavailableIds.map((id) => (
          <li
            key={id}
            data-testid="unavailable-item"
            className="flex flex-col gap-2 rounded border border-dashed border-foreground/30 p-3"
          >
            <p className="opacity-80">{t("unavailable")}</p>
            {details ? details(id) : null}
            {removeForm(id)}
          </li>
        ))}
      </ul>
      {saved.lastPage > 1 ? (
        <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4">
          {saved.page > 1 ? (
            <Link href={pageHref(saved.page - 1)} className="underline underline-offset-4">
              {t("previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm opacity-70">
            {t("page", { page: saved.page, pages: saved.lastPage })}
          </span>
          {saved.page < saved.lastPage ? (
            <Link href={pageHref(saved.page + 1)} className="underline underline-offset-4">
              {t("next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
