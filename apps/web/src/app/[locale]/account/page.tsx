import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { getOwnProfile, getReferenceData, type Option } from "@/lib/profile/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("title"), robots: { index: false } };
}

function labelOf(options: Option[], code: string | null): string | null {
  return options.find((option) => option.code === code)?.label ?? null;
}

export default async function AccountPage({
  searchParams,
}: PageProps<"/[locale]/account">) {
  const user = await requireUser("/account");
  const locale = await getLocale();

  // Première connexion : le profil minimal et la déclaration d'âge sont demandés
  // avant tout le reste, quel que soit le chemin par lequel le compte a été créé.
  const profile = await getOwnProfile();
  if (!profile?.onboarded) {
    return redirect({ href: "/account/profile", locale });
  }

  const t = await getTranslations("Account");
  const reference = await getReferenceData(locale);
  const { notice } = await searchParams;

  const rows: Array<[string, string | null]> = [
    [t("email"), user.email ?? null],
    [t("country"), labelOf(reference.countries, profile.countryCode)],
    [t("level"), labelOf(reference.levels, profile.levelCode)],
    [t("program"), labelOf(reference.programs, profile.programCode)],
    [
      t("specialty"),
      labelOf(
        reference.specialties.filter((item) => item.programCode === profile.programCode),
        profile.specialtyCode,
      ),
    ],
    [t("institution"), profile.institutionName],
  ];

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {notice === "profile-saved" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("profileSaved")}
        </p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
        {rows.map(([term, value], index) => (
          <div key={term} className="contents">
            <dt className="text-sm opacity-70">{term}</dt>
            <dd data-testid={index === 0 ? "account-email" : undefined}>
              {value ?? t("notProvided")}
            </dd>
          </div>
        ))}
      </dl>

      <p className="opacity-70">{t("privacy")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/account/profile"
          className="rounded bg-foreground px-4 py-2 font-medium text-background"
        >
          {t("editProfile")}
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded border border-foreground/30 px-4 py-2 font-medium"
          >
            {t("signOut")}
          </button>
        </form>
      </div>

      <p className="text-sm">
        <Link href="/account/delete" className="underline underline-offset-4">
          {t("deleteAccount")}
        </Link>
      </p>
    </section>
  );
}
