import { Link } from "@/i18n/navigation";
import type { HelpLink } from "@/content/help/types";

/** Liens d'une section d'aide vers les pages de l'application. Le libellé dit où mène le lien. */
export function HelpLinks({ links }: { links: HelpLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href} className="inline-block py-2 underline underline-offset-4">
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
