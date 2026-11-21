// Aufbau von Aktenvermerk und Brief: Vorschau, Google-Dokument (HTML), Klartext, Dateiname.
// Gliederung wie in den KMW-Vorlagen (KMW_AV01.odt bzw. KMW_Vorlage_Brief.odt).

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BLUE = '#1f4e8c';
const S = {
  p: 'margin:0 0 8pt 0;text-align:justify;',
  h: 'font-size:11pt;font-weight:bold;margin:12pt 0 4pt 0;',
  ul: 'margin:0 0 8pt 0;padding-left:18pt;',
};

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

const lines = (s) => String(s || '').split('\n').map((z) => z.trim()).filter(Boolean);

/**
 * Absenderangaben für das Dokument. Beim voreingestellten Unterzeichner gelten Name,
 * Unterschrift und Kontaktblock der Vorlage; bei einem anderen Namen entfällt die Unterschrift.
 */
export function sender(settings, config) {
  const custom = !!settings.name && settings.name !== config.name;
  return {
    ort: settings.ort || config.ort,
    firma: settings.firma || config.firma,
    gesellschafter: config.gesellschafter,
    custom,
    unterschrift: !custom,
    avName: custom ? settings.name : config.name,
    briefName: custom ? settings.name : config.briefName,
    unserZeichen: settings.unserZeichen || config.unserZeichen,
    telefon: settings.telefon || '',
    email: settings.email || '',
  };
}

/** Optionen für odt.js aus den Absenderangaben */
export function odtOptions(type, snd) {
  if (type === 'brief') {
    return {
      unserZeichen: snd.unserZeichen,
      sachbearbeiter: snd.custom ? { name: snd.briefName, telefon: snd.telefon, email: snd.email } : null,
      gesellschafter: snd.gesellschafter, firma: snd.firma, name: snd.briefName, unterschrift: snd.unterschrift,
    };
  }
  return { ort: snd.ort, unterzeichner: snd.custom ? snd.avName : '', unterschrift: snd.unterschrift };
}

/** Inline: **fett**, *kursiv*, [unklar: …] markieren */
function inline(s, preview) {
  let h = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');
  if (preview) h = h.replace(/\[([^\]]*(?:unklar|ergänzen)[^\]]*)\]/gi, '<span class="missing">[$1]</span>');
  return h;
}

/** Text mit "# Überschrift", "- Punkt", "1. Punkt" und Leerzeilen in HTML umwandeln */
export function bodyToHtml(text, preview = false) {
  const ls = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let list = null;
  let hNum = 0;
  const flushPara = () => {
    if (para.length) out.push(`<p style="${S.p}">${para.map((l) => inline(l, preview)).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag} style="${S.ul}">${list.items.map((i) => `<li style="margin:0 0 3pt 0;">${inline(i, preview)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of ls) {
    const l = raw.trim();
    let m;
    if (!l) { flushPara(); flushList(); continue; }
    if ((m = l.match(/^#{1,3}\s+(.*)$/))) {
      flushPara(); flushList();
      hNum += 1;
      const t = m[1].replace(/^\d+(\.\d+)*\.?\s+/, '');
      out.push(`<p style="${S.h}">${hNum}&nbsp;&nbsp;${inline(t, preview)}</p>`);
      continue;
    }
    if ((m = l.match(/^[-•–*]\s+(.*)$/)) || (m = l.match(/^(\d+)[.)]\s+(.*)$/))) {
      const ordered = m.length === 3;
      const item = ordered ? m[2] : m[1];
      const tag = ordered ? 'ol' : 'ul';
      flushPara();
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(item);
      continue;
    }
    flushList();
    para.push(l);
  }
  flushPara(); flushList();
  return out.join('\n');
}

const avTitle = (d) => ['Aktenvermerk', d.betreff?.trim()].filter(Boolean).join(' – ');
const briefBetreff = (d) => [...lines(d.bauvorhaben), ...lines(d.betreff)];

function missing(label, preview) {
  return preview ? `<span class="missing">[${esc(label)} ergänzen]</span>` : '';
}

const sig = (snd, preview) => (snd.unterschrift
  ? `<p style="margin:0;height:30pt;${preview ? 'color:#888;font-style:italic;font-size:9pt;' : ''}">${preview ? '(Unterschrift)' : ''}</p>`
  : '<p style="margin:0;height:30pt;"></p>');

export function buildDoc(d, snd, { preview = false } = {}) {
  const datum = formatDate(d.datum);
  const body = d.text.trim() ? bodyToHtml(d.text, preview) : `<p style="${S.p}">${missing('Text', preview)}</p>`;
  let inner;
  if (d.type === 'brief') {
    const empf = lines(d.empfaenger).length ? lines(d.empfaenger).map(esc).join('<br>') : missing('Empfänger', preview);
    const betr = briefBetreff(d).map(esc).join('<br>');
    const anl = lines(d.anlagen);
    inner = `<p style="margin:0 0 4pt 0;font-size:7.5pt;color:#555;"><u>${esc(snd.firma)} · ${esc(snd.ort)}</u></p>
<p style="margin:0 0 18pt 0;">${empf}</p>
<p style="margin:0 0 18pt 0;text-align:right;font-size:9pt;">Unser Zeichen: ${esc(snd.unserZeichen)}&nbsp;&nbsp;&nbsp;Tag: ${datum}</p>
${betr ? `<p style="margin:0 0 14pt 0;font-weight:bold;">${betr}</p>` : (preview ? `<p>${missing('Betreff', true)}</p>` : '')}
${d.anrede ? `<p style="${S.p}">${esc(d.anrede)}</p>` : ''}
${body}
<p style="margin:14pt 0 8pt 0;">mit freundlichen Grüßen</p>
<p style="margin:0;">${esc(snd.gesellschafter)}</p>
<p style="margin:0;">${esc(snd.firma)}</p>
${sig(snd, preview)}
<p style="margin:0;">${esc(snd.briefName)}</p>
${anl.length ? `<p style="margin:14pt 0 4pt 0;font-weight:bold;">Anlagen</p><ul style="${S.ul}">${anl.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`;
  } else {
    inner = `<p style="margin:0 0 18pt 0;text-align:right;font-size:9pt;color:#555;">${esc(snd.firma)} · ${esc(snd.ort)}</p>
<p style="margin:0 0 14pt 0;font-size:11pt;font-weight:bold;color:${BLUE};">${esc(avTitle(d))}</p>
${body}
<p style="margin:18pt 0 8pt 0;">${esc(snd.ort)}, den ${datum}</p>
<p style="margin:0;">${esc(snd.gesellschafter)}</p>
<p style="margin:0;">${esc(snd.firma)}</p>
${sig(snd, preview)}
<p style="margin:0;">${esc(snd.avName)}</p>`;
  }
  if (preview) return inner;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.type === 'brief' ? briefBetreff(d).join(' – ') : avTitle(d))}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.35;">${inner}</body></html>`;
}

const clean = (x) => String(x || '').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_');

/**
 * Dateinamen wie in den Skills:
 *  Aktenvermerk: <Projektnr>_<JJJJ-MM-TT>_AV_<Betreff>          (aktenvermerk-kmw)
 *  Brief:        <Projektnr>-<JJMMTT>-<Kürzel>-BR<lfd. Nr.>       (kmw-vorlage-brief)
 * Für den Brief gibt `prefix` den Teil ohne laufende Nummer zurück.
 */
export function fileName(d, snd, nr = 1) {
  if (d.type === 'brief') return briefPrefix(d, snd) + String(nr).padStart(2, '0');
  const kurz = clean(d.betreff).slice(0, 50).replace(/_+$/, '');
  return [clean(d.projekt), d.datum, 'AV', kurz].filter(Boolean).join('_');
}
export function briefPrefix(d, snd) {
  const [y, m, t] = (d.datum || '').split('-');
  const kuerzel = clean((snd.unserZeichen || 'MD').split('/')[0]).toUpperCase() || 'MD';
  return [clean(d.projekt), `${(y || '').slice(2)}${m || ''}${t || ''}`, kuerzel, 'BR'].filter(Boolean).join('-');
}
