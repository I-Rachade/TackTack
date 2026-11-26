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
