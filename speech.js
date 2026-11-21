// Spracherkennung über die Web Speech API des Browsers (Chrome/Android, Safari/iOS).

import { dedupeFinal } from './textproc.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;

/**
 * @param {object} h  onFinal(text), onInterim(text), onState(running:boolean), onError(msg)
 */
export function createDictation(h) {
  let rec = null;
  let wanted = false;
  let lastFinalRaw = '';
  let handled = 0;
  let restartTimer = null;
  let lastStart = 0;
  let quickFails = 0;

  function start() {
    if (!SR) return;
    wanted = true;
    quickFails = 0;
    h.onState(true);
    begin();
  }

  function begin() {
    rec = new SR();
    rec.lang = 'de-DE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    handled = 0;
    lastFinalRaw = '';
    lastStart = Date.now();

    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          if (i < handled) continue;
          handled = i + 1;
          const piece = dedupeFinal(lastFinalRaw, t);
          lastFinalRaw = t;
          if (piece) h.onFinal(piece);
        } else {
          interim += t;
        }
      }
      h.onInterim(interim);
    };

    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      wanted = false;
      const msg = {
        'not-allowed': 'Kein Zugriff auf das Mikrofon. Bitte in den Browser-Einstellungen erlauben.',
        'service-not-allowed': 'Spracherkennung ist auf diesem Gerät nicht erlaubt.',
        'audio-capture': 'Kein Mikrofon gefunden.',
        network: 'Die Spracherkennung braucht eine Internetverbindung.',
        'language-not-supported': 'Deutsch wird von der Spracherkennung nicht unterstützt.',
      }[ev.error] || 'Spracherkennung unterbrochen (' + ev.error + ').';
      h.onError(msg);
    };

    rec.onend = () => {
      h.onInterim('');
      if (!wanted) { h.onState(false); return; }
      // Browser beendet die Erkennung nach Sprechpausen – automatisch weitermachen.
      quickFails = Date.now() - lastStart < 1000 ? quickFails + 1 : 0;
      if (quickFails > 4) { wanted = false; h.onState(false); h.onError('Spracherkennung startet nicht. Bitte erneut versuchen.'); return; }
      restartTimer = setTimeout(() => { if (wanted) begin(); }, 150);
    };

    try { rec.start(); } catch { /* läuft bereits */ }
  }

  function stop() {
    wanted = false;
    clearTimeout(restartTimer);
    if (rec) { try { rec.stop(); } catch {} }
    h.onState(false);
  }

  return { start, stop, get running() { return wanted; } };
}
