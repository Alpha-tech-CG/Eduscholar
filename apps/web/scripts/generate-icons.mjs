#!/usr/bin/env node
// Produit les icônes de l'application installable (ADR-0012), sans dépendance :
// le dessin n'est fait que de rectangles, tracés à l'identique en SVG et en PNG.
// Usage, depuis apps/web : node scripts/generate-icons.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const GRID = 512;
const BACKGROUND = [0x17, 0x17, 0x17];
const INK = [0xff, 0xff, 0xff];

// La lettre « E », sur une grille de 512, centrée : [x, y, largeur, hauteur].
const LETTER = [
  [176, 152, 48, 208],
  [176, 152, 160, 48],
  [176, 232, 128, 48],
  [176, 312, 160, 48],
];

/** Agrandit le dessin autour du centre de la grille. */
function scaled(factor) {
  const around = (value) => GRID / 2 + (value - GRID / 2) * factor;
  return LETTER.map(([x, y, width, height]) => [around(x), around(y), width * factor, height * factor]);
}

// Icône « maskable » : le dessin tient dans la zone sûre (cercle de 40 % du côté),
// le fond couvre tout. Icône ordinaire : le même dessin, plus grand.
const designs = { maskable: scaled(1), any: scaled(1.5) };

const hex = (color) => `#${color.map((part) => part.toString(16).padStart(2, "0")).join("")}`;

function svg(rects) {
  const shapes = rects
    .map(([x, y, width, height]) => `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">` +
    `<rect width="${GRID}" height="${GRID}" fill="${hex(BACKGROUND)}"/>` +
    `<g fill="${hex(INK)}">${shapes}</g></svg>\n`
  );
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function png(rects, size) {
  const ratio = size / GRID;
  const boxes = rects.map(([x, y, width, height]) => [
    Math.round(x * ratio),
    Math.round(y * ratio),
    Math.round((x + width) * ratio),
    Math.round((y + height) * ratio),
  ]);
  // Une ligne : un octet de filtre (aucun), puis trois octets par point.
  const row = 1 + size * 3;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inked = boxes.some(([left, top, right, bottom]) => x >= left && x < right && y >= top && y < bottom);
      raw.set(inked ? INK : BACKGROUND, y * row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits par couleur, RVB, sans entrelacement
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "icon.svg"), svg(designs.any));
writeFileSync(join(out, "icon-maskable.svg"), svg(designs.maskable));
writeFileSync(join(out, "icon-192.png"), png(designs.any, 192));
writeFileSync(join(out, "icon-512.png"), png(designs.any, 512));
writeFileSync(join(out, "icon-maskable-512.png"), png(designs.maskable, 512));
console.log(`Icônes écrites dans ${out}`);
