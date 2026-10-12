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

## Stand: Schritt 3 – KI-Verkaufsassistentin

- Die KI liest die Kommentare mit Zusammenhang: Sie bekommt die Produkte mit Preis und Restbestand, den aktuellen Warenkorb der Kunden und die letzten Kommentare im Live. So versteht sie „moi aussi“, „plutôt le rouge“, „ajoute un savon“ oder „finalement non“.
- Pro Kunde ein **Warenkorb** mit mehreren Artikeln, Farbe/Größe und Gesamtbetrag. Ausverkaufte Artikel nimmt die KI nicht mehr an; reservierte Mengen zählen gegen den Bestand.
- Jeder Kunde bekommt einen **Bestellcode** (z. B. TT4821). Er schreibt ihn dem Verkäufer auf WhatsApp; so schreibt der Kunde zuerst, wie WhatsApp es verlangt.
- **Antwort für das Live**: Bestätigung mit Betrag, WhatsApp-Nummer und Code, oder die Antwort der KI auf Fragen (Preis, Farbe, Lieferung). Ein Knopf kopiert sie.
- **WhatsApp-Nachricht** mit Bestellung, Gesamtbetrag und den Flooz- und T-Money-Nummern des Verkäufers. Schreibt ein Kunde seine Nummer in einen Kommentar, öffnet ein Knopf direkt den WhatsApp-Chat mit der Nachricht.
- Reiter **Mes produits**: neuer Bereich „WhatsApp et paiement“ für Boutique-Name, WhatsApp-, Flooz- und T-Money-Nummer.

Ohne `ANTHROPIC_API_KEY` funktionieren Warenkorb, Code und Nachrichten mit den Schlüsselwörtern, aber ohne Zusammenhang und ohne KI-Antworten auf Fragen.

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
3. WhatsApp Business automatisch anbinden (Nachrichten ohne Kopieren senden) und echte Zahlungslinks für Flooz und T-Money, z. B. über PayGate Global
4. Fertig für mehrere Verkäufer
