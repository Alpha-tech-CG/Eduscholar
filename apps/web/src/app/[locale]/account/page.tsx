import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage() {
  const user = await requireUser("/account");
  const t = await getTranslations("Account");

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("email")}</dt>
        <dd data-testid="account-email">{user.email}</dd>
      </dl>

      <p className="opacity-70">{t("privacy")}</p>

      <form action={signOut}>
        <button
          type="submit"
          className="rounded border border-foreground/30 px-4 py-2 font-medium"
        >
          {t("signOut")}
        </button>
      </form>
    </section>
  );
}
