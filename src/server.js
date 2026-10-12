import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IntentClassifier, BUYING_INTENTS } from "./intent.js";
import { TikTokSource } from "./sources/tiktok.js";
import { DemoSource } from "./sources/demo.js";
import { Store, LEAD_STATUSES, formatCfa } from "./store.js";
import { SalesChat, scriptedTurn } from "./conversation.js";
import { WhatsApp } from "./whatsapp.js";
import { Payments } from "./payments.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Phase 1: one live session per server, pushed to the browser over Server-Sent Events.
export function createApp({
  apiKey,
  model,
  eulerApiKey,
  classifierClient,
  chatClient,
  demoIntervalMs,
  store = new Store(),
  whatsapp = new WhatsApp(),
  payments = new Payments(),
} = {}) {
  const app = express();
  // Keeps the raw body so WhatsApp webhook signatures can be checked.
  app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(here, "..", "public")));

  const clients = new Set();
  const broadcast = (type, data) => {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const stats = { comments: 0, buyers: 0, revenue: 0 };
  const refreshStats = () => {
    const leads = store.listLeads();
    stats.buyers = leads.length;
    stats.revenue = leads
      .filter((l) => l.intent === "achat" && l.status !== "annule" && l.total != null)
      .reduce((sum, l) => sum + l.total, 0);
  };
  refreshStats();

  const pending = new Map(); // comment id -> comment, until the AI has classified it
  const classifier = new IntentClassifier({
    apiKey,
    model,
    client: classifierClient,
    getCatalog: () => store.catalogForAi(),
    getCustomers: (users) => store.customersForAi(users),
    onResult: (r) => {
      const comment = pending.get(r.id);
      pending.delete(r.id);
      broadcast("intent", r);
      if (comment && BUYING_INTENTS.has(r.intent)) {
        broadcast("lead", store.recordIntent(comment, r));
        refreshStats();
      }
      broadcast("stats", stats);
    },
    onError: (err) => broadcast("status", { state: "warning", message: `IA indisponible, détection par mots-clés : ${err.message}` }),
  });

  let source = null;
  const stopSource = () => {
    source?.stop();
    source?.removeAllListeners();
    source = null;
  };

  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    const hello = { ai: classifier.usesAi, live: Boolean(source), stats, whatsapp: whatsapp.connected, payments: payments.live };
    res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  app.post("/api/live", async (req, res) => {
    const { mode, username } = req.body ?? {};
    if (mode !== "demo" && !username?.trim()) return res.status(400).json({ error: "Nom d'utilisateur TikTok manquant." });

    stopSource();
    pending.clear();
    classifier.reset();
    store.startLive();
    stats.comments = 0;
    refreshStats();
    source = mode === "demo" ? new DemoSource({ intervalMs: demoIntervalMs }) : new TikTokSource(username, { eulerApiKey });
    source.on("comment", (c) => {
      stats.comments += 1;
      pending.set(c.id, c);
      broadcast("comment", c);
      classifier.add(c);
    });
    source.on("viewers", (n) => broadcast("viewers", n));
    source.on("status", (s) => broadcast("status", s));

    try {
      await source.start();
      res.json({ ok: true, liveId: store.data.liveId });
    } catch (err) {
      stopSource();
      const offline = err?.constructor?.name === "UserOfflineError";
      const message = offline ? `@${username.replace(/^@/, "")} n'est pas en live en ce moment.` : `Connexion impossible : ${err.message}`;
      broadcast("status", { state: "error", message });
      res.status(502).json({ error: message });
    }
  });

  app.delete("/api/live", (req, res) => {
    stopSource();
    broadcast("status", { state: "stopped", message: "Live arrêté." });
    res.json({ ok: true });
  });

  // --- Shop settings ------------------------------------------------------

  app.get("/api/settings", (req, res) => res.json(store.getSettings()));

  app.put("/api/settings", (req, res) => {
    try {
      res.json(store.updateSettings(req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Products (prepared before the live) ---------------------------------

  const fail = (res, err) => res.status(400).json({ error: err.message });

  app.get("/api/products", (req, res) => res.json(store.listProducts()));

  app.post("/api/products", (req, res) => {
    try {
      const product = store.addProduct(req.body ?? {});
      res.status(201).json(product);
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch("/api/products/:id", (req, res) => {
    try {
      const product = store.updateProduct(req.params.id, req.body ?? {});
      if (!product) return res.status(404).json({ error: "Produit introuvable." });
      res.json(product);
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete("/api/products/:id", (req, res) => {
    if (!store.deleteProduct(req.params.id)) return res.status(404).json({ error: "Produit introuvable." });
    res.json({ ok: true });
  });

  // --- Leads (interested customers of the current or last live) -------------

  app.get("/api/leads", (req, res) => res.json({ leads: store.listLeads(), statuses: LEAD_STATUSES, liveId: store.data.liveId }));

  app.patch("/api/leads/:id", (req, res) => {
    try {
      const lead = store.updateLead(req.params.id, req.body ?? {});
      if (!lead) return res.status(404).json({ error: "Client introuvable." });
      refreshStats();
      broadcast("lead", lead);
      broadcast("delivery", lead);
      broadcast("stats", stats);
      res.json(lead);
    } catch (err) {
      fail(res, err);
    }
  });

  // --- WhatsApp: the assistant finishes the sale -----------------------------

  const chat = new SalesChat({ apiKey, model, client: chatClient });
  const warn = (message) => broadcast("status", { state: "warning", message });

  async function sendToCustomer(lead, text) {
    store.addChat(lead, "assistant", text);
    broadcast("lead", lead);
    if (!lead.waId || lead.waId.startsWith("demo")) return;
    try {
      await whatsapp.sendText(lead.waId, text);
    } catch (err) {
      warn(`Message WhatsApp non envoyé à @${lead.user} : ${err.message}`);
    }
  }

  const paymentText = (lead) => {
    const fee = lead.delivery?.fee ? ` (articles ${formatCfa(lead.total)} + livraison ${formatCfa(lead.delivery.fee)})` : "";
    return `💳 Total : ${formatCfa(lead.amountDue)}${fee}.\nPaie ici avec Flooz ou T-Money : ${lead.payment.url}`;
  };

  // A customer message: found by the order code, then by their WhatsApp number.
  async function onCustomerMessage({ from, name, text, lead }) {
    lead ??= store.findLeadByCode(text) ?? store.findLeadByWhatsapp(from);
    if (!lead) {
      if (!from.startsWith("demo")) {
        await whatsapp.sendText(from, "Bonjour 👋 Envoie-moi le code de ta commande (par exemple TT1234), il a été donné pendant le live.").catch((err) => warn(err.message));
      }
      return null;
    }
    if (lead.waId !== from) {
      lead.waId = from;
      if (!from.startsWith("demo")) lead.phone ??= from;
      if (name) lead.waName = name;
    }
    store.addChat(lead, "client", text);
    broadcast("lead", lead);

    const zones = store.deliveryZones();
    let turn;
    try {
      turn = await chat.turn({ lead, text, catalog: store.catalogForAi(), zones, settings: store.getSettings() });
    } catch (err) {
      warn(`IA WhatsApp indisponible, réponse simple : ${err.message}`);
      turn = scriptedTurn(lead, text, zones);
    }
    store.applyChatTurn(lead, turn);

    let reply = turn.reply;
    const open = !["paye", "livre", "annule"].includes(lead.status);
    const deliveryKnown = zones.length === 0 || lead.delivery?.zone;
    if (turn.ready_for_payment && open && lead.items.length && lead.amountDue && deliveryKnown) {
      if (lead.payment?.amount !== lead.amountDue) store.startPayment(lead, payments);
      reply = `${reply}\n\n${paymentText(lead)}`;
    }
    await sendToCustomer(lead, reply);
    refreshStats();
    broadcast("stats", stats);
    return lead;
  }

  async function onPaid(identifier) {
    const lead = store.markPaid(identifier);
    if (!lead) return null;
    const where = lead.delivery?.zone ? ` à ${lead.delivery.zone}${lead.delivery.slot ? `, ${lead.delivery.slot}` : ""}` : "";
    await sendToCustomer(lead, `Paiement reçu ✅ Merci ${lead.waName ?? lead.nickname} ! Ta commande ${lead.code} sera livrée${where}. On t'appelle avant de passer 🛵`);
    broadcast("delivery", lead);
    return lead;
  }

  app.get("/webhook/whatsapp", (req, res) => {
    const challenge = whatsapp.verify(req.query);
    if (challenge == null) return res.sendStatus(403);
    res.send(challenge);
  });

  app.post("/webhook/whatsapp", (req, res) => {
    if (!whatsapp.validSignature(req.rawBody ?? Buffer.alloc(0), req.get("x-hub-signature-256"))) return res.sendStatus(401);
    res.sendStatus(200);
    for (const m of WhatsApp.incoming(req.body)) onCustomerMessage(m).catch((err) => warn(err.message));
  });

  // Dashboard: write as the customer to try the WhatsApp assistant without WhatsApp.
  app.post("/api/leads/:id/simulate", async (req, res) => {
    const lead = store.findLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Client introuvable." });
    const text = String(req.body?.text ?? "").trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: "Message vide." });
    res.json(await onCustomerMessage({ from: lead.waId ?? `demo-${lead.user}`, text, lead }));
  });

  // PayGate calls this once a payment is done; the status is checked with PayGate before trusting it.
  app.post("/api/payments/paygate", async (req, res) => {
    const identifier = String(req.body?.identifier ?? "");
    res.sendStatus(200);
    if (identifier && (await payments.isPaid(identifier).catch(() => false))) await onPaid(identifier);
  });

  // Demo payment page, only without a PayGate account.
  const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/style.css"><main><section class="card">${body}</section></main>`;
  const escape = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  app.get("/payer/:identifier", (req, res) => {
    const lead = store.data.leads.find((l) => l.payment?.identifier === req.params.identifier);
    if (payments.live || !lead) return res.status(404).send(page("Introuvable", "<h2>Lien de paiement introuvable.</h2>"));
    res.send(
      page(
        "Paiement",
        `<h2>Commande ${escape(lead.code)}</h2><p class="order">${formatCfa(lead.payment.amount)}</p>` +
          `<p class="hint">Page de démonstration : avec un compte PayGate Global, le client paie ici par Flooz ou T-Money.</p>` +
          `<form method="post"><button>Payer (démo)</button></form>`,
      ),
    );
  });

  app.post("/payer/:identifier", async (req, res) => {
    if (payments.live) return res.sendStatus(404);
    await onPaid(req.params.identifier);
    res.redirect("/merci");
  });

  app.get("/merci", (req, res) => res.send(page("Merci", "<h2>Merci ! ✅</h2><p>Ton paiement est en cours de confirmation. Tu reçois un message sur WhatsApp.</p>")));

  app.get("/api/deliveries", (req, res) => res.json(store.listDeliveries()));

  return app;
}
