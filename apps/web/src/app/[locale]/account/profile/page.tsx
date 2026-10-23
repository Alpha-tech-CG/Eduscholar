import type { Metadata } from "next";
import { defaultLocale, isPreferenceLocale, preferenceLocales } from "@/i18n/routing";
import { getLocale, getTranslations } from "next-intl/server";
import {
  AuthForm,
  CheckboxField,
  CheckboxGroup,
  OptionalTextField,
  SelectField,
} from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { saveProfile } from "@/lib/profile/actions";
import { getOwnProfile, getReferenceData } from "@/lib/profile/queries";
import { PROFILE_GOALS } from "@/lib/profile/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Profile");
  return { title: t("title"), robots: { index: false } };
}

export default async function ProfilePage() {
  const user = await requireUser("/account/profile");
  const locale = await getLocale();
  const [profile, reference, t, tLocales] = await Promise.all([
    getOwnProfile(),
    getReferenceData(locale),
    getTranslations("Profile"),
    getTranslations("Locales"),
  ]);

  const firstTime = !profile?.onboarded;
  const programCode = profile?.programCode ?? reference.programs[0]?.code ?? "";
  const choices = <T extends { code: string; label: string }>(items: T[]) =>
    items.map((item) => ({ value: item.code, label: item.label }));

  return (
    <AuthPageShell
      title={firstTime ? t("welcomeTitle") : t("title")}
      intro={firstTime ? t("welcomeIntro") : t("intro")}
      footer={
        firstTime ? (
          <form action={signOut}>
            <button type="submit" className="underline underline-offset-4">
              {t("signOut")}
            </button>
          </form>
        ) : (
          <p>
            <Link href="/account" className="underline underline-offset-4">
              {t("back")}
            </Link>
          </p>
        )
      }
    >
      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("account")}</dt>
        <dd data-testid="account-email" className="font-medium">
          {user.email}
        </dd>
      </dl>

      <AuthForm action={saveProfile} submitLabel={t("submit")} pendingLabel={t("pending")}>
        <SelectField
          name="countryCode"
          label={t("country")}
          placeholder={t("choose")}
          options={choices(reference.countries)}
          defaultValue={profile?.countryCode ?? undefined}
          required
        />
        <SelectField
          name="levelCode"
          label={t("level")}
          placeholder={t("choose")}
          options={choices(reference.levels)}
          defaultValue={profile?.levelCode ?? undefined}
          required
        />
        <SelectField
          name="programCode"
          label={t("program")}
          placeholder={t("choose")}
          options={choices(reference.programs)}
          defaultValue={programCode}
          required
        />
        <SelectField
          name="specialtyCode"
          label={t("specialty")}
          placeholder={t("none")}
          options={choices(
            reference.specialties.filter((item) => item.programCode === programCode),
          )}
          defaultValue={profile?.specialtyCode ?? undefined}
        />
        <CheckboxGroup
          name="subjectCodes"
          legend={t("subjects")}
          options={choices(reference.subjects.filter((item) => item.programCode === programCode))}
          defaultValues={profile?.subjectCodes ?? []}
        />
        <OptionalTextField
          name="institutionName"
          label={t("institution")}
          hint={t("institutionHint")}
          defaultValue={profile?.institutionName ?? undefined}
          maxLength={200}
        />
        <CheckboxGroup
          name="goals"
          legend={t("goals")}
          options={PROFILE_GOALS.map((goal) => ({ value: goal, label: t(`goalOptions.${goal}`) }))}
          defaultValues={profile?.goals ?? []}
        />
        <SelectField
          name="preferredLocale"
          label={t("preferredLocale")}
          placeholder={t("choose")}
          options={preferenceLocales.map((code) => ({ value: code, label: tLocales(code) }))}
          defaultValue={profile?.preferredLocale ?? (isPreferenceLocale(locale) ? locale : defaultLocale)}
          required
        />

        {profile?.ageConfirmed ? null : (
          <CheckboxField name="ageConfirmed" label={t("ageConfirmed")} />
        )}
      </AuthForm>
    </AuthPageShell>
  );
}
