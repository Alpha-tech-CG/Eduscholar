// Courriels que l'application envoie elle-même au titulaire d'un compte
// (ADR-0009) : des avis de sécurité que le service d'authentification n'émet
// pas. Comme ses propres messages, ils sont bilingues et ne portent ni lien ni
// code : un avis ne demande jamais de cliquer. Seule l'invitation à suivre un
// projet, en fin de fichier, porte un lien — celui de la plateforme.
//
// Aucune donnée du compte n'entre dans le texte : tout y est constant.

export const NOTICE_KINDS = [
  "recovery_code_used",
  "recovery_codes_generated",
  "account_suspended",
  "account_restored",
  "new_sign_in",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

type Text = { subject: string; paragraphs: string[] };

const FR: Record<NoticeKind, Text> = {
  recovery_code_used: {
    subject: "Code de secours utilisé",
    paragraphs: [
      "Un code de secours vient d'être utilisé sur votre compte : la validation en deux étapes est désactivée, et vos autres sessions ont été fermées.",
      "Si c'est vous, réactivez-la depuis « Sécurité du compte » avec votre nouvel appareil.",
      "Si ce n'est pas vous, changez votre mot de passe sans attendre, puis réactivez la validation en deux étapes.",
    ],
  },
  recovery_codes_generated: {
    subject: "Nouveaux codes de secours",
    paragraphs: [
      "De nouveaux codes de secours viennent d'être générés pour votre compte. Les précédents ne sont plus valables.",
      "Si ce n'est pas vous, changez votre mot de passe sans attendre, puis générez de nouveaux codes.",
    ],
  },
  account_suspended: {
    subject: "Compte suspendu",
    paragraphs: [
      "Votre compte a été suspendu par l'administration de la plateforme. Vos sessions sont fermées et la connexion ne vous est plus ouverte : elle vous répondra comme à un mot de passe erroné.",
      "Vos données sont conservées. Si vous pensez qu'il s'agit d'une erreur, contactez l'assistance.",
    ],
  },
  account_restored: {
    subject: "Compte rétabli",
    paragraphs: [
      "Votre compte a été rétabli par l'administration de la plateforme. Vous pouvez de nouveau vous connecter avec votre mot de passe.",
    ],
  },
  new_sign_in: {
    subject: "Nouvelle connexion",
    paragraphs: [
      "Votre mot de passe vient d'ouvrir une connexion à votre compte depuis un navigateur que nous ne connaissions pas.",
      "Si c'est vous, vous n'avez rien à faire.",
      "Si ce n'est pas vous, changez votre mot de passe sans attendre, puis activez la validation en deux étapes depuis « Sécurité du compte ».",
    ],
  },
};

const EN: Record<NoticeKind, Text> = {
  recovery_code_used: {
    subject: "Recovery code used",
    paragraphs: [
      "A recovery code was just used on your account: two-step verification is now off, and your other sessions have been closed.",
      "If this was you, turn it back on from “Account security” with your new device.",
      "If this was not you, change your password right away, then turn two-step verification back on.",
    ],
  },
  recovery_codes_generated: {
    subject: "New recovery codes",
    paragraphs: [
      "New recovery codes were just generated for your account. The previous ones no longer work.",
      "If this was not you, change your password right away, then generate new codes.",
    ],
  },
  account_suspended: {
    subject: "Account suspended",
    paragraphs: [
      "Your account has been suspended by the platform's administrators. Your sessions are closed and you can no longer sign in: sign-in will answer as it does to a wrong password.",
      "Your data is kept. If you believe this is a mistake, contact support.",
    ],
  },
  account_restored: {
    subject: "Account restored",
    paragraphs: [
      "Your account has been restored by the platform's administrators. You can sign in again with your password.",
    ],
  },
  new_sign_in: {
    subject: "New sign-in",
    paragraphs: [
      "Your password just opened a sign-in to your account from a browser we did not know.",
      "If this was you, there is nothing to do.",
      "If this was not you, change your password right away, then turn on two-step verification from “Account security”.",
    ],
  },
};

const FOOTER_FR = "Ce message ne contient ni lien ni code, et ne vous demandera jamais d'en saisir un.";
const FOOTER_EN = "This message contains no link and no code, and will never ask you to enter one.";

const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export type NoticeMessage = { subject: string; text: string; html: string };

/** Le message d'un avis : objet et corps bilingues, en texte et en HTML. */
export function buildNotice(kind: NoticeKind): NoticeMessage {
  const fr = FR[kind];
  const en = EN[kind];

  const text = [
    "EduScholar",
    "",
    "Bonjour,",
    ...fr.paragraphs,
    FOOTER_FR,
    "",
    "----",
    "",
    "Hello,",
    ...en.paragraphs,
    FOOTER_EN,
  ].join("\n");

  const block = (lang: "fr" | "en", greeting: string, paragraphs: string[], footer: string) =>
    [`<p lang="${lang}">${greeting}</p>`, ...paragraphs.map((p) => `<p lang="${lang}">${escape(p)}</p>`),
      `<p lang="${lang}" style="font-size: 14px">${escape(footer)}</p>`].join("\n    ");

  const html = `<!doctype html>
<html lang="fr">
  <body style="font-family: system-ui, sans-serif; color: #171717; line-height: 1.5">
    <h1 style="font-size: 20px">EduScholar</h1>
    ${block("fr", "Bonjour,", fr.paragraphs, FOOTER_FR)}
    <hr />
    ${block("en", "Hello,", en.paragraphs, FOOTER_EN)}
  </body>
</html>
`;

  return { subject: `EduScholar — ${fr.subject} / ${en.subject}`, text, html };
}

/**
 * L'invitation à suivre un projet : le seul message de l'application qui porte
 * un lien, vers la plateforme elle-même. Le lien et l'adresse de la personne
 * qui invite sont les seules données variables ; le titre du projet, choisi
 * par elle, n'y figure pas — il ne servira pas à faire passer un autre message.
 */
export function buildInvitation(link: string, inviterEmail: string | null): NoticeMessage {
  // L'adresse n'est reprise que si elle ne peut pas passer pour un lien ou un
  // autre message : lettres, chiffres et ponctuation courante, sans barre
  // oblique ni préfixe « www. ». Sinon, formule neutre.
  const sober =
    inviterEmail !== null &&
    /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,190}$/i.test(inviterEmail) &&
    !/^www\./i.test(inviterEmail);
  const fromFr = sober ? `${inviterEmail} vous invite` : "Vous êtes invité";
  const fromEn = sober ? `${inviterEmail} is inviting you` : "You are invited";
  const fr = [
    `${fromFr} à suivre un projet de recherche sur EduScholar.`,
    "Pour accepter, ouvrez le lien ci-dessous et connectez-vous avec cette adresse électronique. Le lien est valable sept jours et ne sert qu'une fois.",
    "Si vous n'attendiez pas cette invitation, ignorez ce message : sans votre accord, rien n'est partagé avec vous et rien ne vous est demandé.",
  ];
  const en = [
    `${fromEn} to follow a research project on EduScholar.`,
    "To accept, open the link below and sign in with this email address. The link is valid for seven days and works only once.",
    "If you were not expecting this invitation, ignore this message: without your agreement, nothing is shared with you and nothing is asked of you.",
  ];

  const text = ["EduScholar", "", "Bonjour,", ...fr, link, "", "----", "", "Hello,", ...en, link].join("\n");
  const block = (lang: "fr" | "en", greeting: string, paragraphs: string[], label: string) =>
    [
      `<p lang="${lang}">${greeting}</p>`,
      ...paragraphs.map((p) => `<p lang="${lang}">${escape(p)}</p>`),
      `<p lang="${lang}"><a href="${escape(link)}">${label}</a></p>`,
    ].join("\n    ");
  const html = `<!doctype html>
<html lang="fr">
  <body style="font-family: system-ui, sans-serif; color: #171717; line-height: 1.5">
    <h1 style="font-size: 20px">EduScholar</h1>
    ${block("fr", "Bonjour,", fr, "Voir l'invitation")}
    <hr />
    ${block("en", "Hello,", en, "See the invitation")}
  </body>
</html>
`;

  return { subject: "EduScholar — Invitation à suivre un projet / Invitation to follow a project", text, html };
}

/**
 * Le courriel des notifications : il dit qu'il y a du nouveau, rien de plus.
 * Ni le projet, ni son titre, ni ce qui s'y est passé n'y figurent, et il ne
 * porte aucun lien vers le compte. Le seul lien est celui du désabonnement,
 * que la personne doit pouvoir suivre sans se connecter.
 */
export function buildDigest(unsubscribeFr: string, unsubscribeEn: string): NoticeMessage {
  const fr = [
    "De nouvelles notifications vous attendent sur EduScholar, à propos d'un projet que vous écrivez ou que vous suivez.",
    "Pour les lire, ouvrez EduScholar comme vous le faites d'habitude, puis la page « Notifications ». Ce message ne contient aucun lien vers votre compte et ne vous demande aucun code.",
    "Vous recevez ce courriel parce que vous l'avez demandé, au plus une fois par jour. Pour ne plus le recevoir, ouvrez le lien ci-dessous.",
  ];
  const en = [
    "New notifications are waiting for you on EduScholar, about a project you are writing or following.",
    "To read them, open EduScholar as you usually do, then the “Notifications” page. This message contains no link to your account and asks you for no code.",
    "You are receiving this email because you asked for it, at most once a day. To stop receiving it, open the link below.",
  ];

  const text = [
    "EduScholar", "", "Bonjour,", ...fr, unsubscribeFr, "", "----", "", "Hello,", ...en, unsubscribeEn,
  ].join("\n");
  const block = (lang: "fr" | "en", greeting: string, paragraphs: string[], link: string, label: string) =>
    [
      `<p lang="${lang}">${greeting}</p>`,
      ...paragraphs.map((p) => `<p lang="${lang}">${escape(p)}</p>`),
      `<p lang="${lang}" style="font-size: 14px"><a href="${escape(link)}">${label}</a></p>`,
    ].join("\n    ");
  const html = `<!doctype html>
<html lang="fr">
  <body style="font-family: system-ui, sans-serif; color: #171717; line-height: 1.5">
    <h1 style="font-size: 20px">EduScholar</h1>
    ${block("fr", "Bonjour,", fr, unsubscribeFr, "Ne plus recevoir ces courriels")}
    <hr />
    ${block("en", "Hello,", en, unsubscribeEn, "Stop receiving these emails")}
  </body>
</html>
`;

  return { subject: "EduScholar — Nouvelles notifications / New notifications", text, html };
}
