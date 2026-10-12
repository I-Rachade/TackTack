import crypto from "node:crypto";

// WhatsApp Business Platform (Cloud API). Without a token, messages are only
// kept in TackTack and shown in the dashboard (demo mode).
export class WhatsApp {
  constructor({ token, phoneNumberId, verifyToken, appSecret, fetchImpl = fetch } = {}) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.verifyToken = verifyToken;
    this.appSecret = appSecret;
    this.fetch = fetchImpl;
  }

  get connected() {
    return Boolean(this.token && this.phoneNumberId);
  }

  async sendText(to, text) {
    if (!this.connected) return { sent: false };
    const res = await this.fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } }),
    });
    if (!res.ok) throw new Error(`WhatsApp a refusé le message (${res.status}) : ${await res.text()}`);
    return { sent: true };
  }

  // Meta checks the webhook URL once with a GET request.
  verify(query) {
    if (query["hub.mode"] === "subscribe" && this.verifyToken && query["hub.verify_token"] === this.verifyToken) return query["hub.challenge"];
    return null;
  }

  // Rejects webhook calls that were not signed by Meta, when the app secret is set.
  validSignature(rawBody, header) {
    if (!this.appSecret) return true;
    const expected = `sha256=${crypto.createHmac("sha256", this.appSecret).update(rawBody).digest("hex")}`;
    const given = Buffer.from(String(header ?? ""));
    return given.length === expected.length && crypto.timingSafeEqual(given, Buffer.from(expected));
  }

  // Text messages from customers in a webhook payload.
  static incoming(body) {
    const out = [];
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of change.value?.messages ?? []) {
          if (m.type !== "text") continue;
          out.push({ id: m.id, from: m.from, name: names.get(m.from) ?? null, text: m.text?.body ?? "" });
        }
      }
    }
    return out;
  }
}
