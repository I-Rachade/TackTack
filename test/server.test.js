import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

test("demo live streams comments and buying intents to the browser", async () => {
  const server = createApp({ demoIntervalMs: 20 }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const ctrl = new AbortController();
  try {
    const events = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const res = await fetch(`${base}/api/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "demo" }),
    });
    assert.equal(res.status, 200);

    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: intent\ndata: {\"id\":\"demo-3\"")) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    assert.match(text, /event: comment\ndata: .*Je prends 2 pagnes wax/);
    assert.match(text, /"id":"demo-2","intent":"question_prix"/);
    assert.match(text, /"id":"demo-3","intent":"achat"/);

    await fetch(`${base}/api/live`, { method: "DELETE" });
  } finally {
    ctrl.abort();
    server.close();
  }
});

test("connecting to TikTok without a username is rejected", async () => {
  const server = createApp().listen(0);
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "tiktok", username: " " }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test("products feed the live and buyers become leads with a total", async () => {
  const server = createApp({ demoIntervalMs: 10 }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const json = (method, url, body) =>
    fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await json("POST", "/api/products", { name: "Sac rouge", price: 7500 })).status, 201);
    assert.equal((await json("POST", "/api/products", { name: "Sac", price: "abc" })).status, 400);

    await json("POST", "/api/live", { mode: "demo" });
    let leads = [];
    while (!leads.some((l) => l.user === "akpene")) {
      await new Promise((r) => setTimeout(r, 20));
      leads = (await (await fetch(`${base}/api/leads`)).json()).leads;
    }
    await fetch(`${base}/api/live`, { method: "DELETE" });

    assert.ok(leads.some((l) => l.user === "edem228" && l.intent === "achat"));
    assert.ok(!leads.some((l) => l.user === "afi_b"));
    const lead = leads.find((l) => l.user === "kossi.tg");
    const res = await json("PATCH", `/api/leads/${lead.id}`, { status: "contacte" });
    assert.equal((await res.json()).status, "contacte");
  } finally {
    server.close();
  }
});
