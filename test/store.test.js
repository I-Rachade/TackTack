import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";

test("products are validated, saved to disk and turned into the AI catalog", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tacktack-")), "data.json");
  const store = new Store({ file });
  store.addProduct({ name: "Pagne wax 6 yards", price: 12000, stock: 5 });
  const sac = store.addProduct({ name: "Sac noir", price: 7500 });
  assert.throws(() => store.addProduct({ name: "", price: 100 }), /nom/);
  assert.throws(() => store.addProduct({ name: "Savon", price: -1 }), /prix/);

  store.updateProduct(sac.id, { active: false });
  assert.equal(store.catalogText(), "Pagne wax 6 yards - 12 000 F (stock : 5)");

  const reloaded = new Store({ file });
  assert.equal(reloaded.listProducts().length, 2);
});

test("AI product names are matched to the seller's products", () => {
  const store = new Store();
  store.addProduct({ name: "Pagne wax 6 yards", price: 12000 });
  store.addProduct({ name: "Sac noir", price: 7500 });
  store.addProduct({ name: "Savon karité", price: 500 });
  assert.equal(store.matchProduct("pagnes wax")?.name, "Pagne wax 6 yards");
  assert.equal(store.matchProduct("le sac noir")?.name, "Sac noir");
  assert.equal(store.matchProduct("savons")?.name, "Savon karité");
  assert.equal(store.matchProduct("chaussures"), null);
});

test("one lead per customer, with price and total from the product list", () => {
  const store = new Store();
  store.addProduct({ name: "Pagne wax 6 yards", price: 12000 });
  store.startLive();
  const c = (text) => ({ id: text, user: "edem228", text, at: 1 });

  store.recordIntent(c("c'est combien le pagne ?"), { intent: "question_prix", product: "pagne", quantity: null });
  const lead = store.recordIntent(c("je prends 2 pagnes"), { intent: "achat", product: "pagnes wax", quantity: 2 });
  store.recordIntent(c("livraison à Bè ?"), { intent: "question_livraison", product: null, quantity: null });

  assert.equal(store.listLeads().length, 1);
  assert.equal(lead.intent, "achat");
  assert.equal(lead.product, "Pagne wax 6 yards");
  assert.equal(lead.total, 24000);
  assert.equal(lead.comments.length, 3);

  store.updateLead(lead.id, { status: "paye" });
  assert.equal(store.listLeads()[0].status, "paye");
  assert.throws(() => store.updateLead(lead.id, { status: "x" }));

  store.startLive();
  assert.equal(store.listLeads().length, 0);
});

test("in keyword mode the product is found in the comment text", () => {
  const store = new Store();
  store.addProduct({ name: "Sac rouge", price: 7500 });
  store.startLive();
  const lead = store.recordIntent({ id: "1", user: "akpene", text: "je commande 1 sac rouge" }, { intent: "achat", product: null, quantity: null });
  assert.equal(lead.product, "Sac rouge");
  assert.equal(lead.total, 7500);
});

test("in keyword mode the quantity is read before the product name", () => {
  const store = new Store();
  store.addProduct({ name: "Pagne wax 6 yards", price: 12000 });
  store.addProduct({ name: "Chaussures", price: 9000 });
  store.startLive();
  const kw = { intent: "achat", product: null, quantity: null };
  assert.equal(store.recordIntent({ id: "1", user: "a", text: "Je prends 2 pagnes wax svp" }, kw).total, 24000);
  assert.equal(store.recordIntent({ id: "2", user: "b", text: "moi je veux les chaussures taille 42" }, kw).total, 9000);
});
