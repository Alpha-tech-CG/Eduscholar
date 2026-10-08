import { createHash } from "node:crypto";
import { THEME } from "./service-worker";

/**
 * Page hors ligne (ADR-0012) : un seul fichier, sans script, sans donnée de
 * compte, dans toutes les langues à la fois — le worker la sert quelle que soit
 * l'adresse demandée, sans savoir dans quelle langue l'utilisateur naviguait.
 */

export type OfflineTexts = {
  locale: string;
  title: string;
  description: string;
  privacy: string;
  retry: string;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const STYLE = [
  `:root{color-scheme:light dark;--bg:${THEME.light};--fg:${THEME.ink}}`,
  `@media (prefers-color-scheme:dark){:root{--bg:${THEME.dark};--fg:#ededed}}`,
  "body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans',sans-serif;line-height:1.5}",
  "main{box-sizing:border-box;max-width:40rem;margin:0 auto;padding:2rem 1rem;overflow-wrap:anywhere}",
  "section+section{margin-top:2rem;padding-top:2rem;border-top:1px solid color-mix(in srgb,var(--fg) 30%,transparent)}",
  "h1{font-size:1.5rem;margin:0 0 .5rem}",
  "p{margin:.5rem 0}",
  "a{display:inline-block;box-sizing:border-box;min-height:44px;margin-top:.5rem;padding:.6rem 1rem;border-radius:.25rem;background:var(--fg);color:var(--bg);font-weight:500;text-decoration:none}",
  "a:focus-visible{outline:3px solid;outline-offset:2px}",
].join("");

/** Politique de la page : sa feuille de style, par son empreinte, et rien d'autre. */
export function offlinePageCsp(): string {
  const hash = createHash("sha256").update(STYLE).digest("base64");
  return [
    "default-src 'none'",
    `style-src 'sha256-${hash}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function renderOfflinePage(texts: readonly OfflineTexts[]): string {
  const [first] = texts;
  if (!first) throw new Error("Page hors ligne sans texte");

  // Un lien vers l'adresse courante : il redemande la page que l'utilisateur
  // voulait ouvrir, sans script.
  const sections = texts
    .map(
      (text) =>
        `<section lang="${escapeHtml(text.locale)}">` +
        `<h1>${escapeHtml(text.title)}</h1>` +
        `<p>${escapeHtml(text.description)}</p>` +
        `<p>${escapeHtml(text.privacy)}</p>` +
        `<a href="">${escapeHtml(text.retry)}</a>` +
        "</section>",
    )
    .join("");

  return (
    "<!doctype html>" +
    `<html lang="${escapeHtml(first.locale)}" dir="ltr"><head>` +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${escapeHtml(texts.map((text) => text.title).join(" — "))}</title>` +
    `<style>${STYLE}</style>` +
    `</head><body><main>${sections}</main></body></html>`
  );
}
