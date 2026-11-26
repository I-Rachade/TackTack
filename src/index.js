import { createApp } from "./server.js";
import { Store } from "./store.js";
import { WhatsApp } from "./whatsapp.js";
import { Payments } from "./payments.js";

const port = Number(process.env.PORT) || 3000;

// Once TackTack is reachable from the internet, the dashboard must not be open to everyone.
if (process.env.PUBLIC_URL && !process.env.DASHBOARD_PASSWORD) {
  console.error("PUBLIC_URL est rempli mais DASHBOARD_PASSWORD est vide : ajoute un mot de passe dans .env avant de mettre TackTack en ligne.");
  process.exit(1);
}

const app = createApp({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  eulerApiKey: process.env.EULER_API_KEY,
  dashboardPassword: process.env.DASHBOARD_PASSWORD,
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
