const state = { cards: [], search: "", sort: "added_desc" };

const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const statCount = document.getElementById("statCount");
const statValue = document.getElementById("statValue");
const toolbarEl = document.getElementById("toolbar");

function eur(n) {
  return new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(n || 0);
}

// Táto verzia nemá žiadny server - obrázky sa berú priamo z internetu (prehliadač
// si ich sám krátkodobo ucachuje), namiesto trvalej cache na disku ako v appke na počítači.
function localImg(url) {
  return url || "";
}

function cardmarketUrl(card) {
  if (card.cardmarket_url) return card.cardmarket_url;
  const q = [card.name, card.set_name].filter(Boolean).join(" ");
  return "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=" + encodeURIComponent(q);
}

// Orientačný prepočet ceny podľa stavu karty, vychádza z Cardmarket trend ceny (~NM).
const CONDITION_MULTIPLIERS = {
  M: 1.05,
  NM: 1.0,
  EX: 0.85,
  GD: 0.65,
  LP: 0.5,
  PL: 0.3,
  PO: 0.15,
};

function estimatePrice(marketPrice, condition) {
  const mult = CONDITION_MULTIPLIERS[condition] ?? 1;
  return Math.round(marketPrice * mult * 100) / 100;
}

// ---- Uloženie zbierky priamo v telefóne/prehliadači (žiadny server) ----
const STORAGE_KEY = "pkmn_collection_v1";

function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Date.now().toString(16) + Math.random().toString(16).slice(2);
}

function readLocalCards() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function writeLocalCards(cards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

function createLocalCard(payload) {
  const now = new Date().toISOString().slice(0, 10);
  const price = payload.price;
  const hasPrice = price !== "" && price != null;
  const marketPrice = payload.market_price;
  const hasMarket = marketPrice !== "" && marketPrice != null;
  const card = {
    id: genId(),
    name: (payload.name || "").trim(),
    set_name: (payload.set_name || "").trim(),
    number: (payload.number || "").trim(),
    rarity: (payload.rarity || "").trim(),
    variant: payload.variant || "normal",
    condition: payload.condition || "NM",
    language: payload.language || "EN",
    quantity: parseInt(payload.quantity, 10) || 1,
    image_url: (payload.image_url || "").trim(),
    price: hasPrice ? parseFloat(price) : null,
    price_source: hasPrice ? (payload.price_source || null) : null,
    price_updated_at: hasPrice ? now : null,
    market_price: hasMarket ? parseFloat(marketPrice) : null,
    tcg_id: (payload.tcg_id || "").trim(),
    set_id: (payload.set_id || "").trim(),
    cardmarket_url: (payload.cardmarket_url || "").trim(),
    notes: (payload.notes || "").trim(),
    added_at: now,
  };
  const cards = readLocalCards();
  cards.push(card);
  writeLocalCards(cards);
  return card;
}

function updateLocalCard(id, patch) {
  const cards = readLocalCards();
  const found = cards.find(c => c.id === id);
  if (!found) return null;
  const fields = ["name", "set_name", "number", "rarity", "variant", "condition", "language",
    "notes", "image_url", "tcg_id", "set_id", "cardmarket_url"];
  fields.forEach(f => { if (f in patch) found[f] = patch[f]; });
  if ("quantity" in patch) found.quantity = parseInt(patch.quantity, 10) || 1;
  if ("price" in patch) {
    const p = patch.price;
    const newPrice = (p !== "" && p != null) ? parseFloat(p) : null;
    if (newPrice !== found.price) found.price_updated_at = new Date().toISOString().slice(0, 10);
    found.price = newPrice;
    found.price_source = newPrice != null ? (patch.price_source || null) : null;
  }
  if ("market_price" in patch) {
    const mp = patch.market_price;
    found.market_price = (mp !== "" && mp != null) ? parseFloat(mp) : null;
  }
  writeLocalCards(cards);
  return found;
}

function deleteLocalCard(id) {
  writeLocalCards(readLocalCards().filter(c => c.id !== id));
}

async function loadCards() {
  state.cards = readLocalCards();
  render();
}

function filteredSortedCards() {
  let list = state.cards.slice();
  const s = state.search.trim().toLowerCase();
  if (s) {
    list = list.filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.set_name || "").toLowerCase().includes(s) ||
      (c.notes || "").toLowerCase().includes(s)
    );
  }
  switch (state.sort) {
    case "name_asc":
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "price_desc":
      list.sort((a, b) => (b.price || 0) - (a.price || 0));
      break;
    case "price_asc":
      list.sort((a, b) => (a.price || 0) - (b.price || 0));
      break;
    default:
      list.sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
  }
  return list;
}

function render() {
  const list = filteredSortedCards();
  grid.innerHTML = "";
  emptyState.classList.toggle("hidden", state.cards.length > 0);
  // Vyhľadávanie, triedenie a ostatné tlačidlá nemajú zmysel, kým nemáš ani jednu
  // kartu - schované, nech prvé otvorenie appky pôsobí čo najjednoduchšie.
  toolbarEl.classList.toggle("hidden", state.cards.length === 0);

  let totalValue = 0;
  let totalCount = 0;
  state.cards.forEach(c => {
    totalCount += c.quantity || 1;
    totalValue += (c.price || 0) * (c.quantity || 1);
  });
  statCount.textContent = totalCount;
  statValue.textContent = eur(totalValue);

  list.forEach(card => {
    const el = document.createElement("div");
    el.className = "card";
    el.addEventListener("click", (e) => {
      if (e.target.closest(".cm-link")) return;
      openEdit(card);
    });

    const img = document.createElement("img");
    img.className = "card-img";
    img.loading = "lazy";
    if (card.image_url) img.src = localImg(card.image_url);
    el.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = card.name;
    body.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "card-sub";
    sub.textContent = [card.set_name, card.number].filter(Boolean).join(" · ") || "—";
    body.appendChild(sub);

    const badges = document.createElement("div");
    badges.className = "card-badges";
    badges.innerHTML = `
      <span class="badge cond-${card.condition || "NM"}">${card.condition || "NM"}</span>
      <span class="badge">${card.language || "EN"}</span>
      <span class="badge">×${card.quantity || 1}</span>
      ${card.variant === "reverse_holo" ? '<span class="badge holo">✨ Reverse Holo</span>' : ""}
    `;
    body.appendChild(badges);

    const priceRow = document.createElement("div");
    priceRow.className = "card-price-row";
    const priceEl = document.createElement("div");
    if (card.price != null) {
      priceEl.className = "card-price";
      priceEl.textContent = eur(card.price);
    } else {
      priceEl.className = "card-price empty";
      priceEl.textContent = "cena nezadaná";
    }
    priceRow.appendChild(priceEl);
    if (card.price_updated_at) {
      const upd = document.createElement("div");
      upd.className = "card-updated";
      upd.textContent = card.price_updated_at;
      priceRow.appendChild(upd);
    }
    body.appendChild(priceRow);
    el.appendChild(body);

    const link = document.createElement("a");
    link.className = "cm-link";
    link.href = cardmarketUrl(card);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "🔗 Skontrolovať cenu na Cardmarket";
    el.appendChild(link);

    grid.appendChild(el);
  });
}

// ---- Add form ----
const toggleAdd = document.getElementById("toggleAdd");
const addForm = document.getElementById("addForm");
const cancelAdd = document.getElementById("cancelAdd");
const addNotice = document.getElementById("addNotice");
const moreFields = document.getElementById("moreFields");
const toggleMoreFields = document.getElementById("toggleMoreFields");

function resetAddExtras() {
  document.getElementById("cardPreview").classList.add("hidden");
  document.getElementById("f_priceHint").textContent = "";
  priceLinkedToMarket = true;
  currentCardPrices = { normal: null, reverse: null };
  moreFields.classList.add("hidden");
  toggleMoreFields.textContent = "▾ Viac možností (séria, rarita, jazyk, poznámka...)";
}

toggleMoreFields.addEventListener("click", () => {
  const nowHidden = moreFields.classList.toggle("hidden");
  toggleMoreFields.textContent = nowHidden
    ? "▾ Viac možností (séria, rarita, jazyk, poznámka...)"
    : "▴ Menej možností";
});

function setAddFormOpen(open) {
  addForm.classList.toggle("hidden", !open);
  toggleAdd.textContent = open ? "✕ Zavrieť formulár" : "+ Pridať kartu";
  // Kým je formulár otvorený, tlačidlo sa na mobile nemá plávať dole (prekrývalo
  // by "Uložiť kartu"/"Zrušiť") - vráti sa do normálneho toku stránky.
  toggleAdd.classList.toggle("form-open", open);
}

toggleAdd.addEventListener("click", () => {
  setAddFormOpen(addForm.classList.contains("hidden"));
});
cancelAdd.addEventListener("click", () => {
  addForm.reset();
  resetAddExtras();
  setAddFormOpen(false);
});

function findDuplicateCard(payload) {
  const norm = (v) => (v || "").toString().trim().toLowerCase();
  return state.cards.find(c => {
    if (payload.tcg_id && c.tcg_id) {
      if (c.tcg_id !== payload.tcg_id) return false;
    } else {
      if (norm(c.name) !== norm(payload.name)) return false;
      if (norm(c.set_name) !== norm(payload.set_name)) return false;
      if (norm(c.number) !== norm(payload.number)) return false;
    }
    if ((c.condition || "NM") !== (payload.condition || "NM")) return false;
    if ((c.variant || "normal") !== (payload.variant || "normal")) return false;
    if ((c.language || "EN") !== (payload.language || "EN")) return false;
    return true;
  });
}

function showAddNotice(text) {
  addNotice.textContent = text;
  addNotice.classList.remove("hidden");
  clearTimeout(showAddNotice.timer);
  showAddNotice.timer = setTimeout(() => addNotice.classList.add("hidden"), 5000);
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  // Zabráni dvojitému odoslaniu (napr. rýchle dvojité kliknutie) - bez toho by sa
  // rovnaká karta vedela pridať dvakrát ako dve oddelené položky namiesto zlúčenia počtu.
  const submitBtn = addForm.querySelector('button[type="submit"]');
  if (submitBtn.disabled) return;
  submitBtn.disabled = true;
  try {
    await submitAddForm();
  } finally {
    submitBtn.disabled = false;
  }
});

async function submitAddForm() {
  const payload = {
    name: document.getElementById("f_name").value,
    set_name: document.getElementById("f_set").value,
    number: document.getElementById("f_number").value,
    rarity: document.getElementById("f_rarity").value,
    variant: document.getElementById("f_variant").value,
    condition: document.getElementById("f_condition").value,
    language: document.getElementById("f_language").value,
    quantity: document.getElementById("f_quantity").value || 1,
    price: document.getElementById("f_price").value,
    image_url: document.getElementById("f_image").value,
    notes: document.getElementById("f_notes").value,
    tcg_id: document.getElementById("f_tcgid").value,
    set_id: document.getElementById("f_setid").value,
    cardmarket_url: document.getElementById("f_cmurl").value,
    market_price: document.getElementById("f_marketprice").value,
    price_source: document.getElementById("f_marketprice").value ? "Cardmarket (odhad)" : undefined,
  };

  const duplicate = findDuplicateCard(payload);
  if (duplicate) {
    const addedQty = parseInt(payload.quantity, 10) || 1;
    const newQty = (duplicate.quantity || 1) + addedQty;
    updateLocalCard(duplicate.id, { quantity: newQty });
    addForm.reset();
    resetAddExtras();
    setAddFormOpen(false);
    await loadCards();
    showAddNotice(`✅ Túto kartu (${duplicate.name}, stav ${duplicate.condition}) už máš — teraz jej máš ${newQty}×!`);
    return;
  }

  createLocalCard(payload);
  addForm.reset();
  resetAddExtras();
  setAddFormOpen(false);
  await loadCards();
}

// ---- Vyhľadávanie karty via pokemontcg.io (verejné API) ----
// Podporuje vstup typu "Houndour 59/109" - rozparsuje meno + číslo/celkový počet
// a keď nájde presne jednu zhodu, hneď ju predvyplní vrátane orientačnej ceny.
const nameInput = document.getElementById("f_name");
const suggestionsBox = document.getElementById("suggestions");
const cardPreview = document.getElementById("cardPreview");
const f_condition = document.getElementById("f_condition");
const f_variant = document.getElementById("f_variant");
const f_price = document.getElementById("f_price");
const f_priceHint = document.getElementById("f_priceHint");
const f_marketprice = document.getElementById("f_marketprice");
let debounceTimer = null;
let priceLinkedToMarket = true;
let currentCardPrices = { normal: null, reverse: null };
let searchAbortController = null;

function parseQuickQuery(raw) {
  const s = raw.trim();
  // Samotné číslo/total bez mena, napr. "74/181" - vyhľadá sa priamo podľa čísla karty.
  let m = s.match(/^#?(\d+)\s*\/\s*(\d+)\s*$/);
  if (m) return { name: "", number: m[1], total: m[2] };
  // Zachytí aj rozostavaný vstup typu "Houndour 59/" (uprostred písania čísla) -
  // bez toho by sa "59/" poslalo ako súčasť mena do API a vyhľadávanie sa spomalilo.
  m = s.match(/^(.+?)\s+#?(\d+)(?:\s*\/\s*(\d+))?\s*\/?\s*$/);
  if (m) return { name: m[1].trim(), number: m[2], total: m[3] };
  return { name: s };
}

nameInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  if (searchAbortController) searchAbortController.abort();
  priceLinkedToMarket = true;
  const q = nameInput.value.trim();
  if (q.length < 2) {
    suggestionsBox.classList.add("hidden");
    return;
  }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 350);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".autocomplete-wrap")) {
    suggestionsBox.classList.add("hidden");
  }
});

async function apiCardsQuery(filter, pageSize, signal, orderBy) {
  const url = "https://api.pokemontcg.io/v2/cards?q=" +
    encodeURIComponent(filter) + `&pageSize=${pageSize}&orderBy=${orderBy || "name"}`;
  // Verejné API bez kľúča občas vráti dočasnú chybu (500) - jedno opakovanie väčšinou pomôže.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { signal });
    if (res.ok) {
      const data = await res.json();
      return data.data || [];
    }
    if (attempt === 0 && res.status >= 500) continue;
    throw new Error("API error " + res.status);
  }
  return [];
}

function filterExact(items, parsed) {
  const wantNum = parseInt(parsed.number, 10);
  const wantTotal = parsed.total ? parseInt(parsed.total, 10) : null;
  return items.filter(item => {
    const num = parseInt(item.number, 10);
    if (num !== wantNum) return false;
    if (wantTotal == null) return true;
    const total = parseInt(item.set?.printedTotal ?? item.set?.total, 10);
    return total === wantTotal;
  });
}

async function fetchSuggestions(query) {
  if (searchAbortController) searchAbortController.abort();
  const controller = new AbortController();
  searchAbortController = controller;

  suggestionsBox.innerHTML = `<div class="suggestion-loading">🔎 Hľadám...</div>`;
  suggestionsBox.classList.remove("hidden");

  const parsed = parseQuickQuery(query);
  try {
    // Samotné číslo/total (napr. "74/181") bez mena - hľadá sa priamo podľa čísla karty a
    // celkového počtu kariet v sete, ktoré spolu kartu skoro vždy jednoznačne určia.
    if (!parsed.name && parsed.number) {
      let filter = `number:${parsed.number}`;
      if (parsed.total) filter += ` set.printedTotal:${parsed.total}`;
      let items = await apiCardsQuery(filter, 50, controller.signal, "set.releaseDate");
      items = filterExact(items, parsed);
      if (items.length === 1) {
        selectCard(items[0]);
        return;
      }
      renderSuggestions(items.slice(0, 8));
      return;
    }

    // Keď je zadané aj číslo, treba prehľadať VŠETKY karty s daným menom (nielen prvých pár),
    // inak sa pri populárnych Pokémonoch (Pikachu, Eevee...) hľadaná karta jednoducho nedostane do výsledkov.
    const pageSize = parsed.number ? 250 : 15;
    let items = await apiCardsQuery(`name:"${parsed.name}*"`, pageSize, controller.signal);

    if (!items.length) {
      // Skús aj kdekoľvek v mene, nielen na začiatku (napr. "Grimer" nájde aj "Alolan Grimer").
      try {
        items = await apiCardsQuery(`name:*${parsed.name}*`, pageSize, controller.signal);
      } catch (err2) {
        if (err2.name === "AbortError") throw err2;
      }
    }

    if (parsed.number) {
      const exact = filterExact(items, parsed);
      if (exact.length === 1) {
        selectCard(exact[0]);
        return;
      }
      if (exact.length > 1) items = exact;
    }
    renderSuggestions(items.slice(0, 8));
  } catch (err) {
    if (err.name === "AbortError") return;
    suggestionsBox.innerHTML = `<div class="suggestion-loading">Vyhľadávanie zlyhalo, skús znova.</div>`;
  }
}

function renderSuggestions(items) {
  if (!items.length) {
    suggestionsBox.innerHTML = `<div class="suggestion-loading">Nič sa nenašlo. Skús iný názov alebo skontroluj číslo karty.</div>`;
    return;
  }
  suggestionsBox.innerHTML = "";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "suggestion-item";
    row.innerHTML = `
      <img src="${item.images?.small || ""}" alt="">
      <div class="s-text">${item.name}<small>${item.set?.name || ""} · ${item.number || ""}${item.set?.printedTotal ? "/" + item.set.printedTotal : ""}</small></div>
    `;
    row.addEventListener("click", () => selectCard(item));
    suggestionsBox.appendChild(row);
  });
  suggestionsBox.classList.remove("hidden");
}

function cardMarketPrices(item) {
  const p = item.cardmarket?.prices;
  if (!p) return { normal: null, reverse: null };
  return {
    normal: p.trendPrice ?? p.avg30 ?? p.averageSellPrice ?? null,
    reverse: p.reverseHoloTrend ?? p.reverseHoloAvg30 ?? p.reverseHoloSell ?? null,
  };
}

function selectCard(item) {
  nameInput.value = item.name;
  document.getElementById("f_set").value = item.set?.name || "";
  document.getElementById("f_number").value = item.set?.printedTotal
    ? `${item.number}/${item.set.printedTotal}` : (item.number || "");
  document.getElementById("f_rarity").value = item.rarity || "";
  document.getElementById("f_image").value = item.images?.large || item.images?.small || "";
  document.getElementById("f_tcgid").value = item.id || "";
  document.getElementById("f_cmurl").value = item.cardmarket?.url || "";
  document.getElementById("f_setid").value = item.set?.id || "";

  currentCardPrices = cardMarketPrices(item);
  f_variant.value = "normal";
  priceLinkedToMarket = currentCardPrices.normal != null || currentCardPrices.reverse != null;

  document.getElementById("cp_img").src = localImg(item.images?.small || "");
  document.getElementById("cp_name").textContent = item.name;
  document.getElementById("cp_meta").textContent =
    [item.set?.name, item.set?.printedTotal ? `${item.number}/${item.set.printedTotal}` : item.number]
      .filter(Boolean).join(" · ");
  cardPreview.classList.remove("hidden");
  suggestionsBox.classList.add("hidden");

  updatePriceFromCondition();
}

document.getElementById("cp_clear").addEventListener("click", () => {
  cardPreview.classList.add("hidden");
  nameInput.value = "";
  document.getElementById("f_set").value = "";
  document.getElementById("f_number").value = "";
  document.getElementById("f_rarity").value = "";
  document.getElementById("f_image").value = "";
  document.getElementById("f_tcgid").value = "";
  document.getElementById("f_cmurl").value = "";
  document.getElementById("f_setid").value = "";
  f_marketprice.value = "";
  f_priceHint.textContent = "";
  priceLinkedToMarket = true;
  currentCardPrices = { normal: null, reverse: null };
  f_variant.value = "normal";
  nameInput.focus();
});

function updatePriceFromCondition() {
  const wantReverse = f_variant.value === "reverse_holo";
  let base = wantReverse ? currentCardPrices.reverse : currentCardPrices.normal;
  let usedReverse = wantReverse;
  let fallbackNote = "";
  if (base == null) {
    const other = wantReverse ? currentCardPrices.normal : currentCardPrices.reverse;
    if (other != null) {
      base = other;
      usedReverse = !wantReverse;
      fallbackNote = ` (${wantReverse ? "Reverse Holo" : "normálna"} cena nedostupná, použitá ${usedReverse ? "Reverse Holo" : "normálna"})`;
    }
  }
  f_marketprice.value = base != null ? base : "";
  if (!priceLinkedToMarket || base == null) {
    f_priceHint.textContent = "";
    return;
  }
  const est = estimatePrice(base, f_condition.value);
  f_price.value = est;
  f_priceHint.textContent =
    `Odhad podľa Cardmarket ceny (${usedReverse ? "Reverse Holo" : "Normálna"}, NM ${eur(base)}) pre stav ${f_condition.value}${fallbackNote}`;
}

f_condition.addEventListener("change", updatePriceFromCondition);
f_variant.addEventListener("change", updatePriceFromCondition);
f_price.addEventListener("input", () => {
  priceLinkedToMarket = false;
  f_priceHint.textContent = "cena upravená ručne";
});

// ---- Search / sort ----
document.getElementById("searchBox").addEventListener("input", (e) => {
  state.search = e.target.value;
  render();
});
document.getElementById("sortBox").addEventListener("change", (e) => {
  state.sort = e.target.value;
  render();
});

// ---- Edit modal ----
const editModal = document.getElementById("editModal");
const editForm = document.getElementById("editForm");
const e_condition = document.getElementById("e_condition");
const e_price = document.getElementById("e_price");
const e_priceHint = document.getElementById("e_priceHint");
const e_marketprice = document.getElementById("e_marketprice");
let editingId = null;
let editPriceLinkedToMarket = true;

function updateEditPriceFromCondition() {
  const base = parseFloat(e_marketprice.value);
  if (!editPriceLinkedToMarket || isNaN(base)) {
    e_priceHint.textContent = "";
    return;
  }
  const est = estimatePrice(base, e_condition.value);
  e_price.value = est;
  e_priceHint.textContent =
    `Odhad podľa Cardmarket ceny (NM ${eur(base)}) pre stav ${e_condition.value}`;
}

e_condition.addEventListener("change", updateEditPriceFromCondition);
e_price.addEventListener("input", () => {
  editPriceLinkedToMarket = false;
  e_priceHint.textContent = "cena upravená ručne";
});

function openEdit(card) {
  editingId = card.id;
  document.getElementById("e_id").value = card.id;
  document.getElementById("e_name").value = card.name || "";
  document.getElementById("e_set").value = card.set_name || "";
  document.getElementById("e_number").value = card.number || "";
  document.getElementById("e_rarity").value = card.rarity || "";
  document.getElementById("e_variant").value = card.variant || "normal";
  document.getElementById("e_condition").value = card.condition || "NM";
  document.getElementById("e_language").value = card.language || "EN";
  document.getElementById("e_quantity").value = card.quantity || 1;
  document.getElementById("e_price").value = card.price != null ? card.price : "";
  document.getElementById("e_notes").value = card.notes || "";
  e_marketprice.value = card.market_price != null ? card.market_price : "";
  editPriceLinkedToMarket = card.market_price != null;
  e_priceHint.textContent = "";
  editModal.classList.remove("hidden");
}

document.getElementById("closeModal").addEventListener("click", () => {
  editModal.classList.add("hidden");
});
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) editModal.classList.add("hidden");
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById("e_name").value,
    set_name: document.getElementById("e_set").value,
    number: document.getElementById("e_number").value,
    rarity: document.getElementById("e_rarity").value,
    variant: document.getElementById("e_variant").value,
    condition: document.getElementById("e_condition").value,
    language: document.getElementById("e_language").value,
    quantity: document.getElementById("e_quantity").value || 1,
    price: document.getElementById("e_price").value,
    notes: document.getElementById("e_notes").value,
    market_price: e_marketprice.value,
    price_source: e_marketprice.value ? "Cardmarket (odhad)" : undefined,
  };
  updateLocalCard(editingId, payload);
  editModal.classList.add("hidden");
  await loadCards();
});

document.getElementById("deleteCard").addEventListener("click", async () => {
  if (!confirm("Naozaj chceš odstrániť túto kartu zo zbierky?")) return;
  deleteLocalCard(editingId);
  editModal.classList.add("hidden");
  await loadCards();
});

// ---- Sety (checklist podľa setu, čo chýba a za koľko) ----
const toggleSets = document.getElementById("toggleSets");
const setsView = document.getElementById("setsView");
const setsList = document.getElementById("setsList");
const setSearchInput = document.getElementById("setSearchInput");
const setSuggestions = document.getElementById("setSuggestions");
const setDetail = document.getElementById("setDetail");
const setDetailBack = document.getElementById("setDetailBack");
const setDetailTitle = document.getElementById("setDetailTitle");
const setDetailProgressFill = document.getElementById("setDetailProgressFill");
const setDetailSummary = document.getElementById("setDetailSummary");
const setDetailGrid = document.getElementById("setDetailGrid");

function normalizeNumber(n) {
  return (n || "").toString().trim().replace(/^0+(?=\d)/, "");
}

toggleSets.addEventListener("click", () => {
  const showingSets = setsView.classList.contains("hidden");
  setsView.classList.toggle("hidden", !showingSets);
  grid.classList.toggle("hidden", showingSets);
  emptyState.classList.add("hidden");
  toggleSets.textContent = showingSets ? "⬅ Späť na zbierku" : "📚 Moje sety";
  if (showingSets) renderSetsList();
  else render();
});

// Sety (logo, počet kariet, zoznam kariet) sa raz stiahnuté ukladajú do localStorage,
// aby appka pri každom otvorení "Moje sety" nemusela sťahovať to isté znova z internetu.
const CACHE_PREFIX = "pkmn_cache_v1::";

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}
function cacheSet(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    // localStorage plný/nedostupný - appka funguje ďalej, len bez trvalej cache
  }
}
function cacheRemove(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch (err) {}
}
function setCacheKey(setId, setName) {
  return setId || `name:${(setName || "").trim().toLowerCase()}`;
}

const setMetaCache = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSetMeta(setId, setName) {
  const key = setCacheKey(setId, setName);
  if (setMetaCache.has(key)) return setMetaCache.get(key);

  const cached = cacheGet("meta::" + key);
  if (cached !== null) {
    const promise = Promise.resolve(cached);
    setMetaCache.set(key, promise);
    return promise;
  }

  const filter = setId ? `id:${setId}` : `name:"${setName}"`;
  const promise = (async () => {
    const url = "https://api.pokemontcg.io/v2/sets?q=" + encodeURIComponent(filter) + "&pageSize=1";
    // Verejné API bez kľúča vie pri viacerých súčasných požiadavkách vrátiť dočasnú chybu
    // (napr. keď sa naraz načítava viac dlaždíc setov) - pár pokusov to väčšinou vyrieši.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const meta = (data.data || [])[0] || null;
          if (meta) cacheSet("meta::" + key, meta);
          return meta;
        }
        if (res.status !== 429 && res.status < 500) break;
      } catch (err) {
        // sieťová chyba - skús znova po krátkej pauze
      }
      await sleep(400 * (attempt + 1));
    }
    return null;
  })();
  setMetaCache.set(key, promise);
  promise.then(meta => {
    // Ak sa nepodarilo, nenechávaj to "zaseknuté" na zlyhaní do konca session -
    // nabudúce, keď sa dlaždica znova vykreslí, appka to skúsi odznova.
    if (!meta) setMetaCache.delete(key);
  });
  return promise;
}

function renderSetsList() {
  setDetail.classList.add("hidden");
  const groups = new Map();
  state.cards.forEach(c => {
    if (!c.set_name) return;
    // Skupiť VŽDY podľa názvu setu (nie podľa set_id) - staršie karty pridané pred zavedením
    // set_id ho nemajú, takže zoskupovanie podľa id by ten istý set rozdelilo na dve dlaždice.
    const key = c.set_name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { set_id: c.set_id || null, set_name: c.set_name, numbers: new Set() });
    const g = groups.get(key);
    if (!g.set_id && c.set_id) g.set_id = c.set_id;
    g.numbers.add(normalizeNumber((c.number || "").split("/")[0]));
  });
  setsList.innerHTML = "";
  if (!groups.size) {
    setsList.innerHTML = `<p class="empty">Zatiaľ nemáš karty priradené k žiadnemu setu. Vyhľadaj set vyššie, alebo pridaj karty cez pole "Karta (názov + číslo)".</p>`;
    return;
  }
  let staggerIndex = 0;
  groups.forEach(g => {
    const tile = document.createElement("div");
    tile.className = "set-tile";
    tile.innerHTML = `
      <div class="set-tile-logo-wrap"><span style="font-size:1.6rem;">⏳</span></div>
      <div class="set-tile-body">
        <div class="set-tile-title-row"><strong>${g.set_name}</strong><span class="set-tile-year"></span></div>
        <div class="progress-outer mini"><div class="progress-fill" style="width:0%"></div></div>
        <small>${g.numbers.size} kariet v zbierke</small>
      </div>
    `;
    tile.addEventListener("click", () => openSetDetail(g.set_id, g.set_name));
    setsList.appendChild(tile);

    // Malé oneskorenie medzi jednotlivými setmi, aby appka nepálila na verejné API
    // veľa požiadaviek naraz - to je presne to, čo doteraz spôsobovalo chyby.
    const delay = staggerIndex * 200;
    staggerIndex += 1;

    sleep(delay).then(() => fetchSetMeta(g.set_id, g.set_name)).then(meta => {
      const logoWrap = tile.querySelector(".set-tile-logo-wrap");
      const logoUrl = meta?.images?.logo || meta?.images?.symbol || "";
      logoWrap.innerHTML = logoUrl
        ? `<img class="set-tile-logo" src="${localImg(logoUrl)}" alt="">`
        : `<span style="font-size:1.8rem;">🃏</span>`;

      const year = meta?.releaseDate ? meta.releaseDate.split("/")[0] : "";
      const yearEl = tile.querySelector(".set-tile-year");
      if (yearEl && year) yearEl.textContent = year;

      if (!g.set_id && meta?.id) g.set_id = meta.id;
      const total = meta?.printedTotal || meta?.total || null;
      const small = tile.querySelector(".set-tile-body small");
      const fill = tile.querySelector(".progress-fill");
      if (total) {
        const pct = Math.min(100, Math.round((g.numbers.size / total) * 100));
        fill.style.width = pct + "%";
        small.textContent = `${g.numbers.size} / ${total} kariet (${pct} %)`;
      } else {
        small.textContent = `${g.numbers.size} kariet v zbierke`;
      }
    });
  });
}

let setSearchDebounce = null;
setSearchInput.addEventListener("input", () => {
  clearTimeout(setSearchDebounce);
  const q = setSearchInput.value.trim();
  if (q.length < 2) {
    setSuggestions.classList.add("hidden");
    return;
  }
  setSearchDebounce = setTimeout(() => fetchSetSuggestions(q), 350);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".sets-search-row")) setSuggestions.classList.add("hidden");
});

async function fetchSetSuggestions(query) {
  try {
    const url = "https://api.pokemontcg.io/v2/sets?q=" +
      encodeURIComponent(`name:"${query}*"`) + "&pageSize=8&orderBy=-releaseDate";
    const res = await fetch(url);
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    const items = data.data || [];
    if (!items.length) {
      setSuggestions.classList.add("hidden");
      return;
    }
    setSuggestions.innerHTML = "";
    items.forEach(s => {
      const row = document.createElement("div");
      row.className = "suggestion-item";
      row.innerHTML = `
        <img src="${s.images?.symbol || ""}" alt="" style="width:24px;height:24px;object-fit:contain;">
        <div class="s-text">${s.name}<small>${s.releaseDate ? s.releaseDate.split("/")[0] + " · " : ""}${s.series || ""} · ${s.printedTotal || s.total || "?"} kariet</small></div>
      `;
      row.addEventListener("click", () => {
        setSuggestions.classList.add("hidden");
        setSearchInput.value = "";
        openSetDetail(s.id, s.name);
      });
      setSuggestions.appendChild(row);
    });
    setSuggestions.classList.remove("hidden");
  } catch (err) {
    setSuggestions.classList.add("hidden");
  }
}

async function fetchAllSetCards(setId, setName, forceRefresh) {
  const key = setCacheKey(setId, setName);
  if (!forceRefresh) {
    const cached = cacheGet("cards::" + key);
    if (cached) return cached;
  }

  const filter = setId ? `set.id:${setId}` : `set.name:"${setName}"`;
  let all = [];
  let page = 1;
  while (page <= 4) {
    const url = "https://api.pokemontcg.io/v2/cards?q=" + encodeURIComponent(filter) +
      `&pageSize=250&page=${page}&orderBy=number`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    const batch = data.data || [];
    all = all.concat(batch);
    if (batch.length < 250 || all.length >= (data.totalCount || 0)) break;
    page += 1;
  }
  if (all.length) cacheSet("cards::" + key, all);
  return all;
}

let currentSetDetail = { setId: null, setName: null };

async function openSetDetail(setId, setName, forceRefresh) {
  currentSetDetail = { setId, setName };
  setDetail.classList.remove("hidden");
  setDetailTitle.textContent = setName;
  setDetailSummary.textContent = forceRefresh ? "Sťahujem čerstvé dáta..." : "Načítavam zoznam kariet...";
  setDetailSummary.classList.remove("complete");
  setDetailProgressFill.style.width = "0%";
  setDetailGrid.innerHTML = "";

  let items;
  try {
    items = await fetchAllSetCards(setId, setName, forceRefresh);
  } catch (err) {
    setDetailSummary.textContent = "Nepodarilo sa načítať zoznam kariet zo setu (skontroluj internetové pripojenie).";
    return;
  }
  if (!items.length) {
    setDetailSummary.textContent = "Pre tento set sa nenašli žiadne karty.";
    return;
  }
  const releaseYear = items[0].set?.releaseDate ? items[0].set.releaseDate.split("/")[0] : "";
  setDetailTitle.textContent = releaseYear ? `${setName} (${releaseYear})` : setName;
  items.sort((a, b) => (a.number || "").localeCompare(b.number || "", undefined, { numeric: true }));

  const owned = state.cards.filter(c =>
    (setId && c.set_id === setId) || (!c.set_id && c.set_name === setName)
  );
  const ownedNumbers = new Set(owned.map(c => normalizeNumber((c.number || "").split("/")[0])));

  let missingValue = 0;
  let ownedTiles = 0;
  setDetailGrid.innerHTML = "";
  items.forEach(item => {
    const isOwned = ownedNumbers.has(normalizeNumber(item.number));
    if (isOwned) ownedTiles += 1;

    const el = document.createElement("div");
    el.className = "card" + (isOwned ? "" : " missing");

    const imgWrap = document.createElement("div");
    imgWrap.className = "card-img-wrap";
    const img = document.createElement("img");
    img.className = "card-img";
    img.loading = "lazy";
    if (item.images?.small) img.src = localImg(item.images.small);
    imgWrap.appendChild(img);
    if (!isOwned) {
      const stamp = document.createElement("span");
      stamp.className = "missing-stamp";
      stamp.textContent = "?";
      imgWrap.appendChild(stamp);
    }
    el.appendChild(imgWrap);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.name;
    body.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "card-sub";
    sub.textContent = `${item.number}${item.set?.printedTotal ? "/" + item.set.printedTotal : ""}`;
    body.appendChild(sub);

    const priceRow = document.createElement("div");
    priceRow.className = "card-price-row";
    const priceEl = document.createElement("div");
    if (isOwned) {
      priceEl.className = "card-price";
      priceEl.textContent = "✔ máš";
    } else {
      priceEl.className = "card-price empty";
      const base = cardMarketPrices(item).normal;
      if (base != null) {
        const nmEst = estimatePrice(base, "NM");
        missingValue += nmEst;
        priceEl.textContent = `chýba · ≈ ${eur(nmEst)} (NM)`;
      } else {
        priceEl.textContent = "chýba · cena neznáma";
      }
    }
    priceRow.appendChild(priceEl);
    body.appendChild(priceRow);
    el.appendChild(body);

    if (!isOwned) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "card-add-btn";
      addBtn.textContent = "+ Pridať do zbierky";
      addBtn.addEventListener("click", () => {
        toggleSets.textContent = "📚 Moje sety";
        setsView.classList.add("hidden");
        grid.classList.remove("hidden");
        setAddFormOpen(true);
        selectCard(item);
        addForm.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      el.appendChild(addBtn);
    }

    setDetailGrid.appendChild(el);
  });

  const pct = Math.round((ownedTiles / items.length) * 100);
  setDetailProgressFill.style.width = pct + "%";
  const isComplete = ownedTiles === items.length;
  setDetailSummary.classList.toggle("complete", isComplete);
  setDetailSummary.textContent = isComplete
    ? `🎉 Set kompletný! Máš všetkých ${items.length} kariet!`
    : `${ownedTiles} / ${items.length} kariet (${pct} %)` +
      (missingValue > 0 ? ` · odhadovaná cena chýbajúcich v stave Near Mint: ≈ ${eur(missingValue)}` : "");
}

setDetailBack.addEventListener("click", () => {
  setDetail.classList.add("hidden");
});

const setDetailRefresh = document.getElementById("setDetailRefresh");
setDetailRefresh.addEventListener("click", () => {
  if (!currentSetDetail.setName) return;
  const key = setCacheKey(currentSetDetail.setId, currentSetDetail.setName);
  cacheRemove("cards::" + key);
  cacheRemove("meta::" + key);
  setMetaCache.delete(key);
  openSetDetail(currentSetDetail.setId, currentSetDetail.setName, true);
});

// ---- Aktualizácia cien z Cardmarketu pre celú zbierku ----
const refreshPrices = document.getElementById("refreshPrices");

refreshPrices.addEventListener("click", async () => {
  if (refreshPrices.disabled) return;
  const cardsToUpdate = state.cards.filter(c => c.tcg_id);
  if (!cardsToUpdate.length) {
    alert("Žiadna karta v zbierke nemá uložené ID karty (bola pridaná bez vyhľadávania), takže sa nedá automaticky aktualizovať.");
    return;
  }

  const originalLabel = refreshPrices.textContent;
  refreshPrices.disabled = true;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < cardsToUpdate.length; i++) {
    const card = cardsToUpdate[i];
    refreshPrices.textContent = `🔄 Aktualizujem ${i + 1}/${cardsToUpdate.length}...`;
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${card.tcg_id}`);
      if (res.ok) {
        const data = await res.json();
        const prices = cardMarketPrices(data.data);
        const wantReverse = card.variant === "reverse_holo";
        let base = wantReverse ? prices.reverse : prices.normal;
        if (base == null) base = wantReverse ? prices.normal : prices.reverse;
        if (base != null) {
          const newPrice = estimatePrice(base, card.condition || "NM");
          updateLocalCard(card.id, {
            price: newPrice,
            market_price: base,
            price_source: "Cardmarket (odhad)",
          });
          updated += 1;
        } else {
          failed += 1;
        }
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
    }
    // Šetrné tempo, aby appka nepálila verejné API rýchlo za sebou pre veľkú zbierku.
    await sleep(250);
  }

  refreshPrices.textContent = originalLabel;
  refreshPrices.disabled = false;
  await loadCards();
  alert(`Hotovo! Aktualizovaných kariet: ${updated}${failed ? `, nepodarilo sa: ${failed}` : ""}.`);
});

// ---- Export / import zálohy (žiadny server, tak aspoň manuálna záloha do súboru) ----
document.getElementById("exportData").addEventListener("click", () => {
  const data = JSON.stringify(readLocalCards(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pokemon-zbierka-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

const importDataBtn = document.getElementById("importDataBtn");
const importDataInput = document.getElementById("importDataInput");
importDataBtn.addEventListener("click", () => importDataInput.click());
importDataInput.addEventListener("change", async () => {
  const file = importDataInput.files[0];
  importDataInput.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error("Neplatný formát súboru");
    const replace = confirm(
      `Súbor obsahuje ${imported.length} kariet. Klikni OK ak chceš NAHRADIŤ celú aktuálnu zbierku, alebo Zrušiť ak ich chceš len PRIDAŤ k tým, čo už máš.`
    );
    if (replace) {
      writeLocalCards(imported);
    } else {
      const existing = readLocalCards();
      const withNewIds = imported.map(c => ({ ...c, id: genId() }));
      writeLocalCards(existing.concat(withNewIds));
    }
    await loadCards();
    alert("Import hotový!");
  } catch (err) {
    alert("Súbor sa nepodarilo načítať - skontroluj, či je to naozaj záloha z tejto appky.");
  }
});

// ---- Klik na nadpis hore = vždy späť na moje karty (zavrie sety/formulár) ----
document.getElementById("homeLink").addEventListener("click", () => {
  setsView.classList.add("hidden");
  grid.classList.remove("hidden");
  toggleSets.textContent = "📚 Moje sety";
  addForm.reset();
  resetAddExtras();
  setAddFormOpen(false);
  editModal.classList.add("hidden");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

loadCards();
