import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";

type AuthPageShellProps = {
  title: string;
  intro?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Page plus large, pour les fiches et les listes. */
  wide?: boolean;
};

/**
 * Cadre commun des pages d'authentification. Seuls les messages du formulaire
 * sont transmis aux composants client.
 */
export async function AuthPageShell({
  title,
  intro,
  children,
  footer,
  wide = false,
}: AuthPageShellProps) {
  const messages = await getMessages();

  return (
    <section
      className={
        wide
          ? "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-10"
          : "mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-10"
      }
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro ? <p className="opacity-80">{intro}</p> : null}
      </div>
      <NextIntlClientProvider messages={{ Auth: messages.Auth }}>
        {children}
      </NextIntlClientProvider>
      {footer ? <div className="flex flex-col gap-2 text-sm">{footer}</div> : null}
    </section>
  );
}
