import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands, insertSegment, dedupeFinal } from '../textproc.js';
import { bodyToHtml, fileName } from '../doc.js';

const feed = (segs) => segs.reduce((acc, s) => insertSegment(acc.text, acc.text.length, s), { text: '', pos: 0 }).text;

test('Satzzeichen-Befehle', () => {
  assert.equal(applyCommands('heute fand ein ortstermin statt punkt'), 'heute fand ein ortstermin statt.');
  assert.equal(applyCommands('erstens komma zweitens fragezeichen'), 'erstens, zweitens?');
  assert.equal(applyCommands('Ergebnis doppelpunkt alles gut'), 'Ergebnis: alles gut');
});

test('Großschreibung und Leerzeichen über mehrere Segmente', () => {
  const t = feed(['heute fand ein ortstermin statt punkt', 'die tür ist mangelhaft punkt neuer absatz', 'weiteres vorgehen doppelpunkt angebot einholen']);
  assert.equal(t, 'Heute fand ein ortstermin statt. Die tür ist mangelhaft.\n\nWeiteres vorgehen: angebot einholen');
});

test('Überschrift und Spiegelstrich', () => {
  const t = feed(['überschrift teilnehmer', 'spiegelstrich herr müller', 'spiegelstrich frau schmidt', 'neuer absatz es wurde besprochen']);
  assert.equal(t, '# Teilnehmer\n- Herr müller\n- Frau schmidt\n\nEs wurde besprochen');
});

test('Einfügen mitten im Text', () => {
  const r = insertSegment('Erster Satz. Dritter Satz.', 13, 'zweiter satz punkt');
  assert.equal(r.text, 'Erster Satz. Zweiter satz. Dritter Satz.');
});

test('Android-Wiederholungen entfernen', () => {
  assert.equal(dedupeFinal('hallo welt', 'hallo welt wie geht es'), 'wie geht es');
  assert.equal(dedupeFinal('', 'hallo'), 'hallo');
  assert.equal(dedupeFinal('abc', 'xyz'), 'xyz');
});

test('Wort Punkt innerhalb anderer Wörter bleibt', () => {
  assert.equal(applyCommands('treffpunkt am haupteingang'), 'treffpunkt am haupteingang');
});

test('HTML-Aufbau', () => {
  const h = bodyToHtml('# Anlass\nText <b>\n\n- a\n- b');
  assert.match(h, /1&nbsp;&nbsp;Anlass/);
  assert.match(h, /&lt;b&gt;/);
  assert.match(h, /<ul[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ul>/);
});

test('Dateiname wie in den Skills', () => {
  const snd = { unserZeichen: 'MD/sn' };
  assert.equal(fileName({ projekt: '275600', datum: '2026-11-21', type: 'av', betreff: 'Ortstermin Villa/Hirsch' }, snd), '275600_2026-11-21_AV_Ortstermin_Villa-Hirsch');
  assert.equal(fileName({ projekt: '144300', datum: '2026-10-15', type: 'brief' }, snd), '144300-261015-MD-BR01');
  assert.equal(fileName({ projekt: '', datum: '2026-10-15', type: 'brief' }, snd, 3), '261015-MD-BR03');
});
