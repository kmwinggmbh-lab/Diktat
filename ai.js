// Optionale Textglättung mit Claude. Wird nur genutzt, wenn ein API-Schlüssel hinterlegt ist.
// Die Bibliothek wird erst beim ersten Klick geladen.

const SYSTEM = (type) => `Du überarbeitest diktierten Text für ${type === 'brief' ? 'einen Geschäftsbrief' : 'einen Aktenvermerk'} eines Ingenieurbüros. Der Text stammt aus einer automatischen Spracherkennung und steht im Tag <diktat>.

Regeln:
- Nichts erfinden und nichts weglassen: keine Namen, Daten, Zahlen, Normen, Teilnehmer oder Ergebnisse ergänzen, die nicht im Diktat stehen. Die Aussagen bleiben unverändert.
- Rechtschreibung, Zeichensetzung und Grammatik korrigieren. Offensichtliche Erkennungsfehler nur korrigieren, wenn die richtige Lesart eindeutig ist; sonst die Stelle als [unklar: …] markieren.
- Stichpunkte und Satzfragmente in ganze, sachliche Sätze bringen. Füllwörter und Versprecher des Sprechens entfernen.
- Sinnvoll in Absätze gliedern (Leerzeile zwischen Absätzen). Zwischenüberschriften als Zeile „# Überschrift“ nur, wenn der Inhalt klar in mehrere Themen zerfällt. Aufzählungen als Zeilen „- Punkt“.
- ${type === 'brief'
    ? 'Keine Anrede, keinen Betreff und keine Grußformel schreiben – diese ergänzt die App selbst. Der erste Satz folgt auf eine Anrede mit Komma und beginnt deshalb klein, sofern das erste Wort kein Substantiv oder Name ist.'
    : 'Keinen Titel „Aktenvermerk“, kein Datum und keine Unterschrift schreiben – diese ergänzt die App selbst.'}
- Antworte ausschließlich mit dem überarbeiteten Text, ohne Einleitung, Kommentar oder weitere Formatierung.`;

let AnthropicCls = null;

export async function smoothText(text, type, apiKey) {
  if (!AnthropicCls) ({ Anthropic: AnthropicCls } = await import('./vendor/anthropic-sdk-1.6.0.js'));
  const client = new AnthropicCls({ apiKey, dangerouslyAllowBrowser: true });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM(type),
      messages: [{ role: 'user', content: `<diktat>\n${text}\n</diktat>` }],
    });
  } catch (e) {
    if (e instanceof AnthropicCls.AuthenticationError) throw new Error('Der Claude-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.');
    if (e instanceof AnthropicCls.RateLimitError) throw new Error('Zu viele Anfragen – bitte kurz warten und erneut versuchen.');
    if (e instanceof AnthropicCls.APIConnectionError) throw new Error('Keine Verbindung zum KI-Dienst. Besteht eine Internetverbindung?');
    if (e instanceof AnthropicCls.APIError) throw new Error('KI-Dienst meldet einen Fehler: ' + (e.message || e.status));
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Die KI hat die Überarbeitung abgelehnt. Der Text bleibt unverändert.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Der Text ist zu lang für eine Überarbeitung am Stück.');
  const out = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!out) throw new Error('Die KI hat keinen Text geliefert.');
  return out.replace(/^<diktat>\s*|\s*<\/diktat>$/g, '');
}
