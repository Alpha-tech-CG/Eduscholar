import { getTranslations } from "next-intl/server";
import { captchaSiteKey } from "@/lib/auth/captcha";
import { CaptchaWidget } from "./captcha-widget";

/**
 * Défi anti-robot d'un formulaire. Ne rend rien tant que la clé de site n'est
 * pas configurée : la plateforme fonctionne sans lui.
 */
export async function Captcha() {
  const siteKey = captchaSiteKey();
  if (!siteKey) return null;
  const t = await getTranslations("Auth.captcha");
  return <CaptchaWidget siteKey={siteKey} label={t("label")} />;
}
