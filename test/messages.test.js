import { test } from "node:test";
import assert from "node:assert/strict";
import { liveReply, whatsappMessage, waLink, waNumber } from "../public/messages.js";

const lead = {
  user: "edem228",
  nickname: "Edem",
  code: "TT4821",
  intent: "achat",
  items: [{ name: "Pagne wax", variant: "rouge", quantity: 2, unitPrice: 12000 }],
  total: 24000,
  reply: null,
};
const settings = { shopName: "Boutique Ama", whatsapp: "90 00 00 00", flooz: "99 11 11 11", tmoney: "" };

test("the live reply confirms the cart and gives the WhatsApp number and code", () => {
  assert.equal(liveReply(lead, settings), "@edem228 c'est noté ✅ 2 × Pagne wax (rouge) = 24 000 F. Écris TT4821 sur WhatsApp au 90 00 00 00 pour payer.");
  assert.equal(liveReply({ ...lead, reply: "@edem228 il reste 1 pagne" }, settings), "@edem228 il reste 1 pagne");
  assert.equal(liveReply({ ...lead, intent: "question_prix", items: [] }, settings), null);
});

test("the WhatsApp message lists the order and only the payment numbers that are set", () => {
  const text = whatsappMessage(lead, settings);
  assert.match(text, /Commande TT4821/);
  assert.match(text, /• 2 × Pagne wax \(rouge\) : 24 000 F/);
  assert.match(text, /Flooz : 99 11 11 11/);
  assert.doesNotMatch(text, /T-Money/);
});

test("Togo numbers become wa.me links", () => {
  assert.equal(waNumber("90 12 34 56"), "22890123456");
  assert.equal(waNumber("+228 90-12-34-56"), "22890123456");
  assert.equal(waNumber("0022890123456"), "22890123456");
  assert.equal(waNumber("123"), null);
  assert.equal(waLink("90123456", "Bonjour"), "https://wa.me/22890123456?text=Bonjour");
});
