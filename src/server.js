import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IntentClassifier, BUYING_INTENTS } from "./intent.js";
import { TikTokSource } from "./sources/tiktok.js";
import { DemoSource } from "./sources/demo.js";
import { Store, LEAD_STATUSES } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Phase 1: one live session per server, pushed to the browser over Server-Sent Events.
export function createApp({ apiKey, model, eulerApiKey, classifierClient, demoIntervalMs, store = new Store() } = {}) {
  const app = express();
  app.use(express.json());
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
    res.write(`event: hello\ndata: ${JSON.stringify({ ai: classifier.usesAi, live: Boolean(source), stats })}\n\n`);
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
      res.json({ ok: true });
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

  app.get("/api/leads", (req, res) => res.json({ leads: store.listLeads(), statuses: LEAD_STATUSES }));

  app.patch("/api/leads/:id", (req, res) => {
    try {
      const lead = store.updateLead(req.params.id, req.body ?? {});
      if (!lead) return res.status(404).json({ error: "Client introuvable." });
      refreshStats();
      broadcast("lead", lead);
      broadcast("stats", stats);
      res.json(lead);
    } catch (err) {
      fail(res, err);
    }
  });

  return app;
}
