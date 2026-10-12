import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyByKeywords, findPhone, IntentClassifier } from "../src/intent.js";

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
  assert.equal(classifyByKeywords("finalement non, annule"), "annulation");
});

test("phone numbers written in comments are found", () => {
  assert.equal(findPhone("mon numéro 90 12 34 56 svp"), "90 12 34 56");
  assert.equal(findPhone("+228 91234567"), "+228 91234567");
  assert.equal(findPhone("je prends 2 pagnes taille 42 à 12000"), null);
});

function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return reply(params); } } },
  };
}

test("comments are batched into one Claude request with catalog, carts and recent comments", async () => {
  const client = fakeClient((params) => {
    const content = params.messages[0].content;
    const toAnalyze = content.slice(content.indexOf("Commentaires à analyser"));
    const ids = [...toAnalyze.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    const results = ids.map((id) => ({
      id,
      intent: "achat",
      cart_changed: id !== "3",
      cart: id !== "3" ? [{ product_id: "p1", product: "Sac noir", quantity: 1, variant: null }] : [],
      phone: null,
      reply: null,
    }));
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ results }) }] };
  });
  const out = [];
  const c = new IntentClassifier({
    client,
    batchMs: 10_000,
    getCatalog: () => [{ id: "p1", nom: "Sac noir", prix: 7500 }],
    getCustomers: (users) => users.map((u) => ({ auteur: u, panier: [] })),
    onResult: (r) => out.push(r),
  });
  c.add({ id: "1", user: "a", text: "je prends le sac" });
  c.add({ id: "2", user: "b", text: "moi aussi" });
  await c.flush();
  c.add({ id: "3", user: "a", text: "merci" });
  await c.flush();

  assert.equal(client.calls.length, 2);
  const first = client.calls[0].messages[0].content;
  assert.match(first, /"nom":"Sac noir","prix":7500/);
  assert.match(first, /"auteur":"a","panier":\[\]/);
  assert.equal(client.calls[0].model, "claude-opus-5-5");
  // The second batch sees the first batch's comments as context.
  assert.match(client.calls[1].messages[0].content, /récents[^]*"texte":"je prends le sac"[^]*à analyser/);
  assert.deepEqual(out.map((r) => [r.id, r.by, r.cart?.length]), [["1", "IA", 1], ["2", "IA", 1], ["3", "IA", undefined]]);
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
