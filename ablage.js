// Ablage-Ablauf in Google Drive:
//  1. Text speichern  -> einfache Textdatei (.txt) im Projektordner, wird bei jedem Speichern aktualisiert
//  2. Fertigstellen   -> ODT aus der KMW-Vorlage und PDF daneben
// Projektordner wie im Skill aktenvermerk-kmw: Ordner, dessen Name mit der Projektnummer beginnt,
// darin bevorzugt ein Unterordner mit „Text“ im Namen. Nichts raten – bei Unklarheit nachfragen.

import * as drive from './drive.js';
import { fileName, briefPrefix, formatDate } from './doc.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const CANCEL = { label: 'Abbrechen', value: null };
class Abbruch extends Error {}
export const isAbbruch = (e) => e instanceof Abbruch;

// ---------------------------------------------------------------- Vorlagen aus Google Drive
// Die KMW-Vorlagen (Briefbogen, Unterschrift) liegen nicht beim Programmcode im Netz, sondern im
// Google Drive. Gesucht wird nach dem exakten Dateinamen; die gefundene Datei merkt sich die App.
const templateCache = {};

export async function loadTemplate(type, ask) {
  if (templateCache[type]) return templateCache[type];
  const { TEMPLATE_NAMES } = await import('./odt.js');
  const name = TEMPLATE_NAMES[type];
  const key = 'diktat.vorlage.' + type;
  const known = store.get(key, null);
  if (known) {
    try { return (templateCache[type] = await drive.download(known)); }
    catch (e) { if (!/not found|404/i.test(e.message)) throw e; }
  }
  const found = await drive.findFilesByName(name);
  if (!found.length) {
    throw new Error(`Die Vorlage „${name}“ wurde in Google Drive nicht gefunden. Bitte die Datei in Google Drive ablegen (z. B. im Ordner „KMW Diktat Vorlagen“) – siehe Anleitung.`);
  }
  let id = found[0].id;
  if (found.length > 1) {
    const fmt = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '');
    id = await pick(ask, 'Mehrere Vorlagen', `In Google Drive gibt es ${found.length} Dateien „${name}“. Welche soll verwendet werden?`,
      found.map((f) => ({ label: `${f.name} – geändert ${fmt(f.modifiedTime)}`, value: f.id })));
  }
  const data = await drive.download(id);
  store.set(key, id);
  return (templateCache[type] = data);
}

/** Inhalt der Textdatei: Kopfangaben + Diktat */
export function textFile(d, snd) {
  const p = [d.type === 'brief' ? 'BRIEF' : 'AKTENVERMERK', ''];
  const kv = (k, v) => { if (String(v || '').trim()) p.push(`${k}: ${String(v).trim()}`); };
  kv('Projektnummer', d.projekt);
  if (d.type === 'brief') {
    if (d.empfaenger.trim()) { p.push('Empfänger:'); d.empfaenger.trim().split('\n').forEach((z) => p.push('  ' + z.trim())); }
    kv('Bauvorhaben', d.bauvorhaben);
  }
  kv('Betreff', d.betreff);
  if (d.type === 'brief') kv('Anrede', d.anrede);
  kv('Datum', formatDate(d.datum));
  if (d.type === 'brief' && d.anlagen.trim()) { p.push('Anlagen:'); d.anlagen.trim().split('\n').forEach((z) => p.push('  - ' + z.trim())); }
  kv('Verfasser', d.type === 'brief' ? snd.briefName : snd.avName);
  p.push('', '-----', '', d.text.trim(), '');
  return p.join('\n');
}

async function pick(ask, title, text, items, extra = []) {
  const v = await ask(title, text, [...items, ...extra, CANCEL]);
  if (v == null) throw new Abbruch();
  return v;
}

/** Zielordner ermitteln (mit Rückfragen). Ergebnis: {id, label} */
export async function resolveFolder(d, settings, ask) {
  if (d.drive?.folderId) {
    const f = await drive.getFolder(d.drive.folderId);
    if (f) return { id: f.id, label: d.drive.folderLabel };
  }
  const nr = d.projekt.trim();
  const fallback = async () => {
    const f = await drive.ensureRootFolder(settings.ordner || 'Diktate');
    return { id: f.id, label: f.name || settings.ordner || 'Diktate' };
  };
  if (!nr) {
    const v = await pick(ask, 'Keine Projektnummer', 'Ohne Projektnummer kann kein Projektordner gefunden werden.',
      [{ label: `In Ordner „${settings.ordner || 'Diktate'}“ speichern`, value: 'fallback', primary: true }]);
    if (v === 'fallback') return fallback();
  }

  const cache = store.get('diktat.projektOrdner', {});
  if (cache[nr]) {
    const f = await drive.getFolder(cache[nr].id);
    if (f) return cache[nr];
  }

  const projects = await drive.findProjectFolders(nr);
  let project;
  if (projects.length === 0) {
    await pick(ask, 'Projektordner nicht gefunden', `In Google Drive gibt es keinen Ordner, dessen Name mit „${nr}“ beginnt.`,
      [{ label: `In Ordner „${settings.ordner || 'Diktate'}“ speichern`, value: 'fallback', primary: true }]);
    return fallback();
  } else if (projects.length === 1) {
    project = projects[0];
  } else {
    const id = await pick(ask, 'Mehrere Projektordner', `Es gibt mehrere Ordner, die mit „${nr}“ beginnen. Welcher ist richtig?`,
      projects.map((f) => ({ label: f.name, value: f.id })));
    project = projects.find((f) => f.id === id);
  }

  const texts = await drive.subfolders(project.id, 'Text');
  let target;
  if (texts.length === 1) {
    target = { id: texts[0].id, label: `${project.name} / ${texts[0].name}` };
  } else if (texts.length > 1) {
    const id = await pick(ask, 'Textordner wählen', `Im Projektordner „${project.name}“ gibt es mehrere passende Unterordner.`,
      texts.map((f) => ({ label: f.name, value: f.id })));
    const t = texts.find((f) => f.id === id);
    target = { id: t.id, label: `${project.name} / ${t.name}` };
  } else {
    const v = await pick(ask, 'Kein Textordner', `Im Projektordner „${project.name}“ gibt es keinen Unterordner „Text“.`, [
      { label: 'Direkt in den Projektordner', value: 'direkt', primary: true },
      { label: 'Unterordner „Text“ anlegen', value: 'anlegen' },
    ]);
    if (v === 'anlegen') {
      const t = await drive.createFolder('Text', project.id);
      target = { id: t.id, label: `${project.name} / Text` };
    } else {
      target = { id: project.id, label: project.name };
    }
  }
  cache[nr] = target;
  store.set('diktat.projektOrdner', cache);
  return target;
}

/** Text speichern: legt die .txt an oder aktualisiert sie. Gibt den aktualisierten Drive-Zustand zurück. */
export async function saveText(d, snd, settings, ask) {
  const folder = await resolveFolder(d, settings, ask);
  const st = d.drive && d.drive.folderId === folder.id ? { ...d.drive } : { folderId: folder.id };
  st.folderLabel = folder.label;

  let txt = st.txtId ? await drive.getFile(st.txtId) : null;
  let base;
  if (d.type === 'brief') {
    if (!st.nr || !txt) {
      const names = await drive.namesInFolder(folder.id, briefPrefix(d, snd));
      let n = 1; while (names.has(fileName(d, snd, n))) n++;
      st.nr = n;
    }
    base = fileName(d, snd, st.nr);
  } else {
    base = fileName(d, snd);
    if (!txt || base !== st.base) {
      const names = await drive.namesInFolder(folder.id, base);
      names.delete(st.base);
      if (names.has(base)) { let n = 2; while (names.has(`${base}_${n}`)) n++; base = `${base}_${n}`; }
    }
  }

  const content = textFile(d, snd);
  if (txt) txt = await drive.updateFile(txt.id, { name: base + '.txt' }, 'text/plain; charset=UTF-8', content);
  else txt = await drive.createFile({ name: base + '.txt', parents: [folder.id], mimeType: 'text/plain' }, 'text/plain; charset=UTF-8', content);
  return { ...st, base, txtId: txt.id, txtLink: txt.webViewLink };
}

/**
 * Fertigstellen: Text speichern, ODT aus der Vorlage erzeugen, PDF über Google Drive erzeugen.
 * makeOdt() liefert die ODT-Bytes. onStep(text) meldet den Fortschritt.
 */
export async function finalize(d, snd, settings, ask, makeOdt, onStep = () => {}) {
  onStep('Text wird gespeichert …');
  const st = await saveText(d, snd, settings, ask);
  const odo = await import('./odt.js');
  const odtName = st.base + '.odt';
  const pdfName = st.base + '.pdf';

  const [oldOdt, oldPdf] = await Promise.all([drive.findFile(st.folderId, odtName), drive.findFile(st.folderId, pdfName)]);
  if (oldOdt || oldPdf) {
    await pick(ask, 'Schon fertiggestellt', `„${st.base}“ liegt bereits als ODT/PDF im Ordner. Mit dem aktuellen Text ersetzen?`,
      [{ label: 'Ersetzen', value: 'ja', primary: true }]);
  }

  onStep('ODT wird erzeugt …');
  const odt = odo.setFileName(await makeOdt(), odtName);
  const odtFile = oldOdt
    ? await drive.updateFile(oldOdt.id, {}, odo.ODT_MIME, odt)
    : await drive.createFile({ name: odtName, parents: [st.folderId], mimeType: odo.ODT_MIME }, odo.ODT_MIME, odt);

  onStep('PDF wird erzeugt …');
  const tmp = await drive.createFile({ name: st.base + ' (temporär, wird gelöscht)', parents: [st.folderId], mimeType: 'application/vnd.google-apps.document' },
    odo.ODT_MIME, odo.forGoogleConversion(odt, odtName));
  let pdf;
  try { pdf = await drive.exportPdf(tmp.id); }
  finally { await drive.deleteFile(tmp.id).catch(() => {}); }
  const pdfFile = oldPdf
    ? await drive.updateFile(oldPdf.id, {}, 'application/pdf', pdf)
    : await drive.createFile({ name: pdfName, parents: [st.folderId], mimeType: 'application/pdf' }, 'application/pdf', pdf);

  return { ...st, odtId: odtFile.id, odtLink: odtFile.webViewLink, pdfId: pdfFile.id, pdfLink: pdfFile.webViewLink };
}
