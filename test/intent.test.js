import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyByKeywords, IntentClassifier } from "../src/intent.js";

test("keyword rules recognise common French buying comments", () => {
  assert.equal(classifyByKeywords("Je prends 2 pagnes wax svp"), "achat");
  assert.equal(classifyByKeywords("moi je veux les chaussures taille 42"), "achat");
  assert.equal(classifyByKeywords("Réserve-moi le grand modèle stp"), "achat");
  assert.equal(classifyByKeywords("C'est combien le sac noir ?"), "question_prix");
  assert.equal(classifyByKeywords("On peut payer par Flooz ?"), "question_livraison");
  assert.equal(classifyByKeywords("Vous livrez à Agoè ?"), "question_livraison");
  assert.equal(classifyByKeywords("c'est dispo en bleu ?"), "question_produit");
  assert.equal(classifyByKeywords("Bonsoir tout le monde 👋"), "autre");
  assert.equal(classifyByKeywords("🔥🔥🔥"), "autre");
});

function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return reply(params); } } },
  };
}

test("comments are batched into one Claude request", async () => {
  const client = fakeClient((params) => {
    const ids = [...params.messages[0].content.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    const results = ids.map((id) => ({ id, intent: "achat", product: "Sac noir", quantity: 1 }));
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ results }) }] };
  });
  const out = [];
  const c = new IntentClassifier({ client, batchMs: 10_000, onResult: (r) => out.push(r) });
  c.setCatalog("Sac noir - 7 500 F");
  c.add({ id: "1", user: "a", text: "je prends le sac" });
  c.add({ id: "2", user: "b", text: "moi aussi" });
  await c.flush();

  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].messages[0].content, /Sac noir - 7 500 F/);
  assert.equal(client.calls[0].model, "claude-opus-5-5");
  assert.deepEqual(out.map((r) => [r.id, r.intent, r.by]), [["1", "achat", "IA"], ["2", "achat", "IA"]]);
});

test("falls back to keywords when the API fails", async () => {
  const client = fakeClient(() => { throw new Error("réseau"); });
  const out = [];
  const errors = [];
  const c = new IntentClassifier({ client, onResult: (r) => out.push(r), onError: (e) => errors.push(e) });
  c.add({ id: "1", user: "a", text: "c'est combien ?" });
  await c.flush();
  assert.equal(errors.length, 1);
  assert.deepEqual(out.map((r) => [r.intent, r.by]), [["question_prix", "mots-clés"]]);
});

test("without an API key comments are classified immediately by keywords", () => {
  const out = [];
  const c = new IntentClassifier({ onResult: (r) => out.push(r) });
  assert.equal(c.usesAi, false);
  c.add({ id: "1", user: "a", text: "je commande 1 sac rouge" });
  assert.equal(out[0].intent, "achat");
});
