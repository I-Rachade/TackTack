import { createApp } from "./server.js";
import { Store } from "./store.js";
import { WhatsApp } from "./whatsapp.js";
import { Payments } from "./payments.js";

const port = Number(process.env.PORT) || 3000;
const app = createApp({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  eulerApiKey: process.env.EULER_API_KEY,
  store: new Store({ file: process.env.DATA_FILE || "data/tacktack.json" }),
  whatsapp: new WhatsApp({
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
  }),
  payments: new Payments({ paygateToken: process.env.PAYGATE_TOKEN, publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}` }),
});

app.listen(port, () => {
  console.log(`TackTack : http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY absente : détection par mots-clés.");
});
