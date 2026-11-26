import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

test("with a password, the dashboard and its API need it", async () => {
  const server = createApp({ dashboardPassword: "pagne:wax" }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const open = await fetch(`${base}/`);
    assert.equal(open.status, 401);
    assert.match(open.headers.get("www-authenticate"), /^Basic realm="TackTack"/);

    assert.equal((await fetch(`${base}/api/products`)).status, 401);
    assert.equal((await fetch(`${base}/api/products`, { headers: { Authorization: basic("x", "faux") } })).status, 401);
    assert.equal((await fetch(`${base}/api/products`, { headers: { Authorization: "Bearer pagne:wax" } })).status, 401);

    const ok = await fetch(`${base}/api/products`, { headers: { Authorization: basic("vendeuse", "pagne:wax") } });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${base}/`, { headers: { Authorization: basic("", "pagne:wax") } })).status, 200);
  } finally {
    server.close();
  }
});

test("customers, Meta and PayGate still reach their pages without the password", async () => {
  const server = createApp({ dashboardPassword: "secret" }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/merci`)).status, 200);
    assert.equal((await fetch(`${base}/style.css`)).status, 200);
    // Unknown payment: the page answers itself (404), not the password check (401).
    assert.equal((await fetch(`${base}/payer/inconnu`)).status, 404);
    // Without a verify token the webhook check fails with 403, not 401.
    assert.equal((await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe`)).status, 403);
    const paygate = await fetch(`${base}/api/payments/paygate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "x" }),
    });
    assert.equal(paygate.status, 200);
  } finally {
    server.close();
  }
});

test("without a password the dashboard stays open (local use)", async () => {
  const server = createApp().listen(0);
  try {
    assert.equal((await fetch(`http://localhost:${server.address().port}/api/products`)).status, 200);
  } finally {
    server.close();
  }
});
