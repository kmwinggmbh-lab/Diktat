// Google-Drive-Anbindung: Anmeldung über Google Identity Services und schlanke Drive-API-Aufrufe.
// Berechtigung "drive": nötig, um die vorhandenen Projektordner zu finden und dort abzulegen.

const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,webViewLink';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let gsiPromise = null;
let tokenClient = null;
let tokenClientId = null;
let token = null;
let tokenExp = 0;

export function preloadGoogle() {
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.async = true;
      sc.onload = () => resolve();
      sc.onerror = () => { gsiPromise = null; reject(new Error('Google-Anmeldung konnte nicht geladen werden. Besteht eine Internetverbindung?')); };
      document.head.appendChild(sc);
    });
  }
  return gsiPromise;
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; tokenExp = 0;
}

let currentClientId = null;

async function getToken(clientId) {
  if (token && Date.now() < tokenExp - 60_000) return token;
  await preloadGoogle();
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId;
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error('Google-Anmeldung abgelehnt: ' + resp.error));
      token = resp.access_token;
      tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      resolve(token);
    };
    tokenClient.error_callback = (err) => {
      const t = err?.type;
      reject(new Error(t === 'popup_closed' ? 'Anmeldung abgebrochen.'
        : t === 'popup_failed_to_open' ? 'Anmeldefenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.'
        : 'Google-Anmeldung fehlgeschlagen.'));
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function raw(path, opts = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  if (res.status === 401) { token = null; throw Object.assign(new Error('auth'), { reauth: true }); }
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    throw new Error('Google Drive: ' + msg);
  }
  return res;
}

/** API-Aufruf; bei abgelaufener Anmeldung einmal neu anmelden und wiederholen. */
async function call(path, opts = {}, as = 'json') {
  for (let attempt = 0; ; attempt++) {
    await getToken(currentClientId);
    try {
      const res = await raw(path, opts);
      return as === 'blob' ? res.blob() : as === 'buffer' ? res.arrayBuffer() : as === 'none' ? null : res.json();
    } catch (e) {
      if (!e.reauth || attempt) throw e.reauth ? new Error('Google-Anmeldung abgelaufen. Bitte erneut versuchen.') : e;
    }
  }
}

/** Muss direkt nach einem Tippen aufgerufen werden (Anmeldefenster). */
export async function connect(clientId) {
  currentClientId = clientId;
  await getToken(clientId);
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const list = async (query, fields = 'files(id,name)') =>
  (await call(`/files?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${encodeURIComponent(fields)}&q=${encodeURIComponent(query)}`)).files || [];

/** Ordner, deren Name mit der Projektnummer beginnt (wie im Skill aktenvermerk-kmw). */
export async function findProjectFolders(nr) {
  const all = await list(`mimeType='${FOLDER_MIME}' and trashed=false and name contains '${q(nr)}'`);
  return all.filter((f) => f.name.trim().startsWith(nr)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function subfolders(parentId, nameContains) {
  return list(`'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and name contains '${q(nameContains)}'`);
}

export async function getFolder(id) {
  const f = await call(`/files/${id}?supportsAllDrives=true&fields=id,name,trashed,mimeType`);
  return f.trashed || f.mimeType !== FOLDER_MIME ? null : f;
}

export async function createFolder(name, parentId = 'root') {
  return call(`/files?supportsAllDrives=true&fields=${FIELDS}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
}

/** Ordner im Wurzelverzeichnis von "Meine Ablage" suchen oder anlegen. */
export async function ensureRootFolder(name) {
  const found = await list(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`);
  return found[0] || createFolder(name, 'root');
}

/** Dateinamen im Ordner (ohne .txt/.odt/.pdf), die `prefix` enthalten */
export async function namesInFolder(folderId, prefix) {
  const files = await list(`'${folderId}' in parents and trashed=false and name contains '${q(prefix)}'`);
  return new Set(files.map((f) => f.name.replace(/\.(txt|odt|pdf)$/i, '')));
}

export async function findFile(folderId, name) {
  const f = await list(`'${folderId}' in parents and trashed=false and name='${q(name)}'`, `files(${FIELDS})`);
  return f[0] || null;
}

function multipart(meta, contentType, data) {
  const boundary = 'diktat' + Math.random().toString(36).slice(2);
  return {
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`, data, `\r\n--${boundary}--`,
    ]),
  };
}

/** Neue Datei hochladen. meta: {name, parents, mimeType?} */
export async function createFile(meta, contentType, data) {
  return call(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, { method: 'POST', ...multipart(meta, contentType, data) });
}

/** Inhalt (und ggf. Name) einer vorhandenen Datei ersetzen */
export async function updateFile(id, meta, contentType, data) {
  return call(`${UPLOAD}/${id}?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, { method: 'PATCH', ...multipart(meta, contentType, data) });
}

export async function renameFile(id, name) {
  return call(`/files/${id}?supportsAllDrives=true&fields=${FIELDS}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
}

export async function getFile(id) {
  try { const f = await call(`/files/${id}?supportsAllDrives=true&fields=${FIELDS},trashed`); return f.trashed ? null : f; }
  catch (e) { if (/404|not found/i.test(e.message)) return null; throw e; }
}

export async function exportPdf(id) {
  return call(`/files/${id}/export?mimeType=application/pdf`, {}, 'blob');
}

export async function deleteFile(id) {
  return call(`/files/${id}?supportsAllDrives=true`, { method: 'DELETE' }, 'none');
}

/** Dateien mit genau diesem Namen (für die Vorlagen) */
export async function findFilesByName(name) {
  return list(`name='${q(name)}' and trashed=false`, 'files(id,name,modifiedTime)');
}

export async function download(id) {
  return call(`/files/${id}?alt=media&supportsAllDrives=true`, {}, 'buffer');
}
