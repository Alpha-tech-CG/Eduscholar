import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brotliCompressSync,
  brotliDecompressSync,
  gunzipSync,
  gzipSync,
} from "node:zlib";
import {
  checkBudget,
  compressedSizes,
  formatTable,
  limitsFor,
  measurePages,
  pageAssets,
  parseClientReferenceManifest,
  routeOf,
} from "./lib/budget-rules.mjs";

// Petit manifeste fictif, de la forme produite par `next build`.
const fakeManifest = {
  moduleLoading: { prefix: "" },
  clientModules: {},
  entryJSFiles: {
    "[project]/node_modules/next/dist/client/components/builtin/not-found": [
      "static/chunks/router.js",
    ],
    "[project]/node_modules/next/dist/client/components/builtin/global-error": [],
    "[project]/apps/web/src/app/[locale]/layout": ["static/chunks/layout.js"],
    "[project]/apps/web/src/app/[locale]/(auth)/sign-in/page": [
      "static/chunks/layout.js",
      "static/chunks/form.js",
    ],
  },
  entryCSSFiles: {
    "[project]/apps/web/src/app/[locale]/layout": [
      { path: "static/chunks/app.css", inlined: false },
    ],
    "[project]/apps/web/src/app/[locale]/(auth)/sign-in/page": [
      { path: "static/chunks/app.css", inlined: false },
      { path: "static/chunks/inline.css", inlined: true },
    ],
  },
};

const fakeSource = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/[locale]/(auth)/sign-in/page"] = ${JSON.stringify(fakeManifest)};

`;

test("lit un manifeste de références client sans l'exécuter", () => {
  const { key, manifest } = parseClientReferenceManifest(fakeSource);
  assert.equal(key, "/[locale]/(auth)/sign-in/page");
  assert.deepEqual(manifest.entryJSFiles, fakeManifest.entryJSFiles);
  assert.throws(() => parseClientReferenceManifest("console.log(1)"));
});

test("retient le socle, chaque segment et la page, sans doublon ni polyfill", () => {
  const { js, css } = pageAssets(
    ["static/chunks/main.js", "static/chunks/layout.js"],
    fakeManifest,
  );
  assert.deepEqual(js, [
    "static/chunks/form.js",
    "static/chunks/layout.js",
    "static/chunks/main.js",
    "static/chunks/router.js",
  ]);
  // La feuille « inlined » est dans le HTML, pas un fichier à part.
  assert.deepEqual(css, ["static/chunks/app.css"]);
});

test("donne l'adresse publique de la page", () => {
  assert.equal(
    routeOf("/[locale]/(auth)/sign-in/page", {
      "/[locale]/(auth)/sign-in/page": "/[locale]/sign-in",
    }),
    "/[locale]/sign-in",
  );
  // Sans le manifeste des routes : groupes retirés, « /page » ôté.
  assert.equal(routeOf("/[locale]/(auth)/sign-up/page"), "/[locale]/sign-up");
  assert.equal(routeOf("/page"), "/");
});

test("compresse réellement en gzip et en brotli", () => {
  const content = Buffer.from("const a = 1;\n".repeat(500));
  const sizes = compressedSizes(content);
  assert.equal(sizes.raw, content.length);
  assert.ok(sizes.gzip > 0 && sizes.gzip < sizes.raw);
  assert.ok(sizes.brotli > 0 && sizes.brotli < sizes.raw);
  // Mêmes réglages que le script : le résultat se décompresse à l'identique.
  const gz = gzipSync(content, { level: 9 });
  assert.equal(gz.length, sizes.gzip);
  assert.deepEqual(gunzipSync(gz), content);
  assert.ok(brotliDecompressSync(brotliCompressSync(content)).equals(content));
});

const sizes = {
  "main.js": { raw: 1000, gzip: 400, brotli: 300 },
  "heavy.js": { raw: 5000, gzip: 2000, brotli: 1500 },
  "small.js": { raw: 100, gzip: 50, brotli: 40 },
  "app.css": { raw: 300, gzip: 100, brotli: 80 },
};
const pages = [
  { route: "/light", js: ["main.js", "small.js"], css: ["app.css"] },
  { route: "/heavy", js: ["main.js", "heavy.js"], css: ["app.css"] },
];

test("additionne les poids par page et trie du plus lourd au plus léger", () => {
  const measures = measurePages(pages, (file) => sizes[file]);
  assert.deepEqual(
    measures.map((page) => page.route),
    ["/heavy", "/light"],
  );
  assert.deepEqual(measures[0].js, { raw: 6000, gzip: 2400, brotli: 1800 });
  assert.deepEqual(measures[0].css, { raw: 300, gzip: 100, brotli: 80 });
  // « main.js » est sur toutes les pages : seul « heavy.js » est propre.
  assert.deepEqual(measures[0].own, { raw: 5000, gzip: 2000, brotli: 1500 });
  assert.match(formatTable(measures).split("\n")[2], /^\/heavy /);
});

test("les seuils d'une page priment sur ceux par défaut, mesure par mesure", () => {
  const budget = {
    default: { js: { gzip: 1000, brotli: 800 }, css: { gzip: 200 } },
    pages: { "/heavy": { js: { brotli: 2000 } } },
  };
  assert.deepEqual(limitsFor("/heavy", budget), {
    js: { gzip: 1000, brotli: 2000 },
    css: { gzip: 200 },
  });
  assert.deepEqual(limitsFor("/light", budget), budget.default);
});

test("signale la page en dépassement, la mesure et l'écart", () => {
  const measures = measurePages(pages, (file) => sizes[file]);
  const { violations, unknownPages } = checkBudget(measures, {
    default: { js: { gzip: 1000, brotli: 2000 }, css: { gzip: 200 } },
  });
  assert.deepEqual(unknownPages, []);
  assert.deepEqual(violations, [
    { route: "/heavy", label: "JavaScript gzip", actual: 2400, limit: 1000, excess: 1400 },
  ]);
});

test("accepte des pages sous leurs seuils", () => {
  const measures = measurePages(pages, (file) => sizes[file]);
  const { violations } = checkBudget(measures, {
    default: { js: { gzip: 500, brotli: 400 }, css: { gzip: 200, brotli: 100 } },
    pages: { "/heavy": { js: { gzip: 2500, brotli: 1900 } } },
  });
  assert.deepEqual(violations, []);
});

test("refuse un seuil pour une page qui n'existe plus", () => {
  const measures = measurePages(pages, (file) => sizes[file]);
  const { unknownPages } = checkBudget(measures, {
    default: {},
    pages: { "/disparue": { js: { gzip: 1 } } },
  });
  assert.deepEqual(unknownPages, ["/disparue"]);
});
