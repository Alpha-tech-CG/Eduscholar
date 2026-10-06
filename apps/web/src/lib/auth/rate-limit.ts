import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { clientAddress } from "./client-address";

// Limitation de débit des opérations d'authentification (modèle de menaces
// M-01, M-35). Les compteurs sont en base : ils valent pour toutes les
// instances du serveur. Les clés sont des empreintes ; ni l'adresse IP ni
// l'adresse électronique ne sont stockées.
//
// Trois compteurs, consultés dans cet ordre :
//  1. par adresse IP : freine un client qui vise de nombreux comptes ;
//  2. par couple adresse IP + compte : c'est le refus courant. Il ne gêne que
//     le client fautif, pas le titulaire qui se connecte d'ailleurs ;
//  3. par compte, toutes origines confondues, avec un seuil nettement plus
//     haut : il n'intervient que face à une attaque répartie. Un attaquant
//     peut l'atteindre pour gêner un compte précis ; le coût est volontairement
//     élevé, et un défi (CAPTCHA) remplacera ce refus (dette D-09).
//
// Un compteur n'est consommé que si le précédent a accepté.

type Rule = { limit: number; windowSeconds: number };
type Rules = { ip?: Rule; pair?: Rule; account?: Rule };

const MINUTE = 60;
const HOUR = 60 * MINUTE;

const RULES = {
  "sign-in": {
    ip: { limit: 100, windowSeconds: 15 * MINUTE },
    pair: { limit: 10, windowSeconds: 15 * MINUTE },
    account: { limit: 100, windowSeconds: 15 * MINUTE },
  },
  "sign-up": {
    ip: { limit: 20, windowSeconds: HOUR },
    account: { limit: 5, windowSeconds: HOUR },
  },
  "password-reset": {
    ip: { limit: 20, windowSeconds: HOUR },
    account: { limit: 3, windowSeconds: HOUR },
  },
  "token-confirm": {
    ip: { limit: 30, windowSeconds: 15 * MINUTE },
  },
  "password-update": {
    ip: { limit: 20, windowSeconds: HOUR },
  },
  // Mot de passe redemandé pour une action sensible. Compteur distinct de la
  // connexion : des essais ratés ici ne consomment pas la limite du titulaire.
  // Codes du second facteur : six chiffres, donc peu d'essais permis.
  "second-factor": {
    ip: { limit: 60, windowSeconds: 15 * MINUTE },
    pair: { limit: 8, windowSeconds: 15 * MINUTE },
    account: { limit: 30, windowSeconds: 15 * MINUTE },
  },
  // Recherche dans le catalogue : large pour un usage normal, borne un robot.
  // Limite par compte seulement : l'action exige une session, et une limite
  // par adresse laisserait un seul compte bloquer tout un campus placé derrière
  // la même adresse.
  search: {
    account: { limit: 150, windowSeconds: 5 * MINUTE },
  },
  // Import par DOI (modération) : une requête vers la source par essai.
  "doi-import": {
    account: { limit: 60, windowSeconds: 15 * MINUTE },
  },
  reauthentication: {
    ip: { limit: 20, windowSeconds: 15 * MINUTE },
    pair: { limit: 5, windowSeconds: 15 * MINUTE },
  },
} satisfies Record<string, Rules>;

export type RateLimitedAction = keyof typeof RULES;
export type RateLimitVerdict = "allowed" | "client_limited" | "account_limited";

function fingerprint(action: string, kind: string, value: string): string {
  const digest = createHash("sha256").update(`${action}:${kind}:${value}`).digest("hex");
  return `${action}:${kind}:${digest.slice(0, 40)}`;
}

async function consume(key: string, rule: Rule): Promise<boolean> {
  const { data, error } = await createServiceClient().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  // En cas de panne du compteur, on refuse : mieux vaut une connexion
  // momentanément impossible qu'une limite inopérante.
  if (error) return false;
  return data === true;
}

/**
 * Compte une tentative et dit si elle est autorisée.
 *
 * `account_limited` signifie que la limite propre au compte visé est atteinte :
 * l'appelant ne doit pas le révéler lorsque cela renseignerait sur l'existence
 * du compte.
 */
export async function checkAttempt(
  action: RateLimitedAction,
  email?: string,
): Promise<RateLimitVerdict> {
  const rules: Rules = RULES[action];
  // Une règle sans compteur d'adresse ni de couple ne lit pas l'adresse.
  const address = rules.ip || rules.pair ? clientAddress(await headers()) : "";

  if (rules.ip && !(await consume(fingerprint(action, "ip", address), rules.ip))) {
    return "client_limited";
  }
  if (email && rules.pair) {
    const pairKey = fingerprint(action, "pair", `${address}|${email}`);
    if (!(await consume(pairKey, rules.pair))) return "client_limited";
  }
  if (email && rules.account) {
    if (!(await consume(fingerprint(action, "account", email), rules.account))) {
      return "account_limited";
    }
  }
  return "allowed";
}
