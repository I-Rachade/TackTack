import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const LEAD_STATUSES = ["nouveau", "contacte", "paye", "annule"];

const normalize = (s) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Keyword mode: "je prends 2 pagnes" -> 2, but not "taille 42".
function guessQuantity(text, productName) {
  const productWords = new Set(normalize(productName).split(" ").map((w) => w.replace(/s$/, "")));
  for (const m of normalize(text).matchAll(/\b(\d{1,2}) ([a-z]+)/g)) {
    if (productWords.has(m[2].replace(/s$/, ""))) return Number(m[1]);
  }
  return null;
}

export const formatCfa = (n) => `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} F`;

// Phase 2: one seller, data kept in a JSON file. Multi-seller storage comes with step 4.
export class Store {
  constructor({ file } = {}) {
    this.file = file ?? null;
    this.data = { products: [], leads: [], liveId: null };
    if (this.file && fs.existsSync(this.file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // --- Products -----------------------------------------------------------

  listProducts() {
    return this.data.products;
  }

  static validateProduct(input, partial = false) {
    const out = {};
    if (!partial || "name" in input) {
      const name = String(input.name ?? "").trim();
      if (!name) throw new Error("Le nom du produit est obligatoire.");
      out.name = name.slice(0, 120);
    }
    if (!partial || "price" in input) {
      const price = Number(input.price);
      if (!Number.isInteger(price) || price < 0) throw new Error("Le prix doit être un nombre entier de francs CFA.");
      out.price = price;
    }
    if ("stock" in input) {
      if (input.stock === null || input.stock === "") out.stock = null;
      else {
        const stock = Number(input.stock);
        if (!Number.isInteger(stock) || stock < 0) throw new Error("Le stock doit être un nombre entier positif.");
        out.stock = stock;
      }
    } else if (!partial) out.stock = null;
    if ("active" in input) out.active = Boolean(input.active);
    else if (!partial) out.active = true;
    return out;
  }

  addProduct(input) {
    const product = { id: randomUUID(), ...Store.validateProduct(input) };
    this.data.products.push(product);
    this.save();
    return product;
  }

  updateProduct(id, input) {
    const product = this.data.products.find((p) => p.id === id);
    if (!product) return null;
    Object.assign(product, Store.validateProduct(input, true));
    this.save();
    return product;
  }

  deleteProduct(id) {
    const before = this.data.products.length;
    this.data.products = this.data.products.filter((p) => p.id !== id);
    this.save();
    return this.data.products.length < before;
  }

  // The "Produits du jour" text given to the AI.
  catalogText() {
    return this.data.products
      .filter((p) => p.active)
      .map((p) => `${p.name} - ${formatCfa(p.price)}${p.stock != null ? ` (stock : ${p.stock})` : ""}`)
      .join("\n");
  }

  // Finds the product a comment refers to from the AI's (or seller's) wording.
  matchProduct(name) {
    const wanted = normalize(name);
    if (!wanted) return null;
    const active = this.data.products.filter((p) => p.active);
    const exact = active.find((p) => normalize(p.name) === wanted);
    if (exact) return exact;
    const words = new Set(wanted.split(" ").map((w) => w.replace(/s$/, "")));
    let best = null;
    let bestScore = 0;
    for (const p of active) {
      const pWords = normalize(p.name).split(" ").map((w) => w.replace(/s$/, ""));
      const score = pWords.filter((w) => w.length > 1 && words.has(w)).length / pWords.length;
      if (score > bestScore) [best, bestScore] = [p, score];
    }
    return bestScore >= 0.5 ? best : null;
  }

  // --- Leads (customers interested during a live) ---------------------------

  startLive() {
    this.data.liveId = randomUUID();
    this.save();
    return this.data.liveId;
  }

  listLeads() {
    return this.data.leads.filter((l) => l.liveId === this.data.liveId);
  }

  // One lead per customer and live; each new buying comment updates it.
  recordIntent(comment, result) {
    const liveId = this.data.liveId;
    let lead = this.data.leads.find((l) => l.liveId === liveId && l.user === comment.user);
    if (!lead) {
      lead = {
        id: randomUUID(),
        liveId,
        user: comment.user,
        nickname: comment.nickname ?? comment.user,
        intent: result.intent,
        productId: null,
        product: null,
        quantity: null,
        unitPrice: null,
        total: null,
        status: "nouveau",
        comments: [],
        firstAt: comment.at ?? Date.now(),
      };
      this.data.leads.push(lead);
    }
    // A purchase outranks a question; never downgrade a lead that already wants to buy.
    if (result.intent === "achat" || lead.intent !== "achat") lead.intent = result.intent;
    lead.comments.push({ text: comment.text, intent: result.intent, at: comment.at ?? Date.now() });
    lead.lastAt = comment.at ?? Date.now();

    // Without the AI (keyword mode) no product is extracted, so look for it in the comment itself.
    const product = this.matchProduct(result.product ?? comment.text);
    if (product) {
      lead.productId = product.id;
      lead.product = product.name;
      lead.unitPrice = product.price;
    } else if (result.product && !lead.product) {
      lead.product = result.product;
    }
    const quantity = result.quantity ?? (product && !result.product ? guessQuantity(comment.text, product.name) : null);
    if (quantity) lead.quantity = quantity;
    lead.total = lead.unitPrice != null ? lead.unitPrice * (lead.quantity ?? 1) : null;
    this.save();
    return lead;
  }

  updateLead(id, { status }) {
    const lead = this.data.leads.find((l) => l.id === id);
    if (!lead) return null;
    if (!LEAD_STATUSES.includes(status)) throw new Error("Statut inconnu.");
    lead.status = status;
    this.save();
    return lead;
  }
}
