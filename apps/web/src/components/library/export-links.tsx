import { getTranslations } from "next-intl/server";
import { LIBRARY_EXPORT_FORMATS } from "@/lib/library/citation-export";

type ExportLinksProps = {
  label: string;
  locale: string;
  /** Collection à exporter ; sans elle, les favoris. */
  collectionId?: string;
};

/**
 * Liens de téléchargement de la bibliothèque. Simples liens : un
 * téléchargement n'a pas à passer par le routeur, ni à être préchargé.
 */
export async function LibraryExportLinks({ label, locale, collectionId }: ExportLinksProps) {
  const t = await getTranslations("Library.exportFormats");
  const href = (format: string) => {
    const query = new URLSearchParams();
    if (collectionId) query.set("collection", collectionId);
    const search = query.toString();
    return `/${locale}/library/export/${format}${search ? `?${search}` : ""}`;
  };

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span>{label}</span>
      {LIBRARY_EXPORT_FORMATS.map((format) => (
        <a key={format} href={href(format)} download className="underline underline-offset-4">
          {t(format)}
        </a>
      ))}
    </p>
  );
}
