import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IntentClassifier, BUYING_INTENTS } from "./intent.js";
import { TikTokSource } from "./sources/tiktok.js";
import { DemoSource } from "./sources/demo.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Phase 1: one live session per server, pushed to the browser over Server-Sent Events.
export function createApp({ apiKey, model, eulerApiKey, classifierClient, demoIntervalMs } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(here, "..", "public")));

  const clients = new Set();
  const broadcast = (type, data) => {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const stats = { comments: 0, buyers: 0 };
  const classifier = new IntentClassifier({
    apiKey,
    model,
    client: classifierClient,
    onResult: (r) => {
      if (BUYING_INTENTS.has(r.intent)) stats.buyers += 1;
      broadcast("intent", r);
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
    const { mode, username, catalog } = req.body ?? {};
    if (mode !== "demo" && !username?.trim()) return res.status(400).json({ error: "Nom d'utilisateur TikTok manquant." });

    stopSource();
    stats.comments = 0;
    stats.buyers = 0;
    classifier.setCatalog(catalog);
    source = mode === "demo" ? new DemoSource({ intervalMs: demoIntervalMs }) : new TikTokSource(username, { eulerApiKey });
    source.on("comment", (c) => {
      stats.comments += 1;
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

  return app;
}
