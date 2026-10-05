import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import "./globals.css";

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    title: { default: t("title"), template: `%s — ${t("title")}` },
    description: t("description"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "Layout" });
  const tLocales = await getTranslations({ locale, namespace: "Locales" });

  return (
    <html lang={locale} dir="ltr" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* Les composants client ne reçoivent que la langue : les messages restent
            sur le serveur tant qu'un composant client n'en a pas besoin. */}
        <NextIntlClientProvider locale={locale} messages={null}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded focus:bg-foreground focus:px-3 focus:py-2 focus:text-background"
        >
          {t("skipToContent")}
        </a>
        <header className="flex items-center justify-end px-4 py-3">
          <nav aria-label={t("languageSwitcher")}>
            <ul className="flex gap-3 text-sm">
              {routing.locales.map((target) => (
                <li key={target}>
                  <Link
                    href="/"
                    locale={target}
                    lang={target}
                    hrefLang={target}
                    aria-current={target === locale ? "true" : undefined}
                    className="rounded px-2 py-1 underline-offset-4 hover:underline aria-[current=true]:font-semibold"
                  >
                    {tLocales(target)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main id="main" className="flex flex-1 flex-col px-4">
          {children}
        </main>
        <footer className="px-4 py-6 text-center text-sm opacity-70">
          {t("footer")}
        </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
