import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import type { Resource } from "@/lib/catalogue/queries";

type ResourceCardProps = {
  resource: Resource;
  /** Libellé du type de ressource, dans la langue de l'interface. */
  typeLabel: string;
  /** Complément propre à la liste : par exemple les raisons d'une recommandation. */
  children?: ReactNode;
};

/**
 * Une fiche publiée dans une liste : titre lié à sa page, type, auteurs, année,
 * statut d'accès et provenance. Tout est rendu en texte.
 */
export async function ResourceCard({ resource, typeLabel, children }: ResourceCardProps) {
  const [t, tAccess] = await Promise.all([
    getTranslations("Catalogue.search"),
    getTranslations("Catalogue.accessStatus"),
  ]);

  return (
    <li data-testid="resource-card" className="flex flex-col gap-1 rounded border border-foreground/20 p-3">
      <Link href={`/resources/${resource.id}`} className="font-medium underline underline-offset-4">
        {resource.title}
      </Link>
      <p className="text-sm opacity-80">
        {[
          typeLabel,
          resource.authors.slice(0, 3).join(", ") || resource.institutionName,
          resource.publicationYear?.toString(),
        ]
          .filter(Boolean)
          .join(t("separator"))}
      </p>
      <p className="text-sm">
        <span className="rounded border border-foreground/30 px-2 py-0.5">
          {tAccess(resource.accessStatus as "unknown")}
        </span>
        <span className="ms-2 opacity-70">{t("source", { source: resource.sourceName })}</span>
      </p>
      {children}
    </li>
  );
}
