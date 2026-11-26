# TackTack

Live-Verkauf auf TikTok mit KI: TackTack liest die Kommentare eines laufenden TikTok Lives, erkennt Kunden mit Kaufabsicht und schließt den Kauf später über WhatsApp ab. Erster Markt: Lomé (Togo), Sprache Französisch, Preise in CFA, Zahlung über Flooz und T-Money.

## Stand: Schritt 1 – Live-Kommentare lesen

- Verbindung zu einem laufenden TikTok Live über den Benutzernamen des Verkäufers
- Jeder Kommentar wird eingeordnet: **Veut acheter**, **Demande le prix**, **Question produit**, **Livraison / paiement** oder uninteressant
- Optionale Liste „Produits du jour“, damit die KI Artikel richtig zuordnet
- Demo-Modus mit simuliertem Live zum Ausprobieren ohne echtes Live
- Oberfläche auf Französisch, funktioniert auf dem Handy und am Computer

Ohne `ANTHROPIC_API_KEY` läuft TackTack mit einer einfachen Erkennung über Schlüsselwörter. Mit Schlüssel analysiert Claude die Kommentare (mehrere Kommentare pro Anfrage, damit es auch bei vollen Lives günstig bleibt).

## Stand: Schritt 2 – Verkäufer-Dashboard

- Reiter **Mes produits**: Produkte mit Preis in F CFA und optionalem Bestand anlegen, bearbeiten, löschen und für das heutige Live an- oder abschalten. Die aktiven Produkte gehen automatisch als „Produits du jour“ an die KI.
- Reiter **Mon live**: pro Kunde eine Karte mit Absicht, erkanntem Produkt, Menge und Betrag. Der Verkäufer setzt den Status auf Nouveau, Contacté, Payé oder Annulé.
- Kennzahl **ventes prévues**: Summe der Kaufwünsche (ohne Annulé).
- Produkte und Kunden bleiben nach einem Neustart erhalten (Datei `data/tacktack.json`, änderbar über `DATA_FILE`). Noch ohne Anmeldung, ein Verkäufer pro Server; mehrere Verkäufer kommen mit Schritt 4.

## Starten

**Windows:** Doppelklick auf `start-windows.bat`. Beim ersten Start installiert sie alles Nötige und öffnet danach den Browser. Voraussetzung ist Node.js (LTS) von https://nodejs.org.

**Kommandozeile:**

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY eintragen (optional)
npm start
```

Dann http://localhost:3000 öffnen, „Essayer en démo“ klicken oder ein laufendes Live mit dem TikTok-Namen verbinden.

## Tests

```bash
npm test
```

## Gut zu wissen

- TikTok bietet keine offizielle Schnittstelle für Live-Kommentare. TackTack nutzt die inoffizielle Bibliothek `tiktok-live-connector`, die über den Dienst Euler Stream signiert. Bei vielen Verbindungen braucht man dort einen eigenen Schlüssel (`EULER_API_KEY`).
- Das Live wird wie gewohnt in der TikTok-App gestartet; TackTack liest parallel mit.

## Nächste Schritte

2. Verkäufer-Web-App (Anmeldung, Produkte, Übersicht der Käufer)
3. Kaufabschluss über WhatsApp mit Zahlungslink für Flooz und T-Money
4. Fertig für mehrere Verkäufer
