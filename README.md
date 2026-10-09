# moon-welt

Test-Projekt, das über GitHub Pages ausgeliefert wird (direkt vom `main`-Branch).

- `index.html` – Hello-World-Startseite
- `essensplaner/` – **Wocheneinkauf- & Essensplaner** → `https://<user>.github.io/moon-welt/essensplaner/`

## Essensplaner

Ein paar Fragen beantworten, dann gibt es einen Wochenplan und die passende Einkaufsliste.

**Abgefragt wird (5 Schritte):**

1. **Haushalt** – Erwachsene und Kinder (Kinder ≈ 60 % Portion)
2. **Ernährung** – Alles / Flexitarisch / Pescetarisch / Vegetarisch / Vegan, max. Fleischtage pro Woche,
   Unverträglichkeiten (Gluten, Laktose, Nüsse, Ei), Abneigungen als Freitext („Pilze, Fisch“)
3. **Woche** – Startdatum, welche Mahlzeiten an welchem Tag (Frühstück/Mittag/Abend), Resteverwertung
   (abends doppelt kochen → nächster Mittag)
4. **Kochen** – max. Kochzeit werktags/Wochenende, Budget, Lieblingsküchen
5. **Vorrat** – was schon da ist (wird auf der Liste automatisch abgehakt), Basics wie Salz/Öl vorhanden?

**Danach:**

- Wochenplan mit Abwechslung (keine Wiederholungen, nicht zweimal hintereinander dieselbe Hauptzutat oder Küche),
  Kochzeit-Limits, Fleisch-Limit und kinderfreundliche Gerichte bevorzugt
- Pro Gericht: 🔄 tauschen, ✎ selbst auswählen (mit Suche), 📌 fixieren (bleibt beim Neu-Würfeln), ✕ streichen
- Rezeptansicht mit auf den Haushalt skalierten Mengen und Zubereitung, Lieblingsgerichte (❤️) werden bevorzugt
- Einkaufsliste nach Supermarkt-Abteilungen, Mengen summiert und in Packungen umgerechnet (z. B. „2 Dosen à 400 g“),
  abhakbar, eigene Artikel, als Text kopieren / per Share-Sheet senden, drucken

### Wie das auf GitHub Pages funktioniert

GitHub Pages kann nur statische Dateien ausliefern – deshalb läuft alles im Browser:

- **Kein Build, kein Backend:** reines HTML/CSS/JavaScript (`index.html`, `style.css`, `data.js`, `app.js`).
  Einfach pushen, Pages liefert aus. Lokal reicht es, `essensplaner/index.html` im Browser zu öffnen.
- **Rezeptdatenbank** liegt in `data.js` (≈ 50 Hauptgerichte, 12 Frühstücke, Zutatenkatalog mit Kategorie,
  Einheit, Allergenen und Packungsgrößen). Neue Rezepte = neuer Eintrag dort.
- **Speichern:** Plan, Häkchen und Favoriten liegen im `localStorage` des Browsers – kein Konto nötig.
- **Teilen:** „🔗 Teilen“ erzeugt einen Link, der den kompletten Plan im URL-Hash (`#plan=…`) enthält.
  Wer ihn öffnet (z. B. Partner:in am Handy), bekommt denselben Plan und dieselbe Einkaufsliste.
