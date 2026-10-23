"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

type LocaleSwitcherProps = {
  label: string;
  current: Locale;
  /** Nom de chaque langue, écrit dans cette langue même. */
  names: Record<string, string>;
  className: string;
};

/**
 * Sélecteur de langue : chaque lien mène à la même page dans l'autre langue.
 * Les paramètres de l'adresse ne sont pas repris : une recherche, un filtre ou
 * un jeton n'est pas recopié d'une langue à l'autre.
 */
export function LocaleSwitcher({ label, current, names, className }: LocaleSwitcherProps) {
  // Chemin sans préfixe de langue, tel que le connaît le routage. Une adresse
  // qui porte un jeton (invitation, désabonnement, lien de partage) n'est pas
  // recopiée dans la page : on change alors de langue depuis l'accueil.
  const currentPath = usePathname();
  const pathname = /\/[0-9a-f]{64}(?:\/|$)/.test(currentPath) ? "/" : currentPath;

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-3">
        {routing.locales.map((target) => (
          <li key={target}>
            <Link
              href={pathname}
              locale={target}
              lang={target}
              hrefLang={target}
              aria-current={target === current ? "true" : undefined}
              className={className}
            >
              {names[target] ?? target}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
