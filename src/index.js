import { createApp } from "./server.js";

const port = Number(process.env.PORT) || 3000;
const app = createApp({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  eulerApiKey: process.env.EULER_API_KEY,
});

app.listen(port, () => {
  console.log(`TackTack : http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY absente : détection par mots-clés.");
});
