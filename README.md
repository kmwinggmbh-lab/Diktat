# KMW Diktat

Diktier-App fürs Handy: diktieren, als Textdatei im Projektordner auf Google Drive sichern und mit
**Fertigstellen** daraus einen Aktenvermerk oder Brief als ODT (KMW-Vorlage) und PDF erzeugen.

Die App läuft als Web-App im Browser (Chrome auf Android, Safari auf dem iPhone) und lässt sich über
„Zum Startbildschirm hinzufügen“ wie eine App ablegen. Veröffentlicht wird sie über GitHub Pages
(Workflow `.github/workflows/pages.yml`).

**Dieses Repository enthält nur Programmcode.** Die KMW-Vorlagen `KMW_AV01.odt` und
`KMW_Vorlage_Brief.odt` lädt die App nach der Google-Anmeldung aus Google Drive (Ordner
„KMW Diktat Vorlagen“). Keine Vorlagen, Unterschriften oder Bankdaten hier ablegen – der Workflow
bricht ab, falls eine `.odt`-Datei im Repository liegt.

Einrichtung: OAuth-Client-ID (Typ „Webanwendung“, JavaScript-Quelle `https://kmwinggmbh-lab.github.io`)
in der Google Cloud Console anlegen und in `config.js` bei `googleClientId` eintragen.

Entwickelt wird die App im Repository `kmwinggmbh-lab/Kmw01` unter `apps/diktat/` (ausführliche
Anleitung, Tests mit Vorlagen). Dieses Repository ist die veröffentlichte Fassung.
