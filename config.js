// Voreinstellungen für alle Nutzer. Einmalig vom Administrator ausfüllen,
// dann muss niemand im Büro etwas in den Einstellungen eintragen.
// Die Absenderwerte entsprechen den Standardwerten der KMW-Vorlagen
// (Skills aktenvermerk-kmw und kmw-vorlage-brief).
export const CONFIG = {
  // OAuth-Client-ID aus der Google Cloud Console (Typ "Webanwendung"), siehe README.md
  googleClientId: '',
  // Ordner in "Meine Ablage", in den die Dokumente gespeichert werden
  ordner: 'Diktate',
  // Absender (pro Gerät in den Einstellungen änderbar)
  firma: 'KMW Ingenieurgesellschaft mbH',
  ort: 'Saarbrücken',
  gesellschafter: 'Mühlhäusler Weisang',
  // Unterzeichner wie in der Vorlage KMW_AV01.odt. Solange dieser Name eingestellt ist,
  // erscheint die eingescannte Unterschrift; bei einem anderen Namen wird sie weggelassen.
  name: 'M.Eng. Dirk Mühlhäusler',
  // Brief: Name unter der Unterschrift bei obigem Standard-Unterzeichner (wie im Brief-Skill)
  briefName: 'Dirk Mühlhäusler',
  // Brief: Feld "Unser Zeichen"; die Initialen vor dem "/" stehen im Dateinamen
  unserZeichen: 'MD/sn',
  // Brief: Telefon und E-Mail im Sachbearbeiter-Block, nur bei einem anderen Unterzeichner verwendet
  telefon: '',
  email: '',
};
