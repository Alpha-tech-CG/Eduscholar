import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("NotFound");

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>{t("description")}</p>
      <p>
        <Link href="/" className="underline underline-offset-4">
          {t("backHome")}
        </Link>
      </p>
    </section>
  );
}
