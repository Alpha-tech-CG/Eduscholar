import { promisify } from "node:util";
import * as zlib from "node:zlib";

const deflateRaw = promisify(zlib.deflateRaw);
import { DOCUMENT_LANGUAGE_TAGS, isDocumentLocale } from "./bibliography";
import type { ProjectDocument } from "./document";

// Fichier DOCX écrit directement : c'est une archive ZIP de quelques fichiers
// XML (norme ECMA-376). Aucune bibliothèque tierce n'est utilisée.
//
// Tout texte de l'utilisateur passe par `xml()`, qui l'échappe et en retire les
// caractères interdits en XML : un titre ne peut ni casser le document ni y
// introduire de balise.

/** Échappe un texte pour XML et retire les caractères que XML 1.0 n'admet pas. */
export function xml(text: string): string {
  return text
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(text: string, italic = false): string {
  if (!text) return "";
  return `<w:r>${italic ? "<w:rPr><w:i/></w:rPr>" : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function paragraph(style: string, content: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${content}</w:p>`;
}

const BREAK = "<w:r><w:br/></w:r>";

function documentXml(document: ProjectDocument): string {
  const body: string[] = [paragraph("Title", run(document.title))];
  if (document.supervisorName) {
    body.push(paragraph("Subtitle", run(`${document.labels.supervisor} ${document.supervisorName}`)));
  }

  for (const section of document.sections) {
    body.push(paragraph(`Heading${section.level}`, run(`${section.number} ${section.title}`)));
    for (const lines of section.paragraphs) {
      body.push(paragraph("Normal", lines.map((line) => run(line)).join(BREAK)));
    }
    if (section.citations.length > 0) {
      body.push(
        paragraph("Cited", run(`${document.labels.cited} ${section.citations.join(" ; ")}`)),
      );
    }
  }

  if (document.references.length > 0) {
    body.push(paragraph("Heading1", run(document.labels.references)));
    for (const segments of document.references) {
      body.push(
        paragraph("Reference", segments.map((segment) => run(segment.text, segment.italic)).join("")),
      );
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body.join("")}` +
    // Page A4, marges de 2,5 cm.
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>"
  );
}

function stylesXml(locale: string): string {
  const language = isDocumentLocale(locale) ? DOCUMENT_LANGUAGE_TAGS[locale] : DOCUMENT_LANGUAGE_TAGS.fr;
  const style = (id: string, name: string, properties: string, runProperties = "", basedOn = "Normal") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${id === "Normal" ? "" : `<w:basedOn w:val="${basedOn}"/><w:next w:val="Normal"/>`}<w:pPr>${properties}</w:pPr>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ""}</w:style>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${language}"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:style>` +
    style("Title", "Title", '<w:spacing w:before="0" w:after="240"/><w:jc w:val="center"/>', '<w:b/><w:sz w:val="40"/><w:szCs w:val="40"/>') +
    style("Subtitle", "Subtitle", '<w:spacing w:after="480"/><w:jc w:val="center"/>', '<w:sz w:val="26"/><w:szCs w:val="26"/>') +
    style("Heading1", "heading 1", '<w:keepNext/><w:spacing w:before="480" w:after="200"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/>') +
    style("Heading2", "heading 2", '<w:keepNext/><w:spacing w:before="320" w:after="160"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="28"/><w:szCs w:val="28"/>') +
    style("Heading3", "heading 3", '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/>', '<w:b/><w:i/><w:sz w:val="24"/><w:szCs w:val="24"/>') +
    style("Cited", "Cited sources", '<w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>', '<w:sz w:val="20"/><w:szCs w:val="20"/>') +
    // Retrait suspendu de 1,27 cm, comme le veut la norme APA.
    style("Reference", "Reference", '<w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:hanging="720"/><w:jc w:val="left"/>') +
    "</w:styles>"
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const DOCUMENT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

// -----------------------------------------------------------------------------
// Archive ZIP
// -----------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  // Version native quand l'environnement la fournit.
  const native = (zlib as { crc32?: (data: Uint8Array) => number }).crc32;
  if (typeof native === "function") return native(data) >>> 0;

  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Archive ZIP de fichiers texte. Les noms sont fixes : aucun ne vient de l'utilisateur. */
export async function zip(files: Array<{ name: string; content: string }>): Promise<Buffer> {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // Date fixe (1er janvier 2026) : deux exports du même contenu sont identiques.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.content, "utf8");
    // Asynchrone : la compression d'un long document ne bloque pas le serveur.
    const data = await deflateRaw(raw, { level: 6 });
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8); // déflation
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function toDocx(document: ProjectDocument): Promise<Buffer> {
  return zip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "word/document.xml", content: documentXml(document) },
    { name: "word/styles.xml", content: stylesXml(document.locale) },
    { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS },
  ]);
}
