// Service worker d'EduScholar (ADR-0012). Écrit à la main, sans bibliothèque.
//
// Il ne garde que des fichiers publics et identiques pour tous : les fichiers
// statiques immuables du build, les icônes, le manifeste et la page hors ligne.
// Il ne garde JAMAIS une page, une réponse d'action serveur, une réponse de
// l'API ni rien qui dépende de la session : ces requêtes ne passent même pas
// par lui. En ligne, il ne modifie aucune réponse.

/** À changer pour vider les caches des versions précédentes à l'activation. */
const VERSION = "v1";
/**
 * Retrait d'urgence : à « true », le worker vide ses caches et se désinscrit
 * dès son activation. Passer aussi `SERVICE_WORKER_ENABLED` à « false » dans
 * `src/lib/offline/service-worker.ts`, pour que les pages ne le réinscrivent pas.
 */
const RETIRED = false;

const CACHE_PREFIX = "eduscholar-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const OFFLINE_URL = "/offline.html";
/** Fichiers gardés dès l'installation : la liste est fermée. */
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];
/** Fichiers du build : leur nom porte l'empreinte de leur contenu. */
const IMMUTABLE_PREFIX = "/_next/static/";
/** Au-delà, les fichiers les plus anciens du build sont retirés du cache. */
const MAX_ENTRIES = 200;

/**
 * Ce que le worker fait d'une requête :
 * - « static » : fichier public immuable, servi depuis le cache puis le réseau ;
 * - « navigate » : page demandée au réseau, jamais gardée ; sans réseau, la
 *   page hors ligne ;
 * - « bypass » : le worker ne s'en mêle pas. C'est le cas par défaut : toute
 *   adresse qui n'est pas explicitement publique et immuable.
 */
function strategyFor(request, origin) {
  if (request.method !== "GET") return "bypass";
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "bypass";
  }
  if (url.origin !== origin) return "bypass";
  // L'API ne passe jamais par le worker, même ouverte dans un onglet.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return "bypass";
  if (request.mode === "navigate") return "navigate";
  // Une adresse avec paramètres n'est jamais un fichier statique connu.
  if (url.search !== "") return "bypass";
  if (url.pathname.includes("..") || url.pathname.includes("//")) return "bypass";
  // Point, barre ou barre inverse écrits en code : jamais un fichier du build.
  if (/%2e|%2f|%5c/i.test(url.pathname)) return "bypass";
  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) return "static";
  if (PRECACHE.includes(url.pathname)) return "static";
  return "bypass";
}

/** Seule une réponse complète, de l'origine, et non privée entre dans le cache. */
function isCacheable(response) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  // Une réponse obtenue après redirection n'est pas le fichier demandé.
  if (response.redirected) return false;
  // Une réponse qui varie selon la session ou l'appelant n'est pas la même pour tous.
  const vary = (response.headers.get("Vary") || "").toLowerCase();
  if (vary.includes("*") || vary.includes("cookie") || vary.includes("authorization")) return false;
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !cacheControl.includes("no-store") && !cacheControl.includes("private");
}

async function trim(cache) {
  const keys = await cache.keys();
  const builds = keys.filter((key) => new URL(key.url).pathname.startsWith(IMMUTABLE_PREFIX));
  const excess = builds.length - MAX_ENTRIES;
  // Les clés sont rendues dans l'ordre d'insertion : les premières sont les plus anciennes.
  for (let index = 0; index < excess; index += 1) await cache.delete(builds[index]);
}

// Le cache est un confort : s'il ne s'ouvre pas ou refuse une écriture
// (stockage plein sur un petit téléphone), la réponse du réseau est rendue
// quand même. L'écriture se fait après la réponse, jamais sur son chemin.
async function fromCacheThenNetwork(event) {
  const request = event.request;
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
  } catch {
    cache = undefined;
  }
  const response = await fetch(request);
  if (cache && isCacheable(response)) {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        try {
          await cache.put(request, copy);
          await trim(cache);
        } catch {
          // Écriture refusée : rien à faire, le fichier a été servi.
        }
      })(),
    );
  }
  return response;
}

async function fromNetworkOrOfflinePage(request) {
  try {
    // La réponse du réseau est rendue telle quelle, redirections comprises.
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const page = await cache.match(OFFLINE_URL);
    if (!page) return Response.error();
    // 503 : ni le navigateur ni un outil ne prend cette page pour la page demandée.
    const headers = new Headers(page.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(page.body, { status: 503, headers });
  }
}

async function deleteCaches(keep) {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== keep)
      .map((name) => caches.delete(name)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (!RETIRED) {
        const cache = await caches.open(CACHE_NAME);
        // Sans cookie de session, et sans passer par le cache HTTP du navigateur.
        await cache.addAll(
          PRECACHE.map((path) => new Request(path, { cache: "reload", credentials: "omit" })),
        );
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (RETIRED) {
        await deleteCaches(null);
        await self.registration.unregister();
        return;
      }
      await deleteCaches(CACHE_NAME);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (RETIRED) return;
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === "static") event.respondWith(fromCacheThenNetwork(event));
  else if (strategy === "navigate") event.respondWith(fromNetworkOrOfflinePage(event.request));
  // « bypass » : pas de `respondWith`, le navigateur traite la requête lui-même.
});
