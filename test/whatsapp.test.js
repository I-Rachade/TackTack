import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/server.js";
import { Store, parseZones } from "../src/store.js";
import { WhatsApp } from "../src/whatsapp.js";
import { SalesChat } from "../src/conversation.js";

function setup({ whatsapp, chatClient } = {}) {
  const store = new Store();
  store.addProduct({ name: "Pagne wax", price: 12000 });
  store.updateSettings({ zones: "Bè = 1000\nAgoè = 1500" });
  store.startLive();
  const lead = store.recordIntent({ id: "1", user: "edem228", nickname: "Edem", text: "je prends 2 pagnes wax" }, { intent: "achat" });
  const server = createApp({ store, whatsapp, chatClient }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const post = (url, body, headers = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual" });
  return { store, lead, server, base, post };
}

test("delivery zones are read line by line", () => {
  assert.deepEqual(parseZones("Bè = 1000\n\nAgoè: 1 500 F"), [{ name: "Bè", fee: 1000 }, { name: "Agoè", fee: 1500 }]);
  assert.throws(() => parseZones("Bè"), /Zone de livraison invalide/);
});

test("without AI the assistant asks for the neighbourhood, sends a payment link, and payment moves the order to deliveries", async () => {
  const { store, lead, server, base, post } = setup();
  try {
    let res = await post(`/api/leads/${lead.id}/simulate`, { text: `Bonjour, ${lead.code}` });
    let out = await res.json();
    assert.match(out.chat.at(-1).text, /2 × Pagne wax = 24 000 F\. Dans quel quartier.*Bè, Agoè/);
    assert.equal(out.status, "contacte");

    out = await (await post(`/api/leads/${lead.id}/simulate`, { text: "à Bè, près du marché" })).json();
    assert.equal(out.delivery.zone, "Bè");
    assert.equal(out.amountDue, 25000);
    assert.match(out.chat.at(-1).text, /Total : 25 000 F \(articles 24 000 F \+ livraison 1 000 F\)/);
    assert.match(out.payment.url, new RegExp(`/payer/${out.payment.identifier}$`));

    assert.equal((await fetch(`${base}/payer/${out.payment.identifier}`)).status, 200);
    res = await post(`/payer/${out.payment.identifier}`, {});
    assert.equal(res.status, 302);
    const paid = store.findLead(lead.id);
    assert.equal(paid.status, "paye");
    assert.match(paid.chat.at(-1).text, /Paiement reçu ✅.*livrée à Bè/);
    const deliveries = await (await fetch(`${base}/api/deliveries`)).json();
    assert.deepEqual(deliveries.map((d) => d.code), [lead.code]);
  } finally {
    server.close();
  }
});

test("WhatsApp webhook: verification, signature, finding the order by code and answering with Claude", async () => {
  const sent = [];
  const whatsapp = new WhatsApp({
    token: "t",
    phoneNumberId: "123",
    verifyToken: "secret-verify",
    appSecret: "app-secret",
    fetchImpl: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return { ok: true };
    },
  });
  const calls = [];
  const chatClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const reply = {
            reply: "Super Edem ! On livre à Agoè ce soir 👍",
            cart_changed: false,
            cart: [],
            delivery: { zone: "Agoè", address: "carrefour Agoè", slot: "ce soir" },
            ready_for_payment: true,
            cancel: false,
          };
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] };
        },
      },
    },
  };
  const { store, lead, server, base, post } = setup({ whatsapp, chatClient });
  try {
    assert.equal(await (await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=secret-verify&hub.challenge=42`)).text(), "42");
    assert.equal((await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`)).status, 403);

    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "22890123456", profile: { name: "Edem K." } }],
        messages: [{ id: "m1", from: "22890123456", type: "text", text: { body: `${lead.code.toLowerCase()} livre-moi à Agoè ce soir` } }],
      } }] }],
    };
    const raw = JSON.stringify(payload);
    assert.equal((await post("/webhook/whatsapp", payload, { "X-Hub-Signature-256": "sha256=bad" })).status, 401);
    const sig = `sha256=${crypto.createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    assert.equal((await post("/webhook/whatsapp", payload, { "X-Hub-Signature-256": sig })).status, 200);

    while (sent.length === 0) await new Promise((r) => setTimeout(r, 10));
    const l = store.findLead(lead.id);
    assert.equal(l.waId, "22890123456");
    assert.equal(l.waName, "Edem K.");
    assert.deepEqual(l.delivery, { zone: "Agoè", address: "carrefour Agoè", slot: "ce soir", fee: 1500 });
    assert.match(calls[0].messages[0].content, /"zone":"Agoè","frais":1500/);
    assert.match(calls[0].messages[0].content, /"code":"TT\d{4}"/);
    assert.equal(sent[0].url, "https://graph.facebook.com/v21.0/123/messages");
    assert.equal(sent[0].body.to, "22890123456");
    assert.match(sent[0].body.text.body, /^Super Edem[^]*Total : 25 500 F[^]*\/payer\//);
  } finally {
    server.close();
  }
});

test("the WhatsApp assistant can change the cart", async () => {
  const store = new Store();
  const savon = store.addProduct({ name: "Savon karité", price: 500 });
  store.startLive();
  const lead = store.recordIntent({ id: "1", user: "a", text: "x" }, { intent: "achat", cart: [] });
  const client = {
    beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
      reply: "Ajouté !", cart_changed: true, cart: [{ product_id: savon.id, product: "savon", quantity: 3, variant: null }],
      delivery: { zone: null, address: null, slot: null }, ready_for_payment: false, cancel: false,
    }) }] }) } },
  };
  const turn = await new SalesChat({ client }).turn({ lead, text: "ajoute 3 savons", catalog: store.catalogForAi(), zones: [], settings: {} });
  store.applyChatTurn(lead, turn);
  assert.equal(lead.total, 1500);
  assert.equal(lead.status, "contacte");
});
