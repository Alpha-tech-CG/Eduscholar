import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { LEGAL_PAGES } from "@/content/legal/types";
import { ConnectionStatus } from "@/components/offline/connection-status";
import { ServiceWorkerRegistration } from "@/components/offline/service-worker-registration";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { THEME } from "@/lib/offline/service-worker";
import { isSessionCookie } from "@/lib/supabase/cookies";
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
    // Application installable (ADR-0012). Le lien vers le manifeste est posé
    // par Next.js à partir de `app/manifest.ts`.
    applicationName: t("title"),
    appleWebApp: { capable: true, title: t("title"), statusBarStyle: "default" },
    icons: { apple: "/icons/icon-192.png" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME.light },
    { media: "(prefers-color-scheme: dark)", color: THEME.dark },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "Layout" });
  const tLocales = await getTranslations({ locale, namespace: "Locales" });
  const tLegal = await getTranslations({ locale, namespace: "Legal" });

  // Simple indice d'affichage pour choisir le lien du menu. Ce n'est pas un
  // contrôle d'accès : chaque page protégée vérifie la session elle-même.
  const cookieStore = await cookies();
  const mayBeSignedIn = cookieStore.getAll().some(({ name }) => isSessionCookie(name));

  const linkClass =
    "inline-flex min-h-11 items-center rounded px-2 underline-offset-4 hover:underline aria-[current=true]:font-semibold";

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
          <ConnectionStatus label={t("offline")} />
          <header className="flex flex-wrap items-center justify-between gap-x-2 px-4 py-1 text-sm print:hidden">
            <nav aria-label={t("mainNavigation")}>
              <ul className="flex flex-wrap gap-x-3">
                <li>
                  <Link href="/" className={linkClass}>
                    {t("home")}
                  </Link>
                </li>
                <li>
                  {mayBeSignedIn ? (
                    <Link href="/account" className={linkClass}>
                      {t("account")}
                    </Link>
                  ) : (
                    <Link href="/sign-in" className={linkClass}>
                      {t("signIn")}
                    </Link>
                  )}
                </li>
              </ul>
            </nav>
            {/* Chaque langue est nommée dans sa propre langue ; le lien garde la page ouverte. */}
            <LocaleSwitcher
              label={t("languageSwitcher")}
              current={locale}
              names={Object.fromEntries(routing.locales.map((target) => [target, tLocales(target)]))}
              className={linkClass}
            />
          </header>
          <main id="main" className="flex flex-1 flex-col px-4">
            {children}
          </main>
          <footer className="flex flex-col items-center gap-1 px-4 py-6 text-center text-sm print:hidden">
            <nav aria-label={t("footerNavigation")}>
              <ul className="flex flex-wrap justify-center gap-x-3">
                <li>
                  <Link href="/help" className={linkClass}>
                    {t("help")}
                  </Link>
                </li>
                {LEGAL_PAGES.map((page) => (
                  <li key={page}>
                    <Link href={`/legal/${page}`} className={linkClass}>
                      {tLegal(`links.${page}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <p className="opacity-70">{t("footer")}</p>
          </footer>
          <ServiceWorkerRegistration />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
