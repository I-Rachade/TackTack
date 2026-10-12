import { EventEmitter } from "node:events";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";

// Reads the comments of a running TikTok Live by the seller's username.
// TikTok has no official API for this; tiktok-live-connector is an unofficial client.
export class TikTokSource extends EventEmitter {
  constructor(username, { eulerApiKey } = {}) {
    super();
    this.username = username.replace(/^@/, "").trim();
    this.connection = new TikTokLiveConnection(this.username, {
      signApiKey: eulerApiKey || undefined,
    });
  }

  async start() {
    const c = this.connection;
    c.on(WebcastEvent.CHAT, (data) => {
      // Field names differ between proto versions (content/displayId vs comment/uniqueId).
      const user = data.user?.displayId || data.user?.uniqueId || "inconnu";
      this.emit("comment", {
        id: String(data.common?.msgId || `${Date.now()}-${Math.random()}`),
        user,
        nickname: data.user?.nickname || user,
        text: data.content ?? data.comment ?? "",
        at: Date.now(),
      });
    });
    c.on(WebcastEvent.ROOM_USER, (data) => {
      const viewers = Number(data.viewerCount ?? data.total);
      if (Number.isFinite(viewers)) this.emit("viewers", viewers);
    });
    c.on(WebcastEvent.STREAM_END, () => this.emit("status", { state: "ended", message: "Le live est terminé." }));
    c.on(ControlEvent.DISCONNECTED, () => this.emit("status", { state: "disconnected", message: "Déconnecté du live." }));

    const state = await c.connect();
    this.emit("status", { state: "connected", message: `Connecté au live de @${this.username}.`, roomId: state.roomId });
  }

  stop() {
    try {
      this.connection.disconnect();
    } catch {
      // already disconnected
    }
  }
}
