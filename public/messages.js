// Texts the seller sends to a customer: shared by the browser and the tests.

export const cfa = (n) => `${Math.round(n).toLocaleString("fr-FR").replace(/\s/g, " ")} F`;

// "90 12 34 56", "+228 90123456" or "0022890123456" -> "22890123456" for wa.me links.
export function waNumber(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `228${digits}`;
  return digits.length >= 10 ? digits : null;
}

export function waLink(phone, text) {
  const number = waNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

const itemLabel = (i) => `${i.quantity} × ${i.name}${i.variant ? ` (${i.variant})` : ""}`;

// What the seller says or writes in the live. The AI's own answer wins when it has one.
export function liveReply(lead, settings = {}) {
  if (lead.reply) return lead.reply;
  if (lead.intent !== "achat" || lead.items.length === 0) return null;
  const total = lead.total != null ? ` = ${cfa(lead.total)}` : "";
  const next = settings.whatsapp
    ? `Écris ${lead.code} sur WhatsApp au ${settings.whatsapp} pour payer.`
    : `Envoie-moi ${lead.code} sur WhatsApp pour payer.`;
  return `@${lead.user} c'est noté ✅ ${lead.items.map(itemLabel).join(", ")}${total}. ${next}`;
}

// The order summary with payment instructions, sent on WhatsApp.
export function whatsappMessage(lead, settings = {}) {
  const lines = [`Bonjour ${lead.nickname || lead.user} 👋`, `Merci pour ta commande sur le live TikTok${settings.shopName ? ` de ${settings.shopName}` : ""} !`, ""];
  lines.push(`Commande ${lead.code} :`);
  for (const i of lead.items) lines.push(`• ${itemLabel(i)}${i.unitPrice != null ? ` : ${cfa(i.unitPrice * i.quantity)}` : ""}`);
  if (lead.total != null) lines.push(`Total : ${cfa(lead.total)}`);
  const pay = [settings.flooz && `Flooz : ${settings.flooz}`, settings.tmoney && `T-Money : ${settings.tmoney}`].filter(Boolean);
  if (pay.length) {
    lines.push("", "Paiement :", ...pay.map((p) => `• ${p}`), `Mets ${lead.code} dans le motif du paiement.`);
  }
  lines.push("", "Envoie-moi aussi ton quartier pour la livraison 📍");
  return lines.join("\n");
}
