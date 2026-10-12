import { cfa, liveReply, whatsappMessage, waLink } from "./messages.js";

const $ = (id) => document.getElementById(id);

const LABELS = {
  achat: "Veut acheter",
  question_prix: "Demande le prix",
  question_produit: "Question produit",
  question_livraison: "Livraison / paiement",
  annulation: "Annule",
};

const STATUS_LABELS = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  paye: "Payé",
  livre: "Livré",
  annule: "Annulé",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Erreur");
  return data;
}

// --- Tabs -----------------------------------------------------------------

const TABS = ["live", "products", "deliveries"];

function showTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const t of TABS) $(`tab-${t}`).hidden = name !== t;
  if (name === "deliveries") loadDeliveries();
  try {
    localStorage.setItem("tab", name);
  } catch {
    // storage unavailable
  }
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => showTab(t.dataset.tab));
let initialTab = "live";
try {
  const saved = localStorage.getItem("tab");
  if (TABS.includes(saved)) initialTab = saved;
} catch {
  // storage unavailable
}
showTab(initialTab);

// --- Products -------------------------------------------------------------

let products = [];

function renderCatalogSummary() {
  const active = products.filter((p) => p.active);
  const box = $("catalog-summary");
  box.replaceChildren();
  box.append(
    active.length
      ? `${active.length} produit${active.length > 1 ? "s" : ""} en vente aujourd'hui. `
      : "Aucun produit en vente : l'IA devinera les articles à partir des commentaires. ",
  );
  const link = el("a", null, active.length ? "Modifier" : "Ajouter mes produits");
  link.href = "#";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showTab("products");
  });
  box.append(link);
}

function renderProducts() {
  const list = $("product-list");
  list.replaceChildren();
  $("product-empty").hidden = products.length > 0;
  for (const p of products) {
    const li = el("li", p.active ? "" : "inactive");
    const toggle = el("label", "switch");
    const box = el("input");
    box.type = "checkbox";
    box.checked = p.active;
    box.title = "En vente aujourd'hui";
    box.addEventListener("change", () => saveProduct(p.id, { active: box.checked }));
    toggle.append(box);

    const info = el("div", "info");
    info.append(el("div", "name", p.name));
    info.append(el("div", "detail", [cfa(p.price), p.stock != null ? `stock : ${p.stock}` : null].filter(Boolean).join(" · ")));

    const actions = el("div", "actions");
    const edit = el("button", "secondary small", "Modifier");
    edit.type = "button";
    edit.addEventListener("click", () => editProduct(p));
    const del = el("button", "secondary small", "Supprimer");
    del.type = "button";
    del.addEventListener("click", async () => {
      if (!confirm(`Supprimer « ${p.name} » ?`)) return;
      await api("DELETE", `/api/products/${p.id}`);
      await loadProducts();
    });
    actions.append(edit, del);
    li.append(toggle, info, actions);
    list.append(li);
  }
  renderCatalogSummary();
}

async function loadProducts() {
  products = await api("GET", "/api/products");
  renderProducts();
}

async function saveProduct(id, body) {
  try {
    await api(id ? "PATCH" : "POST", id ? `/api/products/${id}` : "/api/products", body);
    $("product-error").textContent = "";
    await loadProducts();
    return true;
  } catch (err) {
    $("product-error").textContent = err.message;
    return false;
  }
}

function resetProductForm() {
  $("product-form").reset();
  $("product-id").value = "";
  $("product-form-title").textContent = "Ajouter un produit";
  $("product-save").textContent = "Ajouter";
  $("product-cancel").hidden = true;
}

function editProduct(p) {
  $("product-id").value = p.id;
  $("product-name").value = p.name;
  $("product-price").value = p.price;
  $("product-stock").value = p.stock ?? "";
  $("product-form-title").textContent = "Modifier le produit";
  $("product-save").textContent = "Enregistrer";
  $("product-cancel").hidden = false;
  $("product-name").focus();
}

$("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("product-id").value;
  const stock = $("product-stock").value;
  const ok = await saveProduct(id, {
    name: $("product-name").value,
    price: Number($("product-price").value),
    stock: stock === "" ? null : Number(stock),
  });
  if (ok) resetProductForm();
});
$("product-cancel").addEventListener("click", resetProductForm);

// --- WhatsApp and payment settings ---------------------------------------

let settings = {};
const SETTING_FIELDS = { shopName: "shop-name", whatsapp: "shop-whatsapp", flooz: "shop-flooz", tmoney: "shop-tmoney", zones: "shop-zones" };

async function loadSettings() {
  settings = await api("GET", "/api/settings");
  for (const [key, id] of Object.entries(SETTING_FIELDS)) $(id).value = settings[key] ?? "";
}

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(Object.entries(SETTING_FIELDS).map(([key, id]) => [key, $(id).value]));
  try {
    settings = await api("PUT", "/api/settings", body);
    $("settings-status").textContent = "Enregistré.";
    $("settings-status").classList.remove("error");
    await loadLeads();
  } catch (err) {
    $("settings-status").textContent = err.message;
    $("settings-status").classList.add("error");
  }
});

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    prompt("Copie ce texte :", text);
    return;
  }
  const label = button.textContent;
  button.textContent = "Copié ✓";
  setTimeout(() => (button.textContent = label), 1500);
}

function actionButton(label, onClick) {
  const b = el("button", "secondary small", label);
  b.type = "button";
  b.addEventListener("click", () => onClick(b));
  return b;
}

// --- Leads ----------------------------------------------------------------

const leads = new Map(); // id -> li
let currentLiveId = null;
let statuses = Object.keys(STATUS_LABELS);

function leadItem(lead) {
  const li = el("li", `lead status-${lead.status}`);
  const head = el("div", "lead-head");
  head.append(el("span", "who", `@${lead.user}`));
  head.append(el("span", `tag ${lead.intent}`, LABELS[lead.intent] ?? ""));
  const select = el("select", "lead-status");
  select.setAttribute("aria-label", "Statut");
  for (const s of statuses) {
    const opt = el("option", null, STATUS_LABELS[s] ?? s);
    opt.value = s;
    opt.selected = s === lead.status;
    select.append(opt);
  }
  select.addEventListener("change", async () => {
    try {
      await api("PATCH", `/api/leads/${lead.id}`, { status: select.value });
    } catch (err) {
      select.value = lead.status;
      alert(err.message);
    }
  });
  head.append(select);
  li.append(head);

  head.prepend(el("span", "code", lead.code));
  if (lead.items.length) {
    const order = el("div", "order");
    order.textContent = lead.items.map((i) => `${i.quantity} × ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ");
    if (lead.total != null) order.append(` = ${cfa(lead.total)}`);
    li.append(order);
  }
  const last = lead.comments.at(-1);
  if (last) li.append(el("div", "detail", `« ${last.text} »${lead.comments.length > 1 ? ` (+${lead.comments.length - 1})` : ""}`));

  if (lead.delivery) {
    const d = lead.delivery;
    const text = [d.zone, d.address, d.slot].filter(Boolean).join(" · ");
    li.append(el("div", "detail", `🛵 ${text}${d.fee ? ` · livraison ${cfa(d.fee)}` : ""}`));
  }
  if (lead.payment) {
    const p = el("div", "detail");
    const a = el("a", null, `Lien de paiement ${cfa(lead.payment.amount)}`);
    a.href = lead.payment.url;
    a.target = "_blank";
    a.rel = "noopener";
    p.append("💳 ", a);
    li.append(p);
  }

  const reply = lead.chat?.length ? null : liveReply(lead, settings);
  if (reply) {
    const box = el("div", "reply");
    box.append(el("span", "reply-label", "À répondre dans le live"), el("div", null, reply));
    li.append(box);
  }
  const actions = el("div", "lead-actions");
  if (reply) actions.append(actionButton("Copier la réponse", (b) => copy(reply, b)));
  if (lead.items.length && lead.status !== "annule") {
    const message = whatsappMessage(lead, settings);
    actions.append(actionButton("Copier le message WhatsApp", (b) => copy(message, b)));
    const link = lead.phone && waLink(lead.phone, message);
    if (link) {
      const a = el("a", "button small", `WhatsApp ${lead.phone}`);
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      actions.append(a);
    }
  }
  if (actions.childElementCount) li.append(actions);
  li.append(chatBox(lead));
  return li;
}

// The WhatsApp conversation, and a field to write as the customer to try it out.
const openChats = new Set();

function chatBox(lead) {
  const box = el("details", "chat");
  box.open = openChats.has(lead.id);
  box.addEventListener("toggle", () => (box.open ? openChats.add(lead.id) : openChats.delete(lead.id)));
  box.append(el("summary", null, `Conversation WhatsApp${lead.chat?.length ? ` (${lead.chat.length})` : ""}`));
  const log = el("div", "chat-log");
  for (const m of lead.chat ?? []) log.append(el("div", `bubble ${m.from}`, m.text));
  if (!lead.chat?.length) log.append(el("p", "detail", `Le client écrit ${lead.code} sur WhatsApp et l'assistante prend le relais.`));
  const form = el("form", "chat-form");
  const input = el("input");
  input.placeholder = `Écrire comme @${lead.user} (test)`;
  const send = el("button", "small", "Envoyer");
  form.append(input, send);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    send.disabled = true;
    try {
      await api("POST", `/api/leads/${lead.id}/simulate`, { text: input.value });
    } catch (err) {
      alert(err.message);
      send.disabled = false;
    }
  });
  box.append(log, form);
  return box;
}

function showLead(lead) {
  const li = leadItem(lead);
  const old = leads.get(lead.id);
  if (old) old.replaceWith(li);
  else $("lead-list").prepend(li);
  leads.set(lead.id, li);
  $("lead-empty").hidden = true;
}

async function loadLeads() {
  const data = await api("GET", "/api/leads");
  statuses = data.statuses;
  currentLiveId = data.liveId;
  leads.clear();
  $("lead-list").replaceChildren();
  $("lead-empty").hidden = data.leads.length > 0;
  for (const l of [...data.leads].sort((a, b) => a.lastAt - b.lastAt)) showLead(l);
}

// --- Deliveries -----------------------------------------------------------

async function loadDeliveries() {
  const list = $("delivery-list");
  const items = await api("GET", "/api/deliveries");
  list.replaceChildren();
  $("delivery-empty").hidden = items.length > 0;
  for (const l of items) {
    const li = el("li", `lead status-${l.status}`);
    const head = el("div", "lead-head");
    head.append(el("span", "code", l.code), el("span", "who", l.waName ?? `@${l.user}`));
    if (l.status === "paye") {
      head.append(
        actionButton("Marquer livré", async () => {
          await api("PATCH", `/api/leads/${l.id}`, { status: "livre" });
          loadDeliveries();
        }),
      );
    } else head.append(el("span", "tag achat", "Livré"));
    li.append(head);
    li.append(el("div", "order", `${l.items.map((i) => `${i.quantity} × ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ")} · ${cfa(l.amountDue ?? l.total ?? 0)} payé`));
    const d = l.delivery ?? {};
    li.append(el("div", null, `🛵 ${[d.zone, d.address, d.slot].filter(Boolean).join(" · ") || "adresse à demander"}`));
    if (l.phone) {
      const a = el("a", "detail", `📞 ${l.phone}`);
      a.href = `tel:+${String(l.phone).replace(/\D/g, "")}`;
      li.append(a);
    }
    list.append(li);
  }
}

// --- Live -----------------------------------------------------------------

const comments = new Map(); // id -> li

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

function setLive(on) {
  $("connect").hidden = on;
  $("demo").hidden = on;
  $("stop").hidden = !on;
}

function showStats(s) {
  $("count").textContent = s.comments;
  $("buyers").textContent = s.buyers;
  $("revenue").textContent = cfa(s.revenue ?? 0);
}

const events = new EventSource("/api/events");
events.addEventListener("hello", (e) => {
  const { ai, live, stats, whatsapp, payments } = JSON.parse(e.data);
  $("ai-badge").textContent = [ai ? "IA active" : "Mots-clés (sans IA)", whatsapp ? "WhatsApp connecté" : "WhatsApp démo", payments ? "PayGate" : "Paiement démo"].join(" · ");
  setLive(live);
  if (stats) showStats(stats);
});
events.addEventListener("status", (e) => {
  const s = JSON.parse(e.data);
  setStatus(s.message, s.state === "error");
  if (["ended", "disconnected", "stopped", "error"].includes(s.state)) setLive(false);
});
events.addEventListener("viewers", (e) => ($("viewers").textContent = JSON.parse(e.data)));
events.addEventListener("stats", (e) => showStats(JSON.parse(e.data)));
events.addEventListener("comment", (e) => {
  const c = JSON.parse(e.data);
  const li = el("li");
  li.append(el("span", "who", `@${c.user}`), el("span", "tag pending", "analyse…"), el("div", null, c.text));
  comments.set(c.id, li);
  $("comment-list").prepend(li);
});
events.addEventListener("intent", (e) => {
  const r = JSON.parse(e.data);
  const tag = comments.get(r.id)?.querySelector(".tag");
  if (!tag) return;
  if (r.intent === "autre") return tag.remove();
  tag.className = `tag ${r.intent}`;
  tag.textContent = LABELS[r.intent];
});
events.addEventListener("lead", (e) => {
  const lead = JSON.parse(e.data);
  if (leads.has(lead.id) || lead.liveId === currentLiveId) showLead(lead);
});
events.addEventListener("delivery", () => {
  if (!$("tab-deliveries").hidden) loadDeliveries();
});

function resetLive() {
  comments.clear();
  leads.clear();
  $("comment-list").replaceChildren();
  $("lead-list").replaceChildren();
  $("lead-empty").hidden = false;
  showStats({ comments: 0, buyers: 0, revenue: 0 });
  $("viewers").textContent = "–";
}

async function start(mode) {
  resetLive();
  currentLiveId = null;
  setStatus("Connexion…");
  $("connect").disabled = $("demo").disabled = true;
  try {
    currentLiveId = (await api("POST", "/api/live", { mode, username: $("username").value })).liveId;
    await loadLeads();
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

loadProducts();
loadSettings().then(loadLeads);
