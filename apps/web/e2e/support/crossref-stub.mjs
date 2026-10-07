#!/usr/bin/env node
// Faux serveur Crossref pour les tests de bout en bout : les tests ne dépendent
// d'aucun service externe et n'envoient rien à la vraie source.
//
// Les DOI utilisent le préfixe 10.5555, réservé par Crossref aux exemples. Tout
// DOI de la forme 10.5555/e2e.article.<suffixe> renvoie un article.

import { createServer } from "node:http";

const port = Number(process.env.CROSSREF_STUB_PORT ?? 3199);

function work(doi) {
  if (/^10\.5555\/e2e\.article\.[a-z0-9-]+$/.test(doi)) {
    return {
      DOI: doi,
      type: "journal-article",
      title: [`Article de test <i>${doi.split(".").pop()}</i>`],
      author: [{ given: "Awa", family: "Diop" }, { given: "Kofi", family: "Mensah" }],
      issued: { "date-parts": [[2024, 5]] },
      language: "en",
      license: [{ URL: "https://creativecommons.org/licenses/by/4.0/", "content-version": "vor" }],
      abstract: "<jats:p>Résumé du faux serveur, à ne jamais reprendre.</jats:p>",
    };
  }
  if (/^10\.5555\/e2e\.sans-langue\.[a-z0-9-]+$/.test(doi)) {
    return { DOI: doi, type: "book", title: ["Livre sans langue déclarée"], author: [{ name: "Collectif" }] };
  }
  if (doi === "10.5555/e2e.dataset") {
    return { DOI: doi, type: "dataset", title: ["Jeu de données"] };
  }
  if (doi === "10.5555/e2e.autre-doi") {
    return { DOI: "10.5555/e2e.usurpe", type: "journal-article", title: ["Réponse pour un autre DOI"] };
  }
  return null;
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }

  const match = /^\/works\/(.+)$/.exec(url.pathname);
  const doi = match ? decodeURIComponent(match[1]).toLowerCase() : "";

  if (doi === "10.5555/e2e.trop-de-requetes") {
    response.writeHead(429, { "retry-after": "120", "content-type": "text/plain" }).end("trop de requêtes");
    return;
  }

  if (doi === "10.5555/e2e.redirection") {
    response.writeHead(302, { location: "http://127.0.0.1:1/interne" }).end();
    return;
  }
  if (doi === "10.5555/e2e.panne") {
    response.writeHead(503, { "content-type": "text/plain" }).end("indisponible");
    return;
  }

  const message = work(doi);
  if (!message) {
    response.writeHead(404, { "content-type": "text/plain" }).end("Resource not found.");
    return;
  }
  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ status: "ok", "message-type": "work", message }));
}).listen(port, "127.0.0.1");
