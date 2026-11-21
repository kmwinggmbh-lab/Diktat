import { insertSegment } from './textproc.js';
import { buildDoc, sender, odtOptions } from './doc.js';
import { createDictation, speechSupported } from './speech.js';
import { preloadGoogle, signOut, connect } from './drive.js';
import { saveText, finalize, isAbbruch, loadTemplate } from './ablage.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DEFAULT_SETTINGS = {
  firma: CONFIG.firma, ort: CONFIG.ort, name: CONFIG.name,
  unserZeichen: CONFIG.unserZeichen, telefon: CONFIG.telefon, email: CONFIG.email,
  clientId: CONFIG.googleClientId, ordner: CONFIG.ordner, apiKey: '',
};
let settings = { ...DEFAULT_SETTINGS, ...store.get('diktat.settings', {}) };
if (!settings.clientId) settings.clientId = CONFIG.googleClientId;

const emptyDraft = () => ({ type: store.get('diktat.lastType', 'av'), projekt: '', bauvorhaben: '', betreff: '', empfaenger: '', anlagen: '', anrede: 'Sehr geehrte Damen und Herren,', datum: today(), text: '' });
let draft = { ...emptyDraft(), ...store.get('diktat.draft', {}) };
if (!draft.text.trim()) draft.datum = today();
let undoText = null;

// ---------------------------------------------------------------- Formular
const fields = { projekt: 'fProjekt', bauvorhaben: 'fBauvorhaben', betreff: 'fBetreff', empfaenger: 'fEmpfaenger', anrede: 'fAnrede', datum: 'fDatum', anlagen: 'fAnlagen', text: 'fText' };
const snd = () => sender(settings, CONFIG);

function render() {
  for (const [k, id] of Object.entries(fields)) if ($(id).value !== draft[k]) $(id).value = draft[k];
  document.body.classList.toggle('brief', draft.type === 'brief');
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === draft.type)));
}

let saveTimer;
function persist() { draft.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('diktat.draft', draft), 250); }

for (const [k, id] of Object.entries(fields)) {
  $(id).addEventListener('input', () => { draft[k] = $(id).value; if (k === 'projekt') draft.drive = null; persist(); });
}
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  if (draft.type !== b.dataset.type) draft.drive = null;
  draft.type = b.dataset.type;
  store.set('diktat.lastType', draft.type);
  persist(); render();
}));

$('btnHelp').addEventListener('click', () => {
  const h = $('help'); h.hidden = !h.hidden;
  $('btnHelp').setAttribute('aria-expanded', String(!h.hidden));
});

// ---------------------------------------------------------------- Hinweise
let toastTimer;
function toast(msg, err = false, ms = 3500) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', err); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------- Diktat
// Das Mikrofon diktiert in das Feld, das zuletzt angetippt war (Standard: Text).
const ta = $('fText');
const LABELS = { projekt: 'Projektnummer', bauvorhaben: 'Bauvorhaben', betreff: 'Betreff', empfaenger: 'Empfänger', anrede: 'Anrede', anlagen: 'Anlagen', text: 'Text' };
const BRIEF_ONLY = ['bauvorhaben', 'empfaenger', 'anrede', 'anlagen'];
const keyOf = (el) => Object.keys(fields).find((k) => fields[k] === el?.id && k !== 'datum');
let target = 'text';
let caret = null;        // Cursorposition im Zielfeld
let focusBeforeMic = null;

$('btnMic').addEventListener('pointerdown', () => { focusBeforeMic = document.activeElement; });

let wakeLock = null;
let timer = null;
let t0 = 0;

function bubble(interim = '') {
  const b = $('bubble');
  b.hidden = !dictation.running;
  $('bubbleTarget').textContent = LABELS[target];
  $('bubbleText').textContent = interim || 'Ich höre zu …';
  $('bubbleText').classList.toggle('idle', !interim);
}

const dictation = createDictation({
  onFinal(piece) {
    const el = $(fields[target]);
    const single = el.tagName === 'INPUT';
    let pos = caret ?? draft[target].length;
    if (pos > draft[target].length) pos = draft[target].length;
    const r = insertSegment(draft[target], pos, piece);
    let txt = r.text;
    if (single) txt = txt.replace(/\s*\n+\s*/g, ' ').replace(/^#\s|^-\s/, '').trim();
    if (target === 'projekt') txt = txt.replace(/(\d)\s+(?=\d)/g, '$1');
    draft[target] = txt; caret = single ? txt.length : r.pos;
    el.value = txt;
    if (target === 'text') ta.scrollTop = ta.scrollHeight;
    persist();
    // Kurze Felder: nach dem ersten Satz automatisch fertig
    if (single) setTimeout(() => dictation.stop(), 0);
  },
  onInterim(t) { bubble(t); },
  async onState(on) {
    $('btnMic').classList.toggle('rec', on);
    $('btnMic').setAttribute('aria-label', on ? 'Diktat beenden' : 'Diktat starten');
    $('micHint').textContent = on ? 'Tippen zum Beenden' : 'Tippen zum Diktieren';
    document.querySelectorAll('.target').forEach((e) => e.classList.remove('target'));
    if (on) $(fields[target]).classList.add('target');
    clearInterval(timer);
    bubble();
    if (on) {
      t0 = Date.now();
      const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); $('micTime').textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      tick(); timer = setInterval(tick, 1000);
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    } else {
      $('micTime').textContent = '';
      try { await wakeLock?.release(); } catch {}
      wakeLock = null;
    }
  },
  onError(msg) { toast(msg, true, 6000); },
});

$('btnMic').addEventListener('click', () => {
  if (!speechSupported) {
    ta.focus();
    toast('Dieser Browser hat keine eingebaute Spracherkennung. Bitte das Mikrofon auf der Tastatur benutzen – oder die Seite in Chrome (Android) bzw. Safari (iPhone) öffnen.', true, 8000);
    return;
  }
  if (dictation.running) { dictation.stop(); return; }
  const prev = focusBeforeMic || document.activeElement;
  focusBeforeMic = null;
  target = keyOf(prev) || 'text';
  if (BRIEF_ONLY.includes(target) && draft.type !== 'brief') target = 'text';
  const el = $(fields[target]);
  caret = keyOf(prev) ? el.selectionEnd : draft[target].length;
  prev?.blur?.();
  dictation.start();
  if (target !== 'text') return;
  ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// ---------------------------------------------------------------- Ansichten
function showPreview(push = true) {
  $('toast').hidden = true;
  if (dictation.running) dictation.stop();
  $('paper').innerHTML = buildDoc(draft, snd(), { preview: true });
  renderDriveInfo();
  if (draft.type === 'brief' && draft.empfaenger.split('\n').filter((z) => z.trim()).length > 5) toast('Die Anschrift hat mehr als 5 Zeilen und passt dann nicht ins Fenster des Briefbogens.', true, 6000);
  $('aiBar').hidden = !settings.apiKey;
  $('btnAIUndo').hidden = undoText == null;
  $('screenEdit').hidden = true; $('barEdit').hidden = true;
  $('screenPreview').hidden = false; $('barPreview').hidden = false;
  $('btnBack').hidden = false; $('btnNew').hidden = true;
  $('title').textContent = 'Vorschau';
  window.scrollTo(0, 0);
  if (push) history.pushState({ view: 'preview' }, '');
}
function showEdit() {
  $('toast').hidden = true;
  $('screenEdit').hidden = false; $('barEdit').hidden = false;
  $('screenPreview').hidden = true; $('barPreview').hidden = true;
  $('btnBack').hidden = true; $('btnNew').hidden = false;
  $('title').textContent = 'Diktat';
}
$('btnNext').addEventListener('click', () => {
  if (!draft.text.trim()) { toast('Bitte zuerst etwas diktieren oder eintippen.'); return; }
  showPreview();
});
$('btnBack').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => showEdit());

$('btnNew').addEventListener('click', () => {
  const gesichert = draft.drive?.txtId && !draft.dirty;
  if (draft.text.trim() && !gesichert && !confirm('Der Text ist noch nicht in Google Drive gespeichert. Trotzdem neu beginnen?')) return;
  newDraft();
});
function newDraft() {
  dictation.stop();
  draft = emptyDraft(); undoText = null; caret = null;
  store.set('diktat.draft', draft); render();
  if (!$('screenPreview').hidden) history.back();
}

// ---------------------------------------------------------------- KI-Glättung
$('btnAI').addEventListener('click', async () => {
  const b = $('btnAI');
  b.disabled = true; b.textContent = '⏳ Bitte warten …';
  try {
    const { smoothText } = await import('./ai.js');
    const out = await smoothText(draft.text, draft.type, settings.apiKey);
    undoText = draft.text;
    draft.text = out; persist(); render();
    showPreview(false);
    toast('Text überarbeitet. Bitte prüfen – mit „Zurück“ können Sie ihn bearbeiten.');
  } catch (e) {
    toast(e.message || String(e), true, 7000);
  } finally {
    b.disabled = false; b.textContent = '✨ KI-Glättung';
  }
});
$('btnAIUndo').addEventListener('click', () => {
  if (undoText == null) return;
  draft.text = undoText; undoText = null; persist(); render(); showPreview(false);
  toast('Ursprünglicher Text wiederhergestellt.');
});

// ---------------------------------------------------------------- Ablage in Google Drive
// 1. „Text speichern“: einfache Textdatei im Projektordner
// 2. „Fertigstellen“: ODT aus der KMW-Vorlage und PDF in denselben Ordner
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function renderDriveInfo() {
  const el = $('driveInfo');
  const st = draft.drive;
  if (!st?.txtId) { el.hidden = true; return; }
  let h = `Text gespeichert als <b>${escHtml(st.base)}.txt</b> in <b>${escHtml(st.folderLabel)}</b>.`;
  if (st.pdfId) h += ' ODT und PDF sind erstellt.';
  if (draft.dirty) h += '<br>⚠ Es gibt Änderungen, die noch nicht gespeichert sind.';
  el.innerHTML = h; el.hidden = false;
}

/** Rückfrage mit Auswahlknöpfen; liefert den gewählten Wert oder null */
function ask(title, text, options) {
  return new Promise((resolve) => {
    const dlg = $('dlgChoice');
    $('choiceTitle').textContent = title;
    $('choiceText').textContent = text;
    const box = $('choiceBtns'); box.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'btn ' + (o.primary ? 'primary' : 'secondary');
      b.textContent = o.label;
      b.addEventListener('click', () => { dlg.close(); resolve(o.value); });
      box.appendChild(b);
    }
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
  });
}

async function driveReady() {
  if (!settings.clientId) {
    toast('Für Google Drive fehlt noch die Client-ID (einmalig einzurichten).', true, 6000);
    openSettings('sClientId');
    return false;
  }
  await connect(settings.clientId);
  return true;
}

async function makeOdt() {
  const { buildAvOdt, buildBriefOdt } = await import('./odt.js');
  const opts = odtOptions(draft.type, snd());
  const loader = (type) => loadTemplate(type, ask);   // Vorlage aus Google Drive
  return draft.type === 'brief' ? buildBriefOdt(draft, opts, loader) : buildAvOdt(draft, opts, loader);
}

async function busy(btn, label, fn) {
  const all = [$('btnSaveText'), $('btnFinish')];
  const old = btn.textContent;
  all.forEach((b) => { b.disabled = true; });
  btn.textContent = label;
  try { return await fn((t) => { btn.textContent = t; }); }
  catch (e) { if (!isAbbruch(e)) toast(e.message || String(e), true, 8000); return null; }
  finally { all.forEach((b) => { b.disabled = false; }); btn.textContent = old; }
}

$('btnSaveText').addEventListener('click', () => busy($('btnSaveText'), 'Speichere …', async () => {
  if (!draft.text.trim()) { toast('Es gibt noch keinen Text.'); return; }
  if (!(await driveReady())) return;
  draft.drive = await saveText(draft, snd(), settings, ask);
  draft.dirty = false; store.set('diktat.draft', draft);
  renderDriveInfo();
  toast('Text gespeichert: ' + draft.drive.base + '.txt');
}));

$('btnFinish').addEventListener('click', () => busy($('btnFinish'), 'Bitte warten …', async (step) => {
  if (!draft.text.trim()) { toast('Es gibt noch keinen Text.'); return; }
  if (draft.type === 'brief' && !draft.empfaenger.trim() && !confirm('Es ist kein Empfänger eingetragen. Trotzdem fertigstellen?')) return;
  if (!(await driveReady())) return;
  draft.drive = await finalize(draft, snd(), settings, ask, makeOdt, step);
  draft.dirty = false; store.set('diktat.draft', draft);
  renderDriveInfo();
  $('savedName').textContent = `„${draft.drive.base}.odt“ und „${draft.drive.base}.pdf“ liegen zusammen mit der Textdatei in „${draft.drive.folderLabel}“.`;
  $('savedPdfLink').href = draft.drive.pdfLink || `https://drive.google.com/file/d/${draft.drive.pdfId}/view`;
  $('savedOdtLink').href = draft.drive.odtLink || `https://drive.google.com/file/d/${draft.drive.odtId}/view`;
  $('savedFolderLink').href = `https://drive.google.com/drive/folders/${draft.drive.folderId}`;
  $('dlgSaved').showModal();
}));
$('btnSavedNew').addEventListener('click', () => { $('dlgSaved').close(); newDraft(); });
$('btnSavedClose').addEventListener('click', () => $('dlgSaved').close());

// ---------------------------------------------------------------- Einstellungen
const sMap = { firma: 'sFirma', ort: 'sOrt', name: 'sName', unserZeichen: 'sZeichen', telefon: 'sTelefon', email: 'sEmail', clientId: 'sClientId', ordner: 'sOrdner', apiKey: 'sApiKey' };
function openSettings(focusId) {
  for (const [k, id] of Object.entries(sMap)) $(id).value = settings[k] || '';
  $('dlgSettings').showModal();
  if (focusId) $(focusId).focus();
}
$('btnSettings').addEventListener('click', () => openSettings());
$('dlgSettings').addEventListener('close', () => {
  if ($('dlgSettings').returnValue !== 'ok') return;
  for (const [k, id] of Object.entries(sMap)) settings[k] = $(id).value.trim();
  for (const k of ['firma', 'ort', 'name', 'ordner', 'unserZeichen']) if (!settings[k]) settings[k] = DEFAULT_SETTINGS[k];
  store.set('diktat.settings', settings);
  if (settings.clientId) preloadGoogle().catch(() => {});
  if (!$('screenPreview').hidden) showPreview(false);
  toast('Einstellungen gespeichert.');
});
$('btnLogout').addEventListener('click', () => { signOut(); toast('Google-Anmeldung zurückgesetzt.'); });

// ---------------------------------------------------------------- Start
render();
if (settings.clientId) preloadGoogle().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
