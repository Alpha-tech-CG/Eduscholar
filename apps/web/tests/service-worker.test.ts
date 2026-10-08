import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { CACHE_PREFIX, OFFLINE_PAGE_URL } from "@/lib/offline/service-worker";

// ADR-0012. Le fichier servi au navigateur, `public/sw.js`, est exécuté ici tel
// quel, avec un faux cache et un faux réseau : c'est lui qui est vérifié, pas
// une copie de ses règles.

const ORIGIN = "https://eduscholar.test";
const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const source = readFileSync(fromRoot("public/sw.js"), "utf8");

type FakeRequest = { method: string; url: string; mode: string; credentials?: string; cache?: string };
type Listener = (event: {
  request?: FakeRequest;
  waitUntil: (work: Promise<unknown>) => void;
  respondWith: (response: Promise<Response>) => void;
}) => void;
type Strategy = (request: FakeRequest, origin: string) => "static" | "navigate" | "bypass";

class FakeCache {
  entries = new Map<string, Response>();
  async match(request: FakeRequest | string) {
    return this.entries.get(keyOf(request))?.clone();
  }
  async put(request: FakeRequest | string, response: Response) {
    this.entries.set(keyOf(request), response);
  }
  async addAll(requests: FakeRequest[]) {
    for (const request of requests) this.entries.set(keyOf(request), await this.network(request));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request: FakeRequest | string) {
    return this.entries.delete(keyOf(request));
  }
  constructor(private network: (request: FakeRequest) => Promise<Response>) {}
}

/** Une réponse de l'origine, telle que le navigateur la présente au worker. */
function basic(body: string, init: ResponseInit = {}): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}
const IMMUTABLE = { "Cache-Control": "public, max-age=31536000, immutable" };

const keyOf = (request: FakeRequest | string) =>
  new URL(typeof request === "string" ? request : request.url, ORIGIN).href;

function boot(options: { retired?: boolean; existing?: string[] } = {}) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, FakeCache>();
  const fetched: FakeRequest[] = [];
  const state = { online: true, unregistered: false, claimed: false, skipped: false };
  let reply: (request: FakeRequest) => Response = () =>
    basic("contenu", { headers: IMMUTABLE });

  const network = async (request: FakeRequest) => {
    fetched.push(request);
    if (!state.online) throw new TypeError("Failed to fetch");
    return reply(request);
  };
  const open = (name: string) => {
    const store = stores.get(name) ?? new FakeCache(network);
    stores.set(name, store);
    return store;
  };
  for (const name of options.existing ?? []) open(name);

  const context = vm.createContext({
    URL,
    Response,
    // Une requête fabriquée par le worker : seuls ses champs utiles sont gardés.
    Request: class {
      url: string;
      method = "GET";
      mode = "same-origin";
      credentials?: string;
      cache?: string;
      constructor(url: string, init: { credentials?: string; cache?: string } = {}) {
        this.url = new URL(url, ORIGIN).href;
        this.credentials = init.credentials;
        this.cache = init.cache;
      }
    },
    fetch: network,
    caches: {
      open: async (name: string) => open(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      skipWaiting: async () => {
        state.skipped = true;
      },
      clients: {
        claim: async () => {
          state.claimed = true;
        },
      },
      registration: {
        unregister: async () => {
          state.unregistered = true;
        },
      },
    },
  });
  const code = options.retired
    ? source.replace("const RETIRED = false;", "const RETIRED = true;")
    : source;
  if (options.retired) expect(code).not.toBe(source);
  vm.runInContext(code, context);

  /** Déclenche un événement et attend le travail qu'il annonce. */
  const dispatch = async (type: string, request?: FakeRequest) => {
    const work: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)?.({
      request,
      waitUntil: (promise) => work.push(promise),
      respondWith: (promise) => {
        response = promise;
      },
    });
    await Promise.all(work);
    return response ? await response : undefined;
  };

  return {
    stores,
    fetched,
    state,
    dispatch,
    strategyFor: (context as { strategyFor: Strategy }).strategyFor,
    setReply: (next: typeof reply) => {
      reply = next;
    },
    cached: () => [...stores.values()].flatMap((store) => [...store.entries.keys()]),
  };
}

const get = (path: string, mode = "no-cors"): FakeRequest => ({
  method: "GET",
  url: new URL(path, ORIGIN).href,
  mode,
});

describe("stratégie du service worker", () => {
  const { strategyFor } = boot();
  const of = (request: FakeRequest) => strategyFor(request, ORIGIN);

  it("ne garde que les fichiers publics immuables", () => {
    for (const path of [
      "/_next/static/chunks/main-abc123.js",
      "/_next/static/css/app.css",
      "/manifest.webmanifest",
      "/offline.html",
      "/icons/icon-192.png",
      "/icons/icon-maskable.svg",
    ]) {
      expect(of(get(path)), path).toBe("static");
    }
  });

  it("ne se mêle d'aucune requête qui peut dépendre de la session", () => {
    for (const path of [
      // Données de pages demandées par le routeur de Next.js.
      "/fr/projects?_rsc=1abcd",
      "/fr/account",
      "/fr/projects/3f0e/outline/9a1b",
      "/_next/data/build/fr/account.json",
      "/_next/image?url=%2Ficons%2Ficon.svg&w=64&q=75",
      "/api/cron/notification-digest",
      "/api",
      "/fr/account/export/download",
      "/fr/projects/3f0e/export/docx",
      "/favicon.ico",
      "/sw.js",
      "/",
      // Un fichier du build suivi de paramètres n'est plus un fichier connu.
      "/_next/static/chunks/main.js?user=1",
      "/_next/static/../../fr/account",
      "/_next/static//fr/account",
      "/_next/staticx/file.js",
      "/icons/autre.png",
    ]) {
      expect(of(get(path)), path).toBe("bypass");
    }
  });

  it("ne traite que les lectures : jamais une action serveur ni un envoi de formulaire", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(of({ ...get("/_next/static/chunks/main.js"), method }), method).toBe("bypass");
      expect(of({ ...get("/fr/projects", "navigate"), method }), method).toBe("bypass");
    }
  });

  it("ignore les autres origines et les adresses illisibles", () => {
    expect(of({ method: "GET", url: "https://challenges.cloudflare.com/turnstile/v0/api.js", mode: "no-cors" })).toBe("bypass");
    expect(of({ method: "GET", url: "https://autre.test/_next/static/a.js", mode: "no-cors" })).toBe("bypass");
    expect(of({ method: "GET", url: "https://autre.test/fr", mode: "navigate" })).toBe("bypass");
    expect(of({ method: "GET", url: "pas une adresse", mode: "navigate" })).toBe("bypass");
  });

  it("demande toute page au réseau, sauf l'API", () => {
    expect(of(get("/fr/account", "navigate"))).toBe("navigate");
    expect(of(get("/fr/projects/3f0e?notice=saved", "navigate"))).toBe("navigate");
    expect(of(get("/api/cron/notification-digest", "navigate"))).toBe("bypass");
  });
});

describe("installation et activation", () => {
  it("garde la liste fermée des fichiers publics, demandés sans cookie", async () => {
    const worker = boot();
    await worker.dispatch("install");

    expect(worker.cached().map((url) => new URL(url).pathname).sort()).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/icons/icon-maskable.svg",
      "/icons/icon.svg",
      "/manifest.webmanifest",
      OFFLINE_PAGE_URL,
    ]);
    expect(worker.fetched.every((request) => request.credentials === "omit")).toBe(true);
    expect(worker.fetched.every((request) => request.cache === "reload")).toBe(true);
    expect(worker.state.skipped).toBe(true);
  });

  it("ne garde que des fichiers qui existent dans `public`, ou des routes connues", () => {
    const worker = boot();
    const routes = ["/manifest.webmanifest", OFFLINE_PAGE_URL];
    return worker.dispatch("install").then(() => {
      for (const url of worker.cached()) {
        const path = new URL(url).pathname;
        if (!routes.includes(path)) expect(existsSync(fromRoot(`public${path}`)), path).toBe(true);
      }
    });
  });

  it("supprime à l'activation les caches des versions précédentes, et eux seuls", async () => {
    const worker = boot({ existing: [`${CACHE_PREFIX}v0`, `${CACHE_PREFIX}ancien`, "autre-application"] });
    await worker.dispatch("install");
    await worker.dispatch("activate");

    const names = [...worker.stores.keys()];
    expect(names).toContain("autre-application");
    expect(names.filter((name) => name.startsWith(CACHE_PREFIX))).toHaveLength(1);
    expect(names).not.toContain(`${CACHE_PREFIX}v0`);
    expect(worker.state.claimed).toBe(true);
  });
});

describe("requêtes", () => {
  it("en ligne, rend la réponse du réseau telle quelle et ne garde aucune page", async () => {
    const worker = boot();
    await worker.dispatch("install");
    const before = worker.cached();
    const page = new Response("<p>Mon compte</p>", { headers: { "Cache-Control": "private, no-store" } });
    worker.setReply(() => page);

    const response = await worker.dispatch("fetch", get("/fr/account", "navigate"));

    expect(response).toBe(page);
    expect(worker.cached()).toEqual(before);
  });

  it("hors ligne, rend la page hors ligne à la place de la page demandée", async () => {
    const worker = boot();
    worker.setReply(() => new Response("page hors ligne", { headers: { "Content-Type": "text/html" } }));
    await worker.dispatch("install");
    worker.state.online = false;

    const response = await worker.dispatch("fetch", get("/fr/account", "navigate"));

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Content-Type")).toBe("text/html");
    expect(await response?.text()).toBe("page hors ligne");
  });

  it("une page vue en ligne n'est pas rendue hors ligne", async () => {
    const worker = boot();
    worker.setReply((request) =>
      new Response(request.url.endsWith(OFFLINE_PAGE_URL) ? "page hors ligne" : "<p>Mon mémoire privé</p>"),
    );
    await worker.dispatch("install");
    await worker.dispatch("fetch", get("/fr/projects/3f0e", "navigate"));
    worker.state.online = false;

    const response = await worker.dispatch("fetch", get("/fr/projects/3f0e", "navigate"));

    expect(await response?.text()).toBe("page hors ligne");
  });

  it("laisse au navigateur ce qui ne le concerne pas", async () => {
    const worker = boot();
    await worker.dispatch("install");
    const count = worker.fetched.length;

    for (const request of [
      get("/fr/projects?_rsc=1abcd", "cors"),
      get("/api/cron/notification-digest", "cors"),
      { ...get("/fr/projects/3f0e/outline/9a1b", "cors"), method: "POST" },
    ]) {
      expect(await worker.dispatch("fetch", request)).toBeUndefined();
    }
    expect(worker.fetched).toHaveLength(count);
  });

  it("garde un fichier du build à sa première lecture, puis le sert sans réseau", async () => {
    const worker = boot();
    await worker.dispatch("install");
    const chunk = get("/_next/static/chunks/main-abc123.js");

    const first = await worker.dispatch("fetch", chunk);
    expect(await first?.text()).toBe("contenu");
    worker.state.online = false;
    const second = await worker.dispatch("fetch", chunk);

    expect(await second?.text()).toBe("contenu");
  });

  it("ne garde ni une erreur, ni une réponse privée, ni une réponse non conservable", async () => {
    const worker = boot();
    await worker.dispatch("install");
    const before = worker.cached();
    const replies = [
      basic("introuvable", { status: 404, headers: IMMUTABLE }),
      basic("erreur", { status: 500, headers: IMMUTABLE }),
      basic("partiel", { status: 206, headers: IMMUTABLE }),
      basic("privé", { headers: { "Cache-Control": "private, max-age=60" } }),
      basic("éphémère", { headers: { "Cache-Control": "no-store" } }),
      // Réponse d'une autre origine, ou opaque : son type n'est pas « basic ».
      new Response("ailleurs", { headers: IMMUTABLE }),
    ];

    for (const [index, reply] of replies.entries()) {
      worker.setReply(() => reply);
      await worker.dispatch("fetch", get(`/_next/static/chunks/${index}.js`));
    }

    expect(worker.cached()).toEqual(before);
  });

  it("borne le nombre de fichiers du build gardés, sans toucher à la page hors ligne", async () => {
    const worker = boot();
    await worker.dispatch("install");
    const fixed = worker.cached().length;

    for (let index = 0; index < 230; index += 1) {
      await worker.dispatch("fetch", get(`/_next/static/chunks/${index}.js`));
    }

    const paths = worker.cached().map((url) => new URL(url).pathname);
    expect(paths).toHaveLength(fixed + 200);
    expect(paths).toContain(OFFLINE_PAGE_URL);
    // Les plus anciens sont partis, les plus récents restent.
    expect(paths).not.toContain("/_next/static/chunks/0.js");
    expect(paths).toContain("/_next/static/chunks/229.js");
  });
});

describe("retrait du service worker", () => {
  it("vide ses caches, se désinscrit et ne répond plus à rien", async () => {
    const worker = boot({ retired: true, existing: [`${CACHE_PREFIX}v1`, "autre-application"] });
    await worker.dispatch("install");
    await worker.dispatch("activate");

    expect([...worker.stores.keys()]).toEqual(["autre-application"]);
    expect(worker.state.unregistered).toBe(true);
    expect(worker.state.claimed).toBe(false);
    expect(await worker.dispatch("fetch", get("/fr/account", "navigate"))).toBeUndefined();
    expect(await worker.dispatch("fetch", get("/_next/static/chunks/main.js"))).toBeUndefined();
    expect(worker.fetched).toHaveLength(0);
  });
});

describe("contenu du fichier", () => {
  it("n'utilise ni stockage persistant de données, ni script importé, ni synchronisation en arrière-plan", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/indexedDB|localStorage|sessionStorage|importScripts|eval\(|\bsync\b|SyncManager|\bpush\b|cookie/i);
  });
});
