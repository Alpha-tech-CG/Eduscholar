import { readCaptcha } from "@/lib/auth/captcha";
import { buildPersonalDataExport } from "@/lib/account/export";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import { hasSameOrigin } from "@/lib/security/request-origin";
import { createSessionClient, verifyPassword } from "@/lib/supabase/server";

// Téléchargement de ses données personnelles, au format JSON.
//
// Requête POST venue d'un formulaire de l'application, mot de passe redemandé :
// une page tierce ne peut pas la déclencher, et une session laissée ouverte ne
// suffit pas à emporter tout le compte. Chaque export laisse une trace que le
// titulaire peut lire.

const empty = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store", ...extra } });

function backToForm(request: Request, locale: string, error: string): Response {
  const target = new URL(`/${locale}/account/export`, request.url);
  target.searchParams.set("error", error);
  return new Response(null, {
    status: 303,
    headers: { Location: `${target.pathname}${target.search}`, "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  context: RouteContext<"/[locale]/account/export/download">,
) {
  const { locale } = await context.params;
  if (!hasSameOrigin(request)) return empty(404);

  const user = await getFullySignedInUser();
  if (!user?.email) return empty(404);

  let password = "";

  let captchaToken: string | undefined;
  try {
    const formData = await request.formData();
    const value = formData.get("password");
    if (typeof value === "string") password = value;
    captchaToken = readCaptcha(formData).token;
  } catch {
    return empty(400);
  }
  if (password.length === 0 || password.length > 1024) return backToForm(request, locale, "password");

  if ((await checkAttempt("reauthentication", user.id)) !== "allowed") {
    return backToForm(request, locale, "rate");
  }
  if (!(await verifyPassword(user.email, password, captchaToken))) {
    return backToForm(request, locale, "password");
  }
  if ((await checkAttempt("data-export", user.id)) !== "allowed") {
    return backToForm(request, locale, "rate");
  }

  const data = await buildPersonalDataExport(user);
  if (!data) return backToForm(request, locale, "unavailable");

  // La trace précède la remise du fichier : pas d'export sans elle.
  const supabase = await createSessionClient();
  const logged = await supabase.rpc("log_personal_data_export");
  if (logged.error) return backToForm(request, locale, "unavailable");

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="eduscholar-mes-donnees.json"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
