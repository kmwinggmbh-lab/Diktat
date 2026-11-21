// Aufbereitung des erkannten Sprachtextes: Sprachbefehle, Leerzeichen, Großschreibung.

const W = (words) => new RegExp(`(?<=^|\\s)(?:${words})(?=\\s|$|[.,!?;:])`, 'giu');

// Reihenfolge ist wichtig: mehrteilige Befehle zuerst.
const COMMANDS = [
  [W('neuer absatz|nächster absatz|neuer abschnitt'), '\n\n'],
  [W('neue zeile|nächste zeile|zeilenumbruch'), '\n'],
  [W('überschrift'), '\n\n# '],
  [W('spiegelstrich|aufzählungspunkt|neuer punkt'), '\n- '],
  [W('klammer auf'), ' ('],
  [W('klammer zu'), ')'],
  [W('gedankenstrich'), ' – '],
  [W('fragezeichen'), '?'],
  [W('ausrufezeichen'), '!'],
  [W('doppelpunkt'), ':'],
  [W('semikolon|strichpunkt'), ';'],
  [W('komma'), ','],
  [W('punkt'), '.'],
];

export function applyCommands(raw) {
  let t = ' ' + raw.trim() + ' ';
  for (const [re, rep] of COMMANDS) t = t.replace(re, rep);
  return tidy(t);
}

export function tidy(t) {
  return t
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/ +([.,!?;:)])/g, '$1')
    .replace(/\( +/g, '(')
    .replace(/([.,!?;:])(?=[A-Za-zÄÖÜäöüß])/g, '$1 ')
    .replace(/([.,!?;:])\1+/g, '$1')
    .replace(/^ +| +$/g, '');
}

function capFirst(s) {
  return s.replace(/^(\s*(?:#\s|-\s)?)(\p{Ll})/u, (m, pre, ch) => pre + ch.toUpperCase());
}

/** Großschreibung nach Satzende, Zeilenanfang, Überschrift und Spiegelstrich. */
export function capitalize(s) {
  return s
    .replace(/([.!?]\s+)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/(^|\n)((?:#\s|-\s)?)(\p{Ll})/gu, (m, a, p, b) => a + p + b.toUpperCase());
}

/**
 * Fügt ein erkanntes Segment an der Cursorposition in den bestehenden Text ein.
 * Gibt den neuen Text und die neue Cursorposition zurück.
 */
export function insertSegment(text, pos, rawSegment) {
  let seg = applyCommands(rawSegment);
  if (!seg) return { text, pos };
  const before = text.slice(0, pos);
  const after = text.slice(pos);

  const startOfSentence = before.trim() === '' || /[.!?:]\s*$|\n\s*$|^#\s*$|\n#\s*$|(?:^|\n)-\s*$/.test(before);
  if (startOfSentence && !/^\n/.test(seg)) seg = capFirst(seg);
  seg = capitalize(seg);

  // Überschrift/Spiegelstrich enden mit dem Segment (Sprechpause)
  const lastLine = seg.split('\n').pop();
  if (/^(#|-) /.test(lastLine)) seg += '\n';

  // Vorherige Zeile endet schon mit Umbruch (z. B. nach Überschrift/Spiegelstrich): einen Umbruch weniger
  if (/\n[ \t]*$/.test(before) && /^\n/.test(seg)) seg = seg.slice(1);

  let joiner = '';
  if (before && !/\s$/.test(before) && !/^[\s.,!?;:)]/.test(seg)) joiner = ' ';
  if (/^\n/.test(seg)) { joiner = ''; }
  let combined = before.replace(/[ \t]+$/, (m) => (/^\n/.test(seg) ? '' : m)) + joiner + seg;
  if (/^\n/.test(seg)) combined = combined.replace(/\n{3,}/g, '\n\n');

  let tail = after;
  if (tail && !/^[\s.,!?;:)]/.test(tail) && !/[\s(]$/.test(combined)) tail = ' ' + tail;
  const newText = (combined + tail).replace(/^\n+/, '');
  const newPos = newText.length - tail.length;
  return { text: newText, pos: newPos };
}

/**
 * Entfernt Wiederholungen, die Chrome auf Android bei fortlaufender Erkennung erzeugt
 * (jedes neue Endergebnis enthält dort teils das vorherige noch einmal).
 */
export function dedupeFinal(prevRaw, nextRaw) {
  const p = (prevRaw || '').trim().toLowerCase();
  const n = nextRaw.trim();
  if (p && n.toLowerCase().startsWith(p)) return n.slice(p.length).trim();
  return n;
}
