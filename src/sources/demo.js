import { EventEmitter } from "node:events";

// Simulated live for testing without a real TikTok Live.
const SAMPLE = [
  ["ama_lome", "Bonsoir tout le monde 👋"],
  ["kossi.tg", "C'est combien le sac noir ?"],
  ["edem228", "Je prends 2 pagnes wax svp"],
  ["afi_b", "trop beau 😍😍"],
  ["yao_kpalime", "Vous livrez à Agoè ?"],
  ["mawuli", "moi je veux les chaussures taille 42"],
  ["sena.k", "🔥🔥🔥"],
  ["dzifa", "Le prix des savons svp"],
  ["komla_99", "Salut de Bè !"],
  ["akpene", "je commande 1 sac rouge, comment payer ?"],
  ["essi", "c'est dispo en bleu ?"],
  ["kodjo", "On peut payer par Flooz ?"],
  ["abla.tg", "ça dure combien de temps la livraison ?"],
  ["selom", "Bravo pour le live"],
  ["enyonam", "Réserve-moi le grand modèle stp"],
  ["kafui", "Je prends 1 pagne, mon WhatsApp 90 12 34 56"],
];

export class DemoSource extends EventEmitter {
  constructor({ intervalMs = 1800 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.i = 0;
  }

  async start() {
    this.emit("status", { state: "connected", message: "Mode démo : live simulé." });
    this.emit("viewers", 87);
    this.timer = setInterval(() => {
      const [user, text] = SAMPLE[this.i % SAMPLE.length];
      this.i += 1;
      this.emit("comment", { id: `demo-${this.i}`, user, nickname: user, text, at: Date.now() });
    }, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }
}
