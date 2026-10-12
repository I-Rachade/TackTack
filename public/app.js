const $ = (id) => document.getElementById(id);

const LABELS = {
  achat: "Veut acheter",
  question_prix: "Demande le prix",
  question_produit: "Question produit",
  question_livraison: "Livraison / paiement",
};

const comments = new Map(); // id -> { comment, li }

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

function setLive(on) {
  $("connect").hidden = on;
  $("demo").hidden = on;
  $("stop").hidden = !on;
}

function line(c, intent) {
  const li = document.createElement("li");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = `@${c.user}`;
  const tag = document.createElement("span");
  tag.className = `tag ${intent ?? "pending"}`;
  tag.textContent = intent ? LABELS[intent] ?? "" : "analyse…";
  const text = document.createElement("div");
  text.textContent = c.text;
  li.append(who, tag, text);
  return li;
}

const events = new EventSource("/api/events");
events.addEventListener("hello", (e) => {
  const { ai, live } = JSON.parse(e.data);
  $("ai-badge").textContent = ai ? "IA active" : "Mots-clés (sans IA)";
  setLive(live);
});
events.addEventListener("status", (e) => {
  const s = JSON.parse(e.data);
  setStatus(s.message, s.state === "error");
  if (["ended", "disconnected", "stopped", "error"].includes(s.state)) setLive(false);
});
events.addEventListener("viewers", (e) => ($("viewers").textContent = JSON.parse(e.data)));
events.addEventListener("stats", (e) => {
  const s = JSON.parse(e.data);
  $("count").textContent = s.comments;
  $("buyers").textContent = s.buyers;
});
events.addEventListener("comment", (e) => {
  const c = JSON.parse(e.data);
  const li = line(c);
  comments.set(c.id, { comment: c, li });
  $("comment-list").prepend(li);
  $("count").textContent = comments.size;
});
events.addEventListener("intent", (e) => {
  const r = JSON.parse(e.data);
  const entry = comments.get(r.id);
  if (!entry) return;
  const tag = entry.li.querySelector(".tag");
  if (r.intent === "autre") {
    tag.remove();
    return;
  }
  tag.className = `tag ${r.intent}`;
  tag.textContent = LABELS[r.intent];

  const buyer = line(entry.comment, r.intent);
  const parts = [r.product, r.quantity ? `× ${r.quantity}` : null].filter(Boolean);
  if (parts.length) {
    const d = document.createElement("div");
    d.className = "detail";
    d.textContent = parts.join(" ");
    buyer.append(d);
  }
  $("buyer-list").prepend(buyer);
  $("buyer-empty").hidden = true;
});

function reset() {
  comments.clear();
  $("comment-list").replaceChildren();
  $("buyer-list").replaceChildren();
  $("buyer-empty").hidden = false;
  $("count").textContent = "0";
  $("buyers").textContent = "0";
  $("viewers").textContent = "–";
}

async function start(mode) {
  reset();
  setStatus("Connexion…");
  $("connect").disabled = $("demo").disabled = true;
  try {
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, username: $("username").value, catalog: $("catalog").value }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    setLive(true);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $("connect").disabled = $("demo").disabled = false;
  }
}

$("live-form").addEventListener("submit", (e) => {
  e.preventDefault();
  start("tiktok");
});
$("demo").addEventListener("click", () => start("demo"));
$("stop").addEventListener("click", async () => {
  await fetch("/api/live", { method: "DELETE" });
  setLive(false);
});
