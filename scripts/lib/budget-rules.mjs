// Calcul du budget de performance des pages (cahier §14.3, ADR-0012).
// Partagé par check-performance-budget.mjs et ses tests.
//
// Ce qui est compté pour une page : le JavaScript que le HTML de la page fait
// charger au premier affichage, et ses feuilles de style. Le build Next.js le
// décrit dans deux manifestes :
// - `build-manifest.json` → `rootMainFiles` : le socle commun à toutes les pages ;
// - `server/app/…/page_client-reference-manifest.js` → `entryJSFiles` et
//   `entryCSSFiles` : les fichiers de chaque segment (dispositions, page, pages
//   d'erreur intégrées) que le serveur inscrit dans le HTML.
// Vérifié le 23 octobre 2026 contre le HTML réellement servi par `next start`.
// Les polyfills (`polyfillFiles`) sont exclus : chargés en `noModule`, les
// navigateurs récents les ignorent.

import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const manifestAssignment =
  /__RSC_MANIFEST\[("(?:[^"\\]|\\.)*")\]\s*=\s*/;

/**
 * Lit un `page_client-reference-manifest.js` sans l'exécuter.
 * @param {string} source contenu du fichier
 * @returns {{ key: string, manifest: Record<string, unknown> }}
 */
export function parseClientReferenceManifest(source) {
  const match = manifestAssignment.exec(source);
  if (!match) throw new Error("manifeste de références client illisible");
  const body = source
    .slice(match.index + match[0].length)
    .trim()
    .replace(/;$/, "");
  return { key: JSON.parse(match[1]), manifest: JSON.parse(body) };
}

/**
 * Fichiers chargés au premier affichage d'une page.
 * @param {string[]} rootMainFiles socle commun (build-manifest.json)
 * @param {{ entryJSFiles?: Record<string, string[]>,
 *           entryCSSFiles?: Record<string, ({ path: string, inlined?: boolean } | string)[]> }} manifest
 * @returns {{ js: string[], css: string[] }} chemins relatifs à `.next/`
 */
export function pageAssets(rootMainFiles, manifest) {
  const js = new Set(rootMainFiles.filter((file) => file.endsWith(".js")));
  for (const files of Object.values(manifest.entryJSFiles ?? {})) {
    for (const file of files) js.add(file);
  }
  const css = new Set();
  for (const files of Object.values(manifest.entryCSSFiles ?? {})) {
    for (const entry of files) {
      const path = typeof entry === "string" ? entry : entry.path;
      // Une feuille « inlined » est dans le HTML : elle n'est pas un fichier à part.
      if (typeof entry !== "string" && entry.inlined) continue;
      if (path) css.add(path);
    }
  }
  return { js: [...js].sort(), css: [...css].sort() };
}

/**
 * Adresse publique d'une page à partir de la clé du manifeste
 * (« /[locale]/(auth)/sign-in/page » → « /[locale]/sign-in »).
 * @param {string} key
 * @param {Record<string, string>} appPathRoutes app-path-routes-manifest.json
 */
export function routeOf(key, appPathRoutes = {}) {
  if (appPathRoutes[key]) return appPathRoutes[key];
  const route = key
    .replace(/\/page$/, "")
    .split("/")
    .filter((part) => !/^\(.*\)$/.test(part))
    .join("/");
  return route === "" ? "/" : route;
}

/**
 * Poids brut, gzip et brotli d'un contenu. Niveaux maximaux, comme pour des
 * fichiers compressés une fois pour toutes ; un hébergeur qui compresse à la
 * volée peut faire un peu moins bien.
 * @param {Buffer} content
 */
export function compressedSizes(content) {
  return {
    raw: content.length,
    gzip: gzipSync(content, { level: 9 }).length,
    brotli: brotliCompressSync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
      },
    }).length,
  };
}

const zero = () => ({ raw: 0, gzip: 0, brotli: 0 });

function add(total, sizes) {
  total.raw += sizes.raw;
  total.gzip += sizes.gzip;
  total.brotli += sizes.brotli;
}

/**
 * Mesure chaque page. `sizeOf` renvoie les poids d'un fichier (mis en cache par
 * l'appelant ou non). Un fichier présent sur toutes les pages est « commun » ;
 * le reste est « propre » à la page.
 * @param {{ route: string, js: string[], css: string[] }[]} pages
 * @param {(file: string) => { raw: number, gzip: number, brotli: number }} sizeOf
 */
export function measurePages(pages, sizeOf) {
  const shared = pages.length
    ? pages
        .map((page) => new Set(page.js))
        .reduce((a, b) => new Set([...a].filter((file) => b.has(file))))
    : new Set();
  return pages
    .map((page) => {
      const js = zero();
      const own = zero();
      const css = zero();
      for (const file of page.js) {
        const sizes = sizeOf(file);
        add(js, sizes);
        if (!shared.has(file)) add(own, sizes);
      }
      for (const file of page.css) add(css, sizeOf(file));
      return { route: page.route, js, own, css, files: page.js.length };
    })
    .sort((a, b) => b.js.brotli - a.js.brotli || a.route.localeCompare(b.route));
}

const metrics = [
  ["js", "gzip", "JavaScript gzip"],
  ["js", "brotli", "JavaScript brotli"],
  ["css", "gzip", "CSS gzip"],
  ["css", "brotli", "CSS brotli"],
];

/**
 * Seuils applicables à une page : ceux de la page, à défaut ceux par défaut.
 * @param {string} route
 * @param {{ default: object, pages?: Record<string, object> }} budget
 */
export function limitsFor(route, budget) {
  const own = budget.pages?.[route] ?? {};
  return {
    js: { ...budget.default?.js, ...own.js },
    css: { ...budget.default?.css, ...own.css },
  };
}

/**
 * Compare les mesures aux seuils. Renvoie les dépassements, et les pages du
 * fichier de seuils qui n'existent plus (un seuil oublié ne protège rien).
 * @param {ReturnType<typeof measurePages>} measures
 * @param {{ default: object, pages?: Record<string, object> }} budget
 */
export function checkBudget(measures, budget) {
  const violations = [];
  for (const page of measures) {
    const limits = limitsFor(page.route, budget);
    for (const [kind, codec, label] of metrics) {
      const limit = limits[kind]?.[codec];
      if (typeof limit !== "number") continue;
      const actual = page[kind][codec];
      if (actual > limit) {
        violations.push({ route: page.route, label, actual, limit, excess: actual - limit });
      }
    }
  }
  const known = new Set(measures.map((page) => page.route));
  const unknownPages = Object.keys(budget.pages ?? {}).filter(
    (route) => !known.has(route),
  );
  return { violations, unknownPages };
}

/** @param {number} bytes */
export function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} Kio`;
}

/**
 * Tableau lisible, du plus lourd au plus léger.
 * @param {ReturnType<typeof measurePages>} measures
 */
export function formatTable(measures) {
  const header = [
    "Page",
    "JS brut",
    "JS gzip",
    "JS brotli",
    "dont propre (br)",
    "CSS gzip",
    "CSS brotli",
  ];
  const rows = measures.map((page) => [
    page.route,
    kib(page.js.raw),
    kib(page.js.gzip),
    kib(page.js.brotli),
    kib(page.own.brotli),
    kib(page.css.gzip),
    kib(page.css.brotli),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]),
      )
      .join("  ");
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
}
