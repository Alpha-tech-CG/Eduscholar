import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("Home");

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t("title")}
      </h1>
      <p className="text-lg">{t("tagline")}</p>
      <p className="opacity-70">{t("status")}</p>
    </section>
  );
}
