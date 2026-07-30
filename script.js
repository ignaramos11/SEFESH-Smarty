/* =========================================
   SEFESH — Frontend App (Vanilla)
   - Estado central + persistencia (localStorage)
   - UI de modales (sin prompt/alert)
   - ESP32 REST (timeout + fallback a simulación)
   - Motor de estado de Smarty (eco vs alerta)
========================================= */

const STORAGE_KEY = "sefesh_state_v2";
const OPENMOJI_CDN = "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg";

const SHOP_ITEMS = [
  { id: "hat", name: "Sombrero Clásico", price: 200, accessory: "hat", asset: "1F3A9" },
  { id: "glasses", name: "Gafas Cool", price: 350, accessory: "glasses", asset: "1F576" },
  { id: "crown", name: "Corona Real", price: 500, accessory: "crown", asset: "1F451" },
  { id: "bow", name: "Lazo Neón", price: 150, accessory: "bow", asset: "1F380" },
  { id: "aura", name: "Aura Neón", price: 420, accessory: "aura" },
  { id: "techbg", name: "Fondo Tecnológico", price: 460, accessory: "techbg", asset: "1F9EC" },
];

const ZONES = [
  { id: "living", label: "Aula / Living", watts: 120 },
  { id: "lights", label: "Luces", watts: 80 },
  { id: "climate", label: "Climatización", watts: 260 },
  { id: "standby", label: "Standby", watts: 60 },
];

const SMARTY_PHRASES_ECO = [
  "Modo ahorro activado. ¡Excelente!",
  "Menos consumo, más planeta.",
  "EcoPuntos en camino…",
  "Todo bajo control. Fluido y eficiente.",
];

const SMARTY_PHRASES_ALERT = [
  "Alerta: consumo elevado. ¿Optimizamos zonas?",
  "Detecto demasiadas cargas activas.",
  "Te conviene pasar a Modo Eco o apagar standby.",
  "Consumo alto: priorizá luces y clima.",
];

const SMARTY_PHRASES_NEUTRAL = [
  "Listo para sincronizar con el ESP32.",
  "Podés activar Modo Eco Automático.",
  "Simulación activa: configurá el host del ESP32.",
];

function buildSmartySpeech(mood) {
  const powerW = Math.round(state.energy.powerW);
  const coins = state.coins.toLocaleString("es-AR");

  if (mood === "alert") {
    const activeZones = ZONES.filter((zone) => Boolean(state.zones[zone.id])).length;
    return `¡Atención! ${powerW}W y ${activeZones} zonas activas: apagá lo que no uses.`;
  }

  if (mood === "eco") {
    return `¡Hola! ${powerW}W de consumo es excelente, con ${coins} EcoPuntos seguimos ahorrando.`;
  }

  return `Listo para seguir. ${powerW}W de referencia y ${coins} EcoPuntos en juego.`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function nowISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function safeInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getDefaultState() {
  return {
    version: 2,
    lastScreen: "home",
    user: {
      name: "",
      level: 1,
      xp: 0,
      streak: 0,
      lastRewardDate: "",
    },
    coins: 2450,
    esp32: {
      host: "",
      online: false,
      mode: "auto",
      lastSeenAt: 0,
    },
    zones: {
      living: false,
      lights: false,
      climate: false,
      standby: false,
    },
    inventory: {
      owned: [],
      equipped: "",
    },
    energy: {
      powerW: 0,
      savingsPct: 0,
      projectedCost: 0,
      goalPct: 0,
    },
    missions: {
      daily: {
        date: nowISODate(),
        target: 3,
        done: 0,
        reward: 120,
        claimed: false,
      },
      questEcoMinutes: {
        date: nowISODate(),
        target: 5,
        done: 0,
        reward: 80,
        running: false,
        claimed: false,
        startedAt: 0,
        lastTickAt: 0,
      },
    },
    analytics: {
      weekKwh: [2.4, 2.0, 2.2, 1.6, 2.8, 2.1, 1.9],
    },
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return getDefaultState();
  try {
    const parsed = JSON.parse(raw);
    return mergeState(getDefaultState(), parsed);
  } catch {
    return getDefaultState();
  }
}

function mergeState(base, incoming) {
  if (!incoming || typeof incoming !== "object") return base;
  const out = structuredClone(base);

  out.lastScreen = typeof incoming.lastScreen === "string" ? incoming.lastScreen : out.lastScreen;

  if (incoming.user && typeof incoming.user === "object") {
    out.user.name = typeof incoming.user.name === "string" ? incoming.user.name : out.user.name;
    out.user.level = clamp(safeInt(incoming.user.level, out.user.level), 1, 99);
    out.user.xp = Math.max(0, safeInt(incoming.user.xp, out.user.xp));
    out.user.streak = Math.max(0, safeInt(incoming.user.streak, out.user.streak));
    out.user.lastRewardDate = typeof incoming.user.lastRewardDate === "string" ? incoming.user.lastRewardDate : out.user.lastRewardDate;
  }

  out.coins = safeInt(incoming.coins, out.coins);

  if (incoming.esp32 && typeof incoming.esp32 === "object") {
    out.esp32.host = typeof incoming.esp32.host === "string" ? incoming.esp32.host : out.esp32.host;
    out.esp32.mode = incoming.esp32.mode === "manual" ? "manual" : "auto";
    out.esp32.online = Boolean(incoming.esp32.online);
    out.esp32.lastSeenAt = safeInt(incoming.esp32.lastSeenAt, 0);
  }

  if (incoming.zones && typeof incoming.zones === "object") {
    for (const z of ZONES) {
      out.zones[z.id] = Boolean(incoming.zones[z.id]);
    }
  }

  if (incoming.inventory && typeof incoming.inventory === "object") {
    out.inventory.owned = Array.isArray(incoming.inventory.owned) ? incoming.inventory.owned.filter(Boolean) : out.inventory.owned;
    out.inventory.equipped = typeof incoming.inventory.equipped === "string" ? incoming.inventory.equipped : out.inventory.equipped;
  }

  if (incoming.missions && typeof incoming.missions === "object") {
    if (incoming.missions.daily && typeof incoming.missions.daily === "object") {
      out.missions.daily.date = typeof incoming.missions.daily.date === "string" ? incoming.missions.daily.date : out.missions.daily.date;
      out.missions.daily.target = safeInt(incoming.missions.daily.target, out.missions.daily.target);
      out.missions.daily.done = safeInt(incoming.missions.daily.done, out.missions.daily.done);
      out.missions.daily.reward = safeInt(incoming.missions.daily.reward, out.missions.daily.reward);
      out.missions.daily.claimed = Boolean(incoming.missions.daily.claimed);
    }

    if (incoming.missions.questEcoMinutes && typeof incoming.missions.questEcoMinutes === "object") {
      out.missions.questEcoMinutes.date =
        typeof incoming.missions.questEcoMinutes.date === "string" ? incoming.missions.questEcoMinutes.date : out.missions.questEcoMinutes.date;
      out.missions.questEcoMinutes.target = safeInt(incoming.missions.questEcoMinutes.target, out.missions.questEcoMinutes.target);
      out.missions.questEcoMinutes.done = safeInt(incoming.missions.questEcoMinutes.done, out.missions.questEcoMinutes.done);
      out.missions.questEcoMinutes.reward = safeInt(incoming.missions.questEcoMinutes.reward, out.missions.questEcoMinutes.reward);
      out.missions.questEcoMinutes.running = Boolean(incoming.missions.questEcoMinutes.running);
      out.missions.questEcoMinutes.claimed = Boolean(incoming.missions.questEcoMinutes.claimed);
      out.missions.questEcoMinutes.startedAt = safeInt(incoming.missions.questEcoMinutes.startedAt, 0);
      out.missions.questEcoMinutes.lastTickAt = safeInt(incoming.missions.questEcoMinutes.lastTickAt, 0);
    }
  }

  if (incoming.analytics && typeof incoming.analytics === "object") {
    if (Array.isArray(incoming.analytics.weekKwh) && incoming.analytics.weekKwh.length === 7) {
      out.analytics.weekKwh = incoming.analytics.weekKwh.map((v) => safeNumber(v, 0));
    }
  }

  return out;
}

let state = loadState();
let saveTimer = 0;

function persistSoon() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveTimer = 0;
  }, 120);
}

function resetAll() {
  state = getDefaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.location.reload();
}

function getBaseUrl(host) {
  const raw = (host || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/+$/, "");
  return `http://${raw}`.replace(/\/+$/, "");
}

async function fetchWithTimeout(url, { timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return res;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function esp32Status() {
  const base = getBaseUrl(state.esp32.host);
  if (!base) throw new Error("HOST_EMPTY");
  const res = await fetchWithTimeout(`${base}/status`, { timeoutMs: 2200 });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data;
}

async function esp32Control(zoneId, nextState) {
  const base = getBaseUrl(state.esp32.host);
  if (!base) throw new Error("HOST_EMPTY");
  const url = `${base}/control?zone=${encodeURIComponent(zoneId)}&state=${nextState ? 1 : 0}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 2000 });
  return res.ok;
}

function toast({ title, message, variant = "ok" }) {
  const host = document.getElementById("toastHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = `toast${variant === "alert" ? " is-alert" : ""}`;

  const ic = document.createElement("div");
  ic.className = "toast-ic";
  ic.textContent = variant === "alert" ? "⚠️" : "✅";

  const body = document.createElement("div");
  const t = document.createElement("div");
  t.className = "toast-title";
  t.textContent = title;

  const m = document.createElement("div");
  m.className = "toast-msg";
  m.textContent = message;

  body.appendChild(t);
  body.appendChild(m);
  el.appendChild(ic);
  el.appendChild(body);
  host.appendChild(el);

  window.setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translate3d(0, 8px, 0)";
    el.style.transition = "opacity 220ms ease, transform 220ms ease";
  }, 2600);

  window.setTimeout(() => {
    el.remove();
  }, 3100);
}

function openModal({ title, templateId, onMount }) {
  const backdrop = document.getElementById("modalBackdrop");
  const titleEl = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  if (!backdrop || !titleEl || !body) return;

  titleEl.textContent = title;
  body.innerHTML = "";

  const tpl = document.getElementById(templateId);
  if (tpl && "content" in tpl) {
    const node = tpl.content.cloneNode(true);
    body.appendChild(node);
  }

  backdrop.hidden = false;
  if (typeof onMount === "function") onMount(body);
}

function closeModal() {
  const backdrop = document.getElementById("modalBackdrop");
  const body = document.getElementById("modalBody");
  if (!backdrop || !body) return;
  backdrop.hidden = true;
  body.innerHTML = "";
}

function ensureDailyReset() {
  const today = nowISODate();

  if (state.missions.daily.date !== today) {
    state.missions.daily.date = today;
    state.missions.daily.done = 0;
    state.missions.daily.claimed = false;
  }

  if (state.missions.questEcoMinutes.date !== today) {
    state.missions.questEcoMinutes.date = today;
    state.missions.questEcoMinutes.done = 0;
    state.missions.questEcoMinutes.running = false;
    state.missions.questEcoMinutes.claimed = false;
    state.missions.questEcoMinutes.startedAt = 0;
    state.missions.questEcoMinutes.lastTickAt = 0;
  }
}

function xpNeededForLevel(level = state.user.level) {
  return 250 + (clamp(level, 1, 99) - 1) * 100;
}

function accountRewardMultiplier() {
  const levelBonus = Math.min(Math.max(state.user.level - 1, 0), 20) * 0.05;
  const streakBonus = Math.min(state.user.streak, 7) * 0.02;
  return 1 + levelBonus + streakBonus;
}

function rewardFor(baseReward) {
  return Math.round(baseReward * accountRewardMultiplier());
}

function updateStreakForDailyReward() {
  const today = nowISODate();
  if (state.user.lastRewardDate === today) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const offset = yesterday.getTimezoneOffset() * 60_000;
  const yesterdayKey = new Date(yesterday.getTime() - offset).toISOString().slice(0, 10);
  state.user.streak = state.user.lastRewardDate === yesterdayKey ? state.user.streak + 1 : 1;
  state.user.lastRewardDate = today;
}

function grantAccountReward(baseReward, { daily = false } = {}) {
  if (daily) updateStreakForDailyReward();

  const coins = rewardFor(baseReward);
  const xpEarned = Math.max(10, Math.round(coins / 2));
  state.coins += coins;
  state.user.xp += xpEarned;

  let levelsGained = 0;
  while (state.user.level < 99 && state.user.xp >= xpNeededForLevel()) {
    state.user.xp -= xpNeededForLevel();
    state.user.level += 1;
    levelsGained += 1;
  }

  return { coins, xpEarned, levelsGained };
}

function computeEnergyFromZones() {
  const onCount = ZONES.reduce((acc, z) => acc + (state.zones[z.id] ? 1 : 0), 0);
  const watts = ZONES.reduce((acc, z) => acc + (state.zones[z.id] ? z.watts : 0), 0);

  const baseW = 40;
  const powerW = baseW + watts;

  const savingsPct = clamp(100 - onCount * 18, 0, 100);
  const projectedCost = Math.round(((powerW / 1000) * 0.22 * 30) * 100) / 100;
  const goalPct = clamp(Math.round((savingsPct / 100) * 100), 0, 100);

  state.energy.powerW = powerW;
  state.energy.savingsPct = savingsPct;
  state.energy.projectedCost = projectedCost;
  state.energy.goalPct = goalPct;
}

function updateSmartyMood() {
  const onCount = ZONES.reduce((acc, z) => acc + (state.zones[z.id] ? 1 : 0), 0);
  const smarty = document.getElementById("smarty");
  const chip = document.getElementById("uiSmartyChip");
  const speech = document.getElementById("uiSpeech");
  if (!smarty || !chip || !speech) return;

  const online = state.esp32.online;
  let mood = "neutral";
  if (onCount >= 3) mood = "alert";
  else if (onCount <= 1) mood = "eco";
  else mood = online ? "eco" : "neutral";

  smarty.dataset.mood = mood;
  chip.classList.toggle("is-alert", mood === "alert");
  chip.textContent = mood === "alert" ? "Alerta Consumo" : "Modo Ahorro";

  let phrase = buildSmartySpeech(mood);
  if (mood === "alert") {
    phrase = `${SMARTY_PHRASES_ALERT[Math.floor(Math.random() * SMARTY_PHRASES_ALERT.length)]} ${buildSmartySpeech(mood)}`;
  } else if (mood === "eco") {
    phrase = `${SMARTY_PHRASES_ECO[Math.floor(Math.random() * SMARTY_PHRASES_ECO.length)]} ${buildSmartySpeech(mood)}`;
  } else {
    phrase = `${SMARTY_PHRASES_NEUTRAL[Math.floor(Math.random() * SMARTY_PHRASES_NEUTRAL.length)]} ${buildSmartySpeech(mood)}`;
  }

  speech.textContent = phrase;
}

function reactSmarty() {
  const smarty = document.getElementById("smarty");
  if (!smarty) return;
  smarty.classList.add("is-reacting");
  window.setTimeout(() => smarty.classList.remove("is-reacting"), 560);
}

function applyAccessory() {
  const equipped = state.inventory.equipped;
  const nodes = document.querySelectorAll(".accessory");
  nodes.forEach((n) => {
    const key = n.getAttribute("data-accessory") || "";
    n.classList.toggle("is-active", key === equipped);
  });
}

function updateHeaderUI() {
  const name = (state.user.name || "").trim();
  const avatarInitial = document.getElementById("uiAvatarInitial");
  const level = document.getElementById("uiLevel");
  const greeting = document.getElementById("uiGreeting");
  const coins = document.getElementById("uiCoins");
  const connPill = document.getElementById("uiConnPill");
  const connText = document.getElementById("uiConnText");

  if (avatarInitial) avatarInitial.textContent = name ? name.slice(0, 1).toUpperCase() : "U";
  if (level) level.textContent = String(clamp(state.user.level, 1, 99));
  if (greeting) greeting.textContent = name ? `Hola, ${name}` : "Hola";
  if (coins) coins.textContent = state.coins.toLocaleString("es-AR");

  if (connPill && connText) {
    connPill.classList.toggle("is-online", state.esp32.online);
    connText.textContent = state.esp32.online ? "ESP32 Online" : "Modo Simulación";
  }
}

function updateAccountUI() {
  const multiplier = document.getElementById("uiRewardMultiplier");
  const streak = document.getElementById("uiStreak");
  const xp = document.getElementById("uiXp");
  const xpNext = document.getElementById("uiXpNext");
  const xpFill = document.getElementById("uiXpFill");
  const needed = xpNeededForLevel();

  if (multiplier) multiplier.textContent = `x${accountRewardMultiplier().toFixed(2)}`;
  if (streak) streak.textContent = String(state.user.streak);
  if (xp) xp.textContent = String(state.user.xp);
  if (xpNext) xpNext.textContent = String(needed);
  if (xpFill) xpFill.style.width = `${clamp((state.user.xp / needed) * 100, 0, 100)}%`;
}

function updateDashboardUI() {
  const power = document.getElementById("uiPower");
  const savings = document.getElementById("uiSavings");
  const cost = document.getElementById("uiCost");
  const goalText = document.getElementById("uiGoalText");
  const goalFill = document.getElementById("uiGoalFill");

  if (power) power.textContent = String(Math.round(state.energy.powerW));
  if (savings) savings.textContent = String(Math.round(state.energy.savingsPct));
  if (cost) cost.textContent = String(state.energy.projectedCost.toFixed(2));
  if (goalText) goalText.textContent = `${Math.round(state.energy.goalPct)}%`;
  if (goalFill) goalFill.style.width = `${clamp(state.energy.goalPct, 0, 100)}%`;
}

function updateZonesUI() {
  const zonesActive = document.getElementById("uiZonesActive");
  const estimated = document.getElementById("uiEstimatedLoad");
  const modeLabel = document.getElementById("uiModeLabel");
  const fill = document.getElementById("uiLoadFill");

  const onCount = ZONES.reduce((acc, z) => acc + (state.zones[z.id] ? 1 : 0), 0);
  const watts = state.energy.powerW;

  if (zonesActive) zonesActive.textContent = String(onCount);
  if (estimated) estimated.textContent = String(Math.round(watts));
  if (modeLabel) modeLabel.textContent = state.esp32.mode === "manual" ? "Manual" : "Eco automático";
  if (fill) fill.style.width = `${clamp((watts / 480) * 100, 0, 100)}%`;

  const segmented = document.querySelectorAll(".segmented-btn");
  segmented.forEach((btn) => {
    const mode = btn.getAttribute("data-mode");
    const active = mode === state.esp32.mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  const rows = document.querySelectorAll(".zone");
  rows.forEach((row) => {
    const z = row.getAttribute("data-zone");
    if (!z) return;
    const input = row.querySelector(".toggle-input");
    if (input) input.checked = Boolean(state.zones[z]);
  });
}

function updateMissionsUI() {
  const d = state.missions.daily;
  const fill = document.getElementById("uiMissionFill");
  const text = document.getElementById("uiMissionText");
  const reward = document.getElementById("uiMissionReward");

  if (reward) reward.textContent = String(rewardFor(d.reward));
  if (fill) fill.style.width = `${clamp((d.done / d.target) * 100, 0, 100)}%`;
  if (text) text.textContent = `${clamp(d.done, 0, d.target)}/${d.target} completados`;

  const q = state.missions.questEcoMinutes;
  const qFill = document.getElementById("uiQuestFill");
  const qText = document.getElementById("uiQuestText");
  if (qFill) qFill.style.width = `${clamp((q.done / q.target) * 100, 0, 100)}%`;
  if (qText) qText.textContent = `${clamp(q.done, 0, q.target)}/${q.target} min`;

  const questReward = document.getElementById("uiQuestReward");
  if (questReward) questReward.textContent = `+${rewardFor(q.reward)} 🪙`;

  const start = document.getElementById("startQuestBtn");
  if (start) start.textContent = q.running ? "En curso" : "Iniciar";
}

function updateShopUI() {
  const grid = document.getElementById("shopGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const owned = new Set(state.inventory.owned);
  for (const item of SHOP_ITEMS) {
    const el = document.createElement("div");
    el.className = "shop-item";

    const icon = createAccessoryIcon(item);

    const name = document.createElement("div");
    name.className = "shop-name";
    name.textContent = item.name;

    const price = document.createElement("div");
    price.className = "shop-price";
    price.textContent = `${item.price} 🪙`;

    const actions = document.createElement("div");
    actions.className = "shop-actions";

    const primary = document.createElement("button");
    primary.className = "btn btn--primary";
    primary.type = "button";

    const isOwned = owned.has(item.id);
    const isEquipped = state.inventory.equipped === item.accessory;
    primary.textContent = isOwned ? (isEquipped ? "Equipado" : "Equipar") : "Comprar";

    primary.addEventListener("click", () => {
      if (!isOwned) {
        buyItem(item.id);
      } else {
        equipAccessory(item.accessory);
      }
    });

    actions.appendChild(primary);
    el.appendChild(icon);
    el.appendChild(name);
    el.appendChild(price);
    el.appendChild(actions);
    grid.appendChild(el);
  }
}

function createAccessoryIcon(item) {
  const wrapper = document.createElement("div");
  wrapper.className = "shop-accessory-icon";

  if (item.accessory === "aura") {
    const aura = document.createElement("div");
    aura.className = "shop-accessory-icon__aura";
    wrapper.appendChild(aura);
    return wrapper;
  }

  const icon = document.createElement("img");
  icon.src = `${OPENMOJI_CDN}/${item.asset}.svg`;
  icon.alt = "";
  icon.decoding = "async";
  wrapper.appendChild(icon);
  return wrapper;
}

function updateAnalyticsUI() {
  const host = document.getElementById("weekChart");
  const total = document.getElementById("uiWeekTotal");
  if (!host) return;
  host.innerHTML = "";

  const days = ["L", "M", "X", "J", "V", "S", "D"];
  const values = state.analytics.weekKwh.map((v) => safeNumber(v, 0));
  const max = Math.max(0.1, ...values);
  const sum = values.reduce((a, b) => a + b, 0);

  if (total) total.textContent = sum.toFixed(1);

  for (let i = 0; i < 7; i += 1) {
    const col = document.createElement("div");
    col.className = "chart-col";

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.setProperty("--h", String(clamp((values[i] / max) * 100, 4, 100)));

    const label = document.createElement("div");
    label.className = "chart-label";
    label.textContent = days[i];

    col.appendChild(bar);
    col.appendChild(label);
    host.appendChild(col);
  }
}

function setScreen(screen) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach((s) => {
    const isActive = s.getAttribute("data-screen") === screen;
    s.classList.toggle("is-active", isActive);
  });

  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-target") === screen));

  const indicator = document.getElementById("navIndicator");
  const nav = document.querySelector(".bottombar");
  if (indicator && nav) {
    const activeIndex = Array.from(navItems).findIndex((b) => b.getAttribute("data-target") === screen);
    const usable = nav.clientWidth - 20;
    const segment = usable / 4;
    const x = Math.max(0, activeIndex) * segment;
    indicator.style.setProperty("--indicator-x", `${Math.round(x)}px`);
  }

  state.lastScreen = screen;
  persistSoon();
}

function buyItem(itemId) {
  const item = SHOP_ITEMS.find((x) => x.id === itemId);
  if (!item) return;

  if (state.coins < item.price) {
    toast({
      title: "EcoPuntos insuficientes",
      message: "Completá misiones o apagá zonas para ganar más.",
      variant: "alert",
    });
    return;
  }

  state.coins -= item.price;
  if (!state.inventory.owned.includes(item.id)) state.inventory.owned.push(item.id);
  state.inventory.equipped = item.accessory;

  reactSmarty();
  applyAccessory();
  computeEnergyFromZones();
  updateSmartyMood();
  persistSoon();

  updateHeaderUI();
  updateShopUI();
  toast({ title: "Compra exitosa", message: `Equipado: ${item.name}` });
}

function equipAccessory(accessoryKey) {
  if (!accessoryKey) return;

  const owns = new Set(state.inventory.owned);
  const item = SHOP_ITEMS.find((x) => x.accessory === accessoryKey);
  if (item && !owns.has(item.id)) {
    toast({ title: "No disponible", message: "Primero tenés que comprar este accesorio.", variant: "alert" });
    return;
  }

  state.inventory.equipped = accessoryKey;
  applyAccessory();
  reactSmarty();
  persistSoon();
  updateShopUI();
  toast({ title: "Listo", message: "Smarty actualizado." });
}

function onZoneToggle(zoneId, nextValue) {
  const prev = Boolean(state.zones[zoneId]);
  state.zones[zoneId] = nextValue;

  computeEnergyFromZones();
  updateSmartyMood();
  updateDashboardUI();
  updateZonesUI();
  persistSoon();

  if (prev && !nextValue) {
    progressDailyMission();
  }

  if (state.esp32.mode === "manual" && state.esp32.online) {
    esp32Control(zoneId, nextValue).catch(() => {
      state.esp32.online = false;
      persistSoon();
      updateHeaderUI();
      toast({ title: "ESP32 sin respuesta", message: "Volviendo a simulación.", variant: "alert" });
    });
  }

  reactSmarty();
}

function progressDailyMission() {
  const d = state.missions.daily;
  if (d.claimed) return;
  if (d.done >= d.target) return;

  d.done += 1;
  updateMissionsUI();
  persistSoon();

  if (d.done >= d.target && !d.claimed) {
    d.claimed = true;
    const earned = grantAccountReward(d.reward, { daily: true });
    persistSoon();
    updateHeaderUI();
    updateAccountUI();
    updateMissionsUI();
    toast({ title: "Misión completada", message: `Recompensa: +${earned.coins} 🪙 y ${earned.xpEarned} XP${earned.levelsGained ? ". ¡Subiste de nivel!" : ""}` });
  }
}

function startQuestIfPossible() {
  const q = state.missions.questEcoMinutes;
  if (q.claimed) return;
  if (q.running) return;

  q.running = true;
  q.startedAt = Date.now();
  q.lastTickAt = Date.now();
  persistSoon();
  updateMissionsUI();
  toast({ title: "Quest iniciada", message: "Mantén Modo Eco activo para progresar." });
}

function tickQuest() {
  const q = state.missions.questEcoMinutes;
  if (!q.running) return;
  if (q.claimed) return;

  if (state.esp32.mode !== "auto") return;

  const now = Date.now();
  if (now - q.lastTickAt < 60_000) return;
  q.lastTickAt = now;

  q.done = clamp(q.done + 1, 0, q.target);
  updateMissionsUI();
  persistSoon();

  if (q.done >= q.target && !q.claimed) {
    q.running = false;
    q.claimed = true;
    const earned = grantAccountReward(q.reward);
    persistSoon();
    updateHeaderUI();
    updateAccountUI();
    updateMissionsUI();
    toast({ title: "Quest completada", message: `Recompensa: +${earned.coins} 🪙 y ${earned.xpEarned} XP${earned.levelsGained ? ". ¡Subiste de nivel!" : ""}` });
  }
}

async function syncFromEsp32({ silent = false } = {}) {
  try {
    const data = await esp32Status();
    state.esp32.online = true;
    state.esp32.lastSeenAt = Date.now();

    if (data && typeof data === "object") {
      if (data.zones && typeof data.zones === "object") {
        for (const z of ZONES) {
          const v = data.zones[z.id];
          if (v === 0 || v === 1 || v === false || v === true) state.zones[z.id] = Boolean(v);
        }
      }
      if (typeof data.powerW === "number") state.energy.powerW = safeNumber(data.powerW, state.energy.powerW);
    }

    computeEnergyFromZones();
    updateHeaderUI();
    updateZonesUI();
    updateDashboardUI();
    updateSmartyMood();
    persistSoon();

    if (!silent) toast({ title: "Sincronizado", message: "Datos actualizados desde ESP32." });
  } catch {
    if (state.esp32.online) {
      state.esp32.online = false;
      persistSoon();
      updateHeaderUI();
    }
    if (!silent) toast({ title: "Modo simulación", message: "ESP32 no disponible o sin CORS.", variant: "alert" });
  }
}

function openLogin() {
  openModal({
    title: "Inicio",
    templateId: "tplLogin",
    onMount: (body) => {
      const form = body.querySelector('[data-form="login"]');
      const name = form?.querySelector('input[name="name"]');
      if (name) name.focus();

      form?.addEventListener("submit", (e) => {
        e.preventDefault();
        const nextName = (name?.value || "").trim() || "EcoUsuario";

        state.user.name = nextName;
        state.user.level = 1;
        state.user.xp = 0;
        state.user.streak = 0;
        state.user.lastRewardDate = "";
        localStorage.setItem(
          "sefesh_user",
          JSON.stringify({
            name: nextName,
            level: 1,
            xp: 0,
          }),
        );
        persistSoon();
        closeModal();
        toast({ title: "Bienvenido", message: `Perfil listo, ${nextName}.` });
        renderAll();
      });
    },
  });
}

function openSettings() {
  openModal({
    title: "Configuración",
    templateId: "tplSettings",
    onMount: (body) => {
      const form = body.querySelector('[data-form="settings"]');
      const name = form?.querySelector('input[name="name"]');
      const host = form?.querySelector('input[name="esp32Host"]');
      const coins = form?.querySelector('input[name="coins"]');
      const resetBtn = form?.querySelector('[data-action="reset"]');

      if (name) name.value = state.user.name;
      if (host) host.value = state.esp32.host;
      if (coins) coins.value = String(state.coins);

      resetBtn?.addEventListener("click", () => resetAll());

      form?.addEventListener("submit", (e) => {
        e.preventDefault();
        state.user.name = (name?.value || "").trim();
        state.esp32.host = (host?.value || "").trim();
        state.coins = clamp(safeInt(coins?.value, state.coins), 0, 9_999_999);
        persistSoon();
        closeModal();
        renderAll();
        syncFromEsp32({ silent: true });
        toast({ title: "Guardado", message: "Preferencias actualizadas." });
      });
    },
  });
}

function openInventory() {
  openModal({
    title: "Inventario",
    templateId: "tplInventory",
    onMount: (body) => {
      const grid = body.querySelector("#inventoryGrid");
      if (!grid) return;
      grid.innerHTML = "";

      const owned = new Set(state.inventory.owned);
      const items = SHOP_ITEMS.filter((x) => owned.has(x.id));

      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "panel-sub";
        empty.textContent = "Todavía no compraste accesorios.";
        grid.appendChild(empty);
        return;
      }

      for (const it of items) {
        const card = document.createElement("div");
        card.className = "inventory-item";

        const top = createAccessoryIcon(it);

        const name = document.createElement("div");
        name.className = "shop-name";
        name.textContent = it.name;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--primary";
        btn.textContent = state.inventory.equipped === it.accessory ? "Equipado" : "Equipar";
        btn.addEventListener("click", () => {
          equipAccessory(it.accessory);
          closeModal();
        });

        card.appendChild(top);
        card.appendChild(name);
        card.appendChild(btn);
        grid.appendChild(card);
      }
    },
  });
}

function bindEvents() {
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);
  document.getElementById("modalBackdrop")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "modalBackdrop") closeModal();
  });

  document.getElementById("settingsBtn")?.addEventListener("click", openSettings);
  document.getElementById("profileBtn")?.addEventListener("click", openSettings);
  document.getElementById("inventoryBtn")?.addEventListener("click", openInventory);

  document.getElementById("missionHintBtn")?.addEventListener("click", () => {
    toast({ title: "Tip", message: "Apagá standby o luces cuando no se usan. EcoPuntos asegurados." });
  });

  document.getElementById("startQuestBtn")?.addEventListener("click", startQuestIfPossible);

  document.getElementById("syncBtn")?.addEventListener("click", () => {
    syncFromEsp32({ silent: false });
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      setScreen(target);
    });
  });

  document.querySelectorAll(".segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");
      state.esp32.mode = mode === "manual" ? "manual" : "auto";
      persistSoon();
      updateZonesUI();
      toast({
        title: "Modo actualizado",
        message: state.esp32.mode === "manual" ? "Control manual activado." : "Eco automático activado.",
      });
    });
  });

  document.querySelectorAll(".zone").forEach((row) => {
    const zoneId = row.getAttribute("data-zone");
    if (!zoneId) return;

    const input = row.querySelector(".toggle-input");
    input?.addEventListener("change", () => onZoneToggle(zoneId, Boolean(input.checked)));
  });
}

function renderAll() {
  ensureDailyReset();
  computeEnergyFromZones();

  updateHeaderUI();
  updateAccountUI();
  updateDashboardUI();
  updateZonesUI();
  updateMissionsUI();
  updateShopUI();
  updateAnalyticsUI();
  applyAccessory();
  updateSmartyMood();

  setScreen(state.lastScreen || "home");
}

function startPolling() {
  window.setInterval(() => {
    tickQuest();
    if (state.esp32.host) syncFromEsp32({ silent: true });
  }, 10_000);
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  renderAll();
  startPolling();

  if (!state.user.name) {
    openLogin();
    return;
  }

  if (state.esp32.host) {
    syncFromEsp32({ silent: true });
  } else {
    toast({ title: "Simulación activa", message: "Configura el host del ESP32 en ⚙️ para datos reales." });
  }
});
