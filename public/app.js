const $ = (id) => document.getElementById(id);

const LABELS = {
  achat: "Veut acheter",
  question_prix: "Demande le prix",
  question_produit: "Question produit",
  question_livraison: "Livraison / paiement",
};

const STATUS_LABELS = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  paye: "Payé",
  annule: "Annulé",
};

const cfa = (n) => `${Math.round(n).toLocaleString("fr-FR").replace(/\s/g, " ")} F`;

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

function showTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  $("tab-live").hidden = name !== "live";
  $("tab-products").hidden = name !== "products";
  try {
    localStorage.setItem("tab", name);
  } catch {
    // storage unavailable
  }
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => showTab(t.dataset.tab));
let initialTab = "live";
try {
  initialTab = localStorage.getItem("tab") === "products" ? "products" : "live";
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

// --- Leads ----------------------------------------------------------------

const leads = new Map(); // id -> li
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

  const order = [lead.product, lead.quantity ? `× ${lead.quantity}` : null, lead.total != null ? `= ${cfa(lead.total)}` : null]
    .filter(Boolean)
    .join(" ");
  if (order) li.append(el("div", "order", order));
  const last = lead.comments.at(-1);
  if (last) li.append(el("div", "detail", `« ${last.text} »${lead.comments.length > 1 ? ` (+${lead.comments.length - 1})` : ""}`));
  return li;
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
  leads.clear();
  $("lead-list").replaceChildren();
  $("lead-empty").hidden = data.leads.length > 0;
  for (const l of [...data.leads].sort((a, b) => a.lastAt - b.lastAt)) showLead(l);
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
  const { ai, live, stats } = JSON.parse(e.data);
  $("ai-badge").textContent = ai ? "IA active" : "Mots-clés (sans IA)";
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
events.addEventListener("lead", (e) => showLead(JSON.parse(e.data)));

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
  setStatus("Connexion…");
  $("connect").disabled = $("demo").disabled = true;
  try {
    await api("POST", "/api/live", { mode, username: $("username").value });
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
loadLeads();
