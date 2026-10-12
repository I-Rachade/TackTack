import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const LEAD_STATUSES = ["nouveau", "contacte", "paye", "livre", "annule"];

export const normalize = (s) =>
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

const EMPTY_SETTINGS = { shopName: "", whatsapp: "", flooz: "", tmoney: "", zones: "" };

// "Bè = 1000" per line -> [{ name: "Bè", fee: 1000 }]
export function parseZones(text) {
  const zones = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*(.+?)\s*[=:]\s*(\d[\d\s]*)\s*F?\s*$/i);
    if (!m) throw new Error(`Zone de livraison invalide : « ${line.trim()} ». Écris par exemple « Bè = 1000 ».`);
    zones.push({ name: m[1].slice(0, 60), fee: Number(m[2].replace(/\s/g, "")) });
  }
  return zones;
}

export const formatCfa = (n) => `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} F`;

// One seller, data kept in a JSON file. Multi-seller storage comes with step 4.
export class Store {
  constructor({ file } = {}) {
    this.file = file ?? null;
    this.data = { products: [], leads: [], liveId: null, settings: { ...EMPTY_SETTINGS } };
    if (this.file && fs.existsSync(this.file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
      // Leads saved before carts existed had a single product.
      for (const l of this.data.leads) {
        l.items ??= l.product ? [{ productId: l.productId ?? null, name: l.product, variant: null, quantity: l.quantity ?? 1, unitPrice: l.unitPrice ?? null }] : [];
        l.code ??= `TT${Math.floor(1000 + Math.random() * 9000)}`;
      }
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // --- Shop settings (WhatsApp and payment numbers) -------------------------

  getSettings() {
    return { ...EMPTY_SETTINGS, ...this.data.settings };
  }

  updateSettings(input) {
    const settings = this.getSettings();
    for (const key of Object.keys(EMPTY_SETTINGS)) {
      if (!(key in input)) continue;
      const value = String(input[key] ?? "").trim().slice(0, key === "zones" ? 2000 : 80);
      if (key === "zones") parseZones(value);
      else if (key !== "shopName" && value && !/^\+?[\d\s.-]{8,20}$/.test(value)) throw new Error("Numéro de téléphone invalide.");
      settings[key] = value;
    }
    this.data.settings = settings;
    this.save();
    return settings;
  }

  deliveryZones() {
    return parseZones(this.getSettings().zones);
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

  // Quantity already promised to customers of the current live.
  reserved(productId) {
    let n = 0;
    for (const l of this.listLeads()) {
      if (l.status === "annule") continue;
      for (const item of l.items) if (item.productId === productId) n += item.quantity;
    }
    return n;
  }

  // The "Produits du jour" given to the AI, with what is left in stock.
  catalogForAi() {
    return this.data.products
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        nom: p.name,
        prix: p.price,
        ...(p.stock != null ? { stock_restant: Math.max(0, p.stock - this.reserved(p.id)) } : {}),
      }));
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

  // Short code the customer sends on WhatsApp so the seller finds the order.
  newCode() {
    const used = new Set(this.listLeads().map((l) => l.code));
    let code;
    do code = `TT${Math.floor(1000 + Math.random() * 9000)}`;
    while (used.has(code));
    return code;
  }

  // What the AI needs to know about these customers before reading their new comments.
  customersForAi(users) {
    return users.map((user) => {
      const lead = this.listLeads().find((l) => l.user === user);
      return {
        auteur: user,
        panier: (lead?.items ?? []).map((i) => ({ product_id: i.productId, produit: i.name, quantite: i.quantity, variante: i.variant })),
        commande_annulee: lead?.status === "annule",
        derniers_commentaires: (lead?.comments ?? []).slice(-5).map((c) => c.text),
      };
    });
  }

  // Turns the AI's cart into order lines with the seller's prices.
  toItems(cart) {
    const items = [];
    for (const line of cart) {
      const product = this.data.products.find((p) => p.id === line.product_id && p.active) ?? this.matchProduct(line.product);
      const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? Math.min(line.quantity, 999) : 1;
      const variant = line.variant?.trim() || null;
      const name = product?.name ?? String(line.product ?? "").trim().slice(0, 120);
      if (!name) continue;
      const same = items.find((i) => i.name === name && i.variant === variant);
      if (same) same.quantity += quantity;
      else items.push({ productId: product?.id ?? null, name, variant, quantity, unitPrice: product?.price ?? null });
    }
    return items;
  }

  // One lead per customer and live; each new buying comment updates it.
  recordIntent(comment, result) {
    const liveId = this.data.liveId;
    let lead = this.data.leads.find((l) => l.liveId === liveId && l.user === comment.user);
    if (!lead) {
      lead = {
        id: randomUUID(),
        liveId,
        code: this.newCode(),
        user: comment.user,
        nickname: comment.nickname ?? comment.user,
        intent: result.intent,
        items: [],
        total: null,
        phone: null,
        reply: null,
        status: "nouveau",
        comments: [],
        firstAt: comment.at ?? Date.now(),
      };
      this.data.leads.push(lead);
    }
    // A purchase outranks a question; never downgrade a lead that already wants to buy.
    if (["achat", "annulation"].includes(result.intent) || !["achat", "annulation"].includes(lead.intent)) lead.intent = result.intent;
    lead.comments.push({ text: comment.text, intent: result.intent, at: comment.at ?? Date.now() });
    lead.lastAt = comment.at ?? Date.now();
    if (result.phone) lead.phone = result.phone;
    lead.reply = result.reply?.trim() || null;

    if (result.cart) {
      lead.items = this.toItems(result.cart);
    } else if (result.intent === "achat") {
      // Keyword mode: no cart from the AI, so look for the product in the comment itself.
      const product = this.matchProduct(comment.text);
      if (product) {
        const quantity = guessQuantity(comment.text, product.name);
        const item = lead.items.find((i) => i.productId === product.id);
        if (item) item.quantity = quantity ?? item.quantity;
        else lead.items.push({ productId: product.id, name: product.name, variant: null, quantity: quantity ?? 1, unitPrice: product.price });
      }
    }

    if (result.intent === "annulation" && lead.status !== "paye") lead.status = "annule";
    else if (result.intent === "achat" && lead.status === "annule") lead.status = "nouveau";

    this.recalc(lead);
    this.save();
    return lead;
  }

  recalc(lead) {
    const priced = lead.items.filter((i) => i.unitPrice != null);
    lead.total = priced.length ? priced.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0) : null;
    lead.amountDue = lead.total != null ? lead.total + (lead.delivery?.fee ?? 0) : null;
  }

  // --- After the live: WhatsApp, payment and delivery ------------------------

  findLead(id) {
    return this.data.leads.find((l) => l.id === id) ?? null;
  }

  // The newest order with this code (codes are unique within one live).
  findLeadByCode(text) {
    const code = String(text ?? "").toUpperCase().match(/\bTT\s?-?(\d{4})\b/)?.[1];
    if (!code) return null;
    return this.data.leads.findLast((l) => l.code === `TT${code}`) ?? null;
  }

  // The newest open order of a WhatsApp number.
  findLeadByWhatsapp(waId) {
    const mine = this.data.leads.filter((l) => l.waId === waId);
    return mine.findLast((l) => !["livre", "annule"].includes(l.status)) ?? mine.at(-1) ?? null;
  }

  addChat(lead, from, text) {
    lead.chat ??= [];
    lead.chat.push({ from, text, at: Date.now() });
    lead.chat = lead.chat.slice(-100);
    this.save();
  }

  // Applies what the WhatsApp assistant understood from the customer's message.
  applyChatTurn(lead, turn) {
    if (turn.cart) lead.items = this.toItems(turn.cart);
    const d = turn.delivery ?? {};
    if (d.zone || d.address || d.slot) {
      lead.delivery ??= { zone: null, address: null, slot: null, fee: null };
      if (d.zone) {
        const zone = this.deliveryZones().find((z) => normalize(z.name) === normalize(d.zone));
        if (zone) Object.assign(lead.delivery, { zone: zone.name, fee: zone.fee });
      }
      if (d.address) lead.delivery.address = String(d.address).slice(0, 200);
      if (d.slot) lead.delivery.slot = String(d.slot).slice(0, 100);
    }
    if (turn.cancel && lead.status !== "paye" && lead.status !== "livre") lead.status = "annule";
    else if (lead.status === "nouveau") lead.status = "contacte";
    this.recalc(lead);
    this.save();
    return lead;
  }

  // A new identifier per payment request, so a changed order gets a new link.
  startPayment(lead, payments) {
    const n = (lead.payment?.n ?? 0) + 1;
    const identifier = `${lead.code}-${lead.id.slice(0, 8)}-${n}`;
    const url = payments.link({ identifier, amount: lead.amountDue, description: `Commande ${lead.code}` });
    lead.payment = { n, identifier, url, amount: lead.amountDue, at: Date.now() };
    this.save();
    return lead.payment;
  }

  markPaid(identifier) {
    const lead = this.data.leads.find((l) => l.payment?.identifier === identifier);
    if (!lead) return null;
    if (lead.status !== "livre") lead.status = "paye";
    lead.paidAt ??= Date.now();
    this.save();
    return lead;
  }

  // Paid orders to deliver, and the ones delivered recently.
  listDeliveries() {
    return this.data.leads.filter((l) => l.status === "paye" || l.status === "livre").sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0));
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
