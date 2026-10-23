// Mode de la page d'inscription (pilote restreint). Ce n'est qu'un affichage :
// la barrière est le réglage « Allow new users to sign up » du service
// d'authentification, qui refuse toute inscription quand il est désactivé.

export const SIGNUP_MODES = ["open", "invite_only"] as const;
export type SignUpMode = (typeof SIGNUP_MODES)[number];

/**
 * `open` quand la variable est absente ou vide (valeur par défaut), la valeur
 * elle-même quand elle est connue. Une valeur inconnue — une faute de frappe
 * en production, par exemple — ferme le formulaire : mieux vaut une page qui
 * renvoie vers l'invitation qu'un formulaire que le service refuserait.
 */
export function signUpMode(value: string | undefined): SignUpMode {
  const mode = value?.trim() ?? "";
  if (mode === "") return "open";
  return (SIGNUP_MODES as readonly string[]).includes(mode) ? (mode as SignUpMode) : "invite_only";
}
