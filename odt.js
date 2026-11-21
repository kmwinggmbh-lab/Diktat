// Erzeugt ODT-Dateien aus den KMW-Vorlagen – im Browser, ohne Server.
// Aktenvermerk: wie scripts/kmw_fill.py des Skills aktenvermerk-kmw (Vorlage KMW_AV01.odt)
// Brief:        wie scripts/kmw_brief.py des Skills kmw-vorlage-brief (Vorlage KMW_Vorlage_Brief.odt)
// Abweichung zu den Skripten: Eine einzelne Zeilenschaltung im Diktat („neue Zeile“) bleibt
// ein Zeilenumbruch (in den Skripten werden Zeilen eines Absatzes zusammengezogen).

import { unzipSync, zipSync, strToU8, strFromU8 } from './vendor/fflate-0.8.2.js';
import { formatDate } from './doc.js';

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
/** Dateinamen der Vorlagen. Die App lädt sie aus Google Drive (siehe ablage.js), nicht vom Webserver. */
export const TEMPLATE_NAMES = { av: 'KMW_AV01.odt', brief: 'KMW_Vorlage_Brief.odt' };

const xesc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** loader(type) liefert die Vorlage als ArrayBuffer/Uint8Array. */
async function loadTemplate(type, loader) {
  if (typeof loader !== 'function') throw new Error('Keine Vorlage verfügbar.');
  return unzipSync(new Uint8Array(await loader(type)));
}

function pack(files, contentXml, metaXml) {
  const out = { mimetype: [strToU8(ODT_MIME), { level: 0 }] };   // muss als erste Datei unkomprimiert stehen
  for (const [name, data] of Object.entries(files)) {
    if (name === 'mimetype' || name.endsWith('/')) continue;
    if (name === 'content.xml') out[name] = strToU8(contentXml);
    else if (name === 'meta.xml' && metaXml) out[name] = strToU8(metaXml);
    else out[name] = data;
  }
  return zipSync(out, { level: 6 });
}

/** Ersetzt den Inhalt der Textbox des Rahmens mit draw:name="name". */
function setFrame(xml, name, inner) {
  const i = xml.indexOf(`draw:name="${name}"`);
  if (i < 0) throw new Error('Briefvorlage passt nicht (Rahmen ' + name + ' fehlt).');
  let a = xml.indexOf('<draw:text-box', i);
  a = xml.indexOf('>', a) + 1;
  const b = xml.indexOf('</draw:text-box>', a);
  return xml.slice(0, a) + inner + xml.slice(b);
}

// ================================================================ Aktenvermerk

function avInline(text) {
  const out = [];
  const t = text.replace(/\\\*/g, '\x00');
  for (const part of t.split(/(\*\*.+?\*\*|(?<!\*)\*(?!\*).+?(?<!\*)\*(?!\*))/)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push(`<text:span text:style-name="KTB">${plain(part.slice(2, -2))}</text:span>`);
    else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) out.push(`<text:span text:style-name="KTI">${plain(part.slice(1, -1))}</text:span>`);
    else out.push(plain(part));
  }
  return out.join('');
}
function plain(t) {
  return xesc(t).replace(/\x00/g, '*')
    .replace(/\t/g, '<text:tab/>').replace(/\n/g, '<text:line-break/>')
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
}
const avPara = (style, text) => `<text:p text:style-name="${style}">${avInline(text)}</text:p>`;

const LIST_RE = /^([-*•–]|\d+[.)])\s+(.*)$/;

function avList(items) {
  const out = []; const stack = [];
  const close = () => out.push('</text:list-item></text:list>');
  for (const [ind, ordered, lines] of items) {
    while (stack.length && ind < stack[stack.length - 1][0]) { stack.pop(); close(); }
    if (stack.length && ind === stack[stack.length - 1][0] && ordered !== stack[stack.length - 1][1]) { stack.pop(); close(); }
    if (stack.length && ind === stack[stack.length - 1][0]) out.push('</text:list-item><text:list-item>');
    else if (stack.length >= 3) { out.push('</text:list-item><text:list-item>'); stack[stack.length - 1] = [ind, stack[stack.length - 1][1]]; }
    else { out.push(`<text:list text:style-name="${ordered ? 'KLN' : 'KLB'}"><text:list-item>`); stack.push([ind, ordered]); }
    out.push(avPara('KLP', lines.join('\n')));
  }
  while (stack.length) { stack.pop(); close(); }
  return out.join('');
}

let tableNo = 0;
function avTable(rows) {
  if (!rows.length) return '';
  tableNo += 1;
  const n = Math.max(...rows.map((r) => r.length));
  const out = [`<table:table table:name="Tabelle${tableNo}" table:style-name="KTab">`,
    `<table:table-column table:style-name="KTabCol" table:number-columns-repeated="${n}"/>`];
  rows.forEach((r, ri) => {
    r = [...r, ...Array(n - r.length).fill('')];
    if (ri === 0) out.push('<table:table-header-rows>');
    out.push('<table:table-row>');
    for (const c of r) out.push(`<table:table-cell table:style-name="KTabCell" office:value-type="string">${avPara(ri === 0 ? 'KTH' : 'KTD', c)}</table:table-cell>`);
    out.push('</table:table-row>');
    if (ri === 0) out.push('</table:table-header-rows>');
  });
  out.push('</table:table><text:p text:style-name="KP"/>');
  return out.join('');
}

export function avBody(body, numbering = true) {
  const xml = []; let counters = [0, 0, 0];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const s = lines[i].trim();
    if (!s) { i++; continue; }
    if (/^-{3,}\s*seite\s*-{3,}$/i.test(s)) { xml.push('<text:p text:style-name="KBR"/>'); i++; continue; }
    let m = s.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      const lvl = m[1].length; let title = m[2].trim();
      const mnum = title.match(/^(\d+(?:\.\d+)*)\.?\s+/);
      if (mnum) {
        const parts = mnum[1].split('.').map(Number).slice(0, 3);
        counters = [...parts, 0, 0, 0].slice(0, 3);
        title = title.replace(/^(\d+(?:\.\d+)*\.?)\s+/, '$1\t');
      } else if (numbering) {
        counters[lvl - 1] += 1;
        for (let k = lvl; k < 3; k++) counters[k] = 0;
        title = counters.slice(0, lvl).join('.') + '\t' + title;
      }
      xml.push(avPara('KH' + lvl, title)); i++; continue;
    }
    if (s.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      xml.push(avTable(rows)); continue;
    }
    if (LIST_RE.test(s)) {
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const raw = lines[i].replace(/\t/g, '    ');
        const ind = raw.length - raw.trimStart().length;
        const mm = raw.trim().match(LIST_RE);
        if (mm) items.push([ind, /^\d/.test(mm[1]), [mm[2]]]);
        else if (items.length && ind > 0) items[items.length - 1][2].push(raw.trim());
        else break;
        i++;
      }
      xml.push(avList(items)); continue;
    }
    if (s.startsWith('>')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { block.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      xml.push(avPara('KQ', block.join('\n'))); continue;
    }
    const block = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||>|([-*•–]|\d+[.)])\s|-{3,}\s*seite)/i.test(lines[i].trim())) { block.push(lines[i].trim()); i++; }
    if (!block.length) { block.push(lines[i].trim()); i++; }
    xml.push(avPara('KP', block.join('\n')));
  }
  return xml.join('');
}

const AV_STYLES = `
<style:style style:name="KP" style:family="paragraph" style:parent-style-name="A-Text-Allgem."><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.212cm" style:contextual-spacing="false"/></style:style>
<style:style style:name="KH1" style:family="paragraph" style:parent-style-name="A-Text-Betreff"><style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" style:contextual-spacing="false" fo:keep-with-next="always" fo:text-align="start"/><style:text-properties fo:font-size="11pt" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="KH2" style:family="paragraph" style:parent-style-name="A-Text-Betreff"><style:paragraph-properties fo:margin-top="0.353cm" fo:margin-bottom="0.141cm" style:contextual-spacing="false" fo:keep-with-next="always" fo:text-align="start"/><style:text-properties fo:font-size="10pt" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="KH3" style:family="paragraph" style:parent-style-name="A-Text-Betreff"><style:paragraph-properties fo:margin-top="0.282cm" fo:margin-bottom="0.141cm" style:contextual-spacing="false" fo:keep-with-next="always" fo:text-align="start"/><style:text-properties fo:font-size="10pt" fo:font-style="italic" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="KBR" style:family="paragraph" style:parent-style-name="A-Text-Allgem."><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="KLP" style:family="paragraph" style:parent-style-name="A-Text-Allgem." style:list-style-name="KLB"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.071cm" style:contextual-spacing="false"/></style:style>
<style:style style:name="KTH" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:keep-with-next="always"/><style:text-properties fo:font-size="10pt" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="KTD" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="10pt"/></style:style>
<style:style style:name="KQ" style:family="paragraph" style:parent-style-name="A-Text-Allgem."><style:paragraph-properties fo:margin-left="1cm" fo:margin-top="0cm" fo:margin-bottom="0.212cm" fo:text-indent="0cm" style:auto-text-indent="false" style:contextual-spacing="false"/><style:text-properties fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"/></style:style>
<style:style style:name="KTB" style:family="text"><style:text-properties fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>
<style:style style:name="KTI" style:family="text"><style:text-properties fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"/></style:style>
<style:style style:name="KTab" style:family="table"><style:table-properties style:width="15.4cm" table:align="left" fo:margin-top="0.1cm" fo:margin-bottom="0.1cm"/></style:style>
<style:style style:name="KTabCol" style:family="table-column"><style:table-column-properties style:rel-width="1*"/></style:style>
<style:style style:name="KTabCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/></style:style>
<text:list-style style:name="KLB">${[1, 2, 3].map((l) => `<text:list-level-style-bullet text:level="${l}" text:bullet-char="${l === 2 ? '•' : '–'}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.6 * l).toFixed(1)}cm" fo:text-indent="-0.6cm" fo:margin-left="${(0.6 * l).toFixed(1)}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style>
<text:list-style style:name="KLN">${[[1, '.', '1'], [2, ')', 'a'], [3, '.', 'i']].map(([l, suf, fmt]) => `<text:list-level-style-number text:level="${l}" style:num-suffix="${suf}" style:num-format="${fmt}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.75 * l).toFixed(2)}cm" fo:text-indent="-0.75cm" fo:margin-left="${(0.75 * l).toFixed(2)}cm"/></style:list-level-properties></text:list-level-style-number>`).join('')}</text:list-style>
`;

function setPText(xml, re, newText) {
  return xml.replace(re, (m, open, inner) => {
    const frames = (inner.match(/<draw:frame[\s\S]*?<\/draw:frame>/g) || []).join('');
    return `${open}${frames}${avInline(newText)}</text:p>`;
  });
}

/**
 * @param d  Entwurf {type, betreff, datum, text}
 * @param s  Absender {ort, unterzeichner (oder leer = Vorlage), unterschrift (bool)}
 */
export async function buildAvOdt(d, s, loader) {
  const files = await loadTemplate('av', loader);
  let c = strFromU8(files['content.xml']);
  for (const p of ['P1', 'P2', 'P3']) {
    if (!c.includes(`<text:p text:style-name="${p}"/>`)) throw new Error('Vorlage KMW_AV01.odt passt nicht (Platzhalter fehlen).');
  }
  tableNo = 0;
  const titel = ['Aktenvermerk', d.betreff?.trim()].filter(Boolean).join(' – ');
  c = c.replace('</office:automatic-styles>', AV_STYLES + '</office:automatic-styles>');
  c = c.replace('<text:p text:style-name="P1"/>', `<text:p text:style-name="P1">${avInline(titel)}</text:p>`);
  c = c.replace('<text:p text:style-name="P2"/>', '<text:p text:style-name="P2"></text:p>');
  c = c.replace('<text:p text:style-name="P3"/>', avBody(d.text) + '<text:p text:style-name="KP"/>');
  c = setPText(c, /(<text:p text:style-name="A-Text-Allgem\.">)(Saarbrücken, den [^<]*)<\/text:p>/, `${s.ort}, den ${formatDate(d.datum)}`);
  if (s.unterzeichner) {
    c = setPText(c, /(<text:p text:style-name="A-Text-Allgem\.">)(<draw:frame draw:style-name="fr1"[\s\S]*?)<\/text:p>/, s.unterzeichner);
  }
  if (!s.unterschrift) c = c.replace(/<draw:frame draw:style-name="fr1"[\s\S]*?<\/draw:frame>/, '');
  let m = files['meta.xml'] ? strFromU8(files['meta.xml']) : null;
  if (m) m = m.replace(/<dc:title>[\s\S]*?<\/dc:title>/, '').replace('<office:meta>', `<office:meta><dc:title>${xesc(titel)}</dc:title>`);
  return pack(files, c, m);
}

// ================================================================ Brief

const BRIEF_STYLES =
  '<style:style style:name="TU" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>' +
  '<style:style style:name="TB" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
  '<style:style style:name="KTXT" style:family="paragraph" style:parent-style-name="A-Text-Allgem."><style:paragraph-properties fo:text-align="justify" style:justify-single-word="false"/></style:style>' +
  '<style:style style:name="KBET" style:family="paragraph" style:parent-style-name="A-Text-Allgem."><style:paragraph-properties fo:text-align="start" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style>' +
  '<style:style style:name="KSIG" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:margin-top="0.2cm" fo:margin-bottom="0.1cm"/></style:style>' +
  '<text:list-style style:name="KL1">' +
  [1, 2, 3, 4, 5].map((l) => `<text:list-level-style-bullet text:level="${l}" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.635 * (l + 1)).toFixed(3)}cm" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (l + 1)).toFixed(3)}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('') +
  '</text:list-style>' +
  ['1', '1.1', '1.1.1', '1.1.1.1'].map((g, i) => `<style:style style:name="KH${i + 1}" style:family="paragraph" style:parent-style-name="G-Gliederung ${g}"><style:paragraph-properties fo:margin-top="0.45cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/></style:style>`).join('');

const SIG_FRAME = '<text:p text:style-name="KTXT"><draw:frame draw:style-name="KSIG" draw:name="Unterschrift" text:anchor-type="as-char" svg:width="4.046cm" svg:height="1.185cm"><draw:image xlink:href="Pictures/10000000000001DE0000008C26C3DDC2.jpg" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="image/jpeg"/></draw:frame></text:p>';

function bEsc(t) {
  return xesc(t)
    .replace(/\*\*(.+?)\*\*/g, '<text:span text:style-name="TB">$1</text:span>')
    .replace(/__(.+?)__/g, '<text:span text:style-name="TU">$1</text:span>')
    .replace(/\t/g, '<text:tab/>')
    .replace(/\n/g, '<text:line-break/>');
}
const bPara = (style, text = '') => `<text:p text:style-name="${style}">${bEsc(text)}</text:p>`;
const bList = (items) => '<text:list text:style-name="KL1">' + items.map((i) => `<text:list-item><text:p text:style-name="KTXT">${bEsc(i)}</text:p></text:list-item>`).join('') + '</text:list>';

/** Diktattext -> Inhaltsblöcke wie in der Steuerdatei des Skills (p, ul, h1–h3) */
export function briefBlocks(text) {
  const blocks = []; let para = []; let list = null;
  const flush = () => {
    if (para.length) blocks.push({ typ: 'p', text: para.join('\n') });
    if (list) blocks.push({ typ: 'ul', punkte: list });
    para = []; list = null;
  };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim(); let m;
    if (!l) { flush(); continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flush(); blocks.push({ typ: 'h' + m[1].length, text: m[2].replace(/^\d+(\.\d+)*\.?\s+/, '') }); continue; }
    if ((m = l.match(LIST_RE))) { if (para.length) { blocks.push({ typ: 'p', text: para.join('\n') }); para = []; } (list ||= []).push(m[2]); continue; }
    if (list) flush();
    para.push(l);
  }
  flush();
  return blocks;
}

/**
 * @param d  Entwurf {empfaenger, betreff, anrede, datum, text, anlagen}
 * @param s  {unserZeichen, sachbearbeiter: {name, telefon, email} | null, gesellschafter, firma, name, unterschrift}
 */
export async function buildBriefOdt(d, s, loader) {
  const files = await loadTemplate('brief', loader);
  let c = strFromU8(files['content.xml']);
  c = c.replace('</office:automatic-styles>', BRIEF_STYLES + '</office:automatic-styles>');

  const emp = String(d.empfaenger || '').split('\n').map((z) => z.trim()).filter(Boolean);
  c = setFrame(c, 'Briefkopf', '<text:p text:style-name="Rahmen1"/>' + emp.map((z) => bPara('P11', z)).join(''));
  c = setFrame(c, 'Unser_Zeichen', bPara('Rahmen2', s.unserZeichen || 'MD/sn'));
  c = setFrame(c, 'Datum', bPara('Rahmen2', formatDate(d.datum)));
  if (s.sachbearbeiter) {
    const sb = s.sachbearbeiter;
    c = setFrame(c, 'Rahmen4', `<text:p text:style-name="B-Eintrag">${bEsc(sb.name)}<text:line-break/><text:span text:style-name="T2">${bEsc(sb.telefon || '')}</text:span><text:line-break/>${bEsc(sb.email || '')}</text:p>`);
  }

  const x = ['<text:p text:style-name="P1"/>'];
  const betreff = [d.bauvorhaben, d.betreff].flatMap((v) => String(v || '').split('\n')).map((z) => z.trim()).filter(Boolean);
  if (betreff.length) { betreff.forEach((z) => x.push(bPara('KBET', z))); x.push(bPara('KTXT')); }
  if (d.anrede?.trim()) { x.push(bPara('KTXT', d.anrede.trim())); x.push(bPara('KTXT')); }
  for (const b of briefBlocks(d.text)) {
    if (b.typ === 'ul') x.push(bList(b.punkte));
    else x.push(bPara(b.typ === 'p' ? 'KTXT' : 'KH' + b.typ.slice(1), b.text));
    if (b.typ === 'p' || b.typ === 'ul') x.push(bPara('KTXT'));
  }
  x.push(bPara('KTXT'), bPara('KTXT', s.gruss || 'mit freundlichen Grüßen'), bPara('KTXT'));
  x.push(bPara('KTXT', s.gesellschafter), bPara('KTXT', s.firma));
  if (s.unterschrift) x.push(SIG_FRAME);
  x.push(bPara('KTXT', s.name));
  const anl = String(d.anlagen || '').split('\n').map((z) => z.trim()).filter(Boolean);
  if (anl.length) { x.push(bPara('KTXT'), bPara('KBET', 'Anlagen'), bList(anl)); }

  const a = c.indexOf('<text:p text:style-name="P1"/>');
  const e = c.indexOf('</office:text>');
  if (a < 0 || e < 0) throw new Error('Briefvorlage passt nicht (Textbeginn nicht gefunden).');
  c = c.slice(0, a) + x.join('') + c.slice(e);
  return pack(files, c, null);
}

export { ODT_MIME };

// ================================================================ PDF über Google Drive

/** Trägt den Dateinamen in das Dateiname-Feld der Fußzeile ein (Anzeigewert des Feldes). */
export function setFileName(odtBytes, name) {
  const files = unzipSync(odtBytes);
  const st = strFromU8(files['styles.xml'])
    .replace(/(<text:file-name[^>]*>)[^<]*(<\/text:file-name>)/g, `$1${xesc(name)}$2`);
  return repack(files, { 'styles.xml': st });
}

/**
 * Kopie der ODT für die Umwandlung in ein Google-Dokument (daraus entsteht das PDF):
 *  - Dateiname-Feld durch festen Text ersetzen (Google zeigt sonst einen internen Namen)
 *  - Aktenvermerk: Unterschrift als eigenes Bild über den Namen setzen (Google setzt das
 *    am Absatz verankerte Bild sonst unter den Namen)
 */
export function forGoogleConversion(odtBytes, name) {
  const files = unzipSync(odtBytes);
  const st = strFromU8(files['styles.xml'])
    .replace(/<text:file-name[^>]*>[^<]*<\/text:file-name>/g, xesc(name));
  let c = strFromU8(files['content.xml']);
  c = c.replace(/(<text:p text:style-name="A-Text-Allgem\.">)(<draw:frame draw:style-name="fr1"[\s\S]*?<\/draw:frame>)([\s\S]*?)<\/text:p>/, (m, open, frame, rest) => {
    const f = frame
      .replace('draw:style-name="fr1"', 'draw:style-name="KSIGAV"')
      .replace('text:anchor-type="paragraph"', 'text:anchor-type="as-char"')
      .replace(/ svg:[xy]="[^"]*"/g, '');
    return `${open}${f}</text:p>${open}${rest}</text:p>`;
  });
  c = c.replace('</office:automatic-styles>', '<style:style style:name="KSIGAV" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:margin-top="0.2cm" fo:margin-bottom="0.1cm"/></style:style></office:automatic-styles>');
  return repack(files, { 'styles.xml': st, 'content.xml': c });
}

function repack(files, changed) {
  const out = { mimetype: [strToU8(ODT_MIME), { level: 0 }] };
  for (const [n, data] of Object.entries(files)) {
    if (n === 'mimetype' || n.endsWith('/')) continue;
    out[n] = n in changed ? strToU8(changed[n]) : data;
  }
  return zipSync(out, { level: 6 });
}
