// Payment links for Flooz and T-Money through PayGate Global (Togo).
// Without a PayGate token TackTack makes a demo link to its own /payer page.
export class Payments {
  constructor({ paygateToken, publicUrl = "http://localhost:3000", fetchImpl = fetch } = {}) {
    this.token = paygateToken;
    this.publicUrl = publicUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  get live() {
    return Boolean(this.token);
  }

  // identifier is unique per payment attempt; PayGate sends it back when the customer has paid.
  link({ identifier, amount, description }) {
    if (!this.live) return `${this.publicUrl}/payer/${encodeURIComponent(identifier)}`;
    const params = new URLSearchParams({
      token: this.token,
      amount: String(amount),
      description: description.slice(0, 100),
      identifier,
      url: `${this.publicUrl}/merci`,
    });
    return `https://paygateglobal.com/v1/page?${params}`;
  }

  // Asks PayGate whether a payment went through (status 0 = paid).
  async isPaid(identifier) {
    if (!this.live) return false;
    const res = await this.fetch("https://paygateglobal.com/api/v2/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth_token: this.token, identifier }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Number(data.status) === 0;
  }
}
