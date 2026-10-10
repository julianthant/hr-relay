const STORAGE_KEY = "duoCredentials";
const SETTINGS_KEY = "settings";

const $ = (id) => document.getElementById(id);

// ── inline SVG icons (single family, 1.8 stroke) for JS-rendered rows ──
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const SHIELD = '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/>';
const ICONS = {
  shieldCheck: svg(SHIELD + '<path d="m9 12 2 2 4-4"/>'),
  shieldSlash: svg(SHIELD + '<path d="m9.5 9.5 5 5"/><path d="m14.5 9.5-5 5"/>'),
  shieldAlert: svg(SHIELD + '<path d="M12 8v3.5"/><path d="M12 15h.01"/>'),
  fingerprint: svg(
    '<path d="M12 10a2 2 0 0 0-2 2c0 1.5-.2 3.4-.6 4.8"/>' +
      '<path d="M8.5 7.5A5 5 0 0 1 16 12c0 1 .1 2.2.3 3.2"/>' +
      '<path d="M6.5 12a5.5 5.5 0 0 1 .8-3"/>' +
      '<path d="M12 6a6 6 0 0 1 6 6c0 .8 0 2 .2 3"/>' +
      '<path d="M13.5 19c.3-1.2.5-2.8.5-4"/>',
  ),
  key: svg('<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9.5 9.5"/><path d="m16.5 16.5 2-2"/><path d="m19 19 1.5-1.5"/>'),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]),
  );
}

function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
  if (kind === "err") el.setAttribute("role", "alert");
  else el.removeAttribute("role");
}

// ── storage helpers ──
async function loadStored() {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}
async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const s = data[SETTINGS_KEY] || {};
  return { enabled: s.enabled !== false, trustClick: s.trustClick !== false, toast: s.toast !== false };
}
async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
// ── rendering ──
function renderHero(creds, settings) {
  const hero = $("hero");
  hero.classList.remove("armed", "off", "empty");
  if (creds.length === 0) {
    hero.classList.add("empty");
    $("heroGlyph").innerHTML = ICONS.shieldAlert;
    $("heroState").textContent = "No credential";
    $("heroReason").textContent = "Relay provisions the credential when this browser starts.";
  } else if (!settings.enabled) {
    hero.classList.add("off");
    $("heroGlyph").innerHTML = ICONS.shieldSlash;
    $("heroState").textContent = "Autopilot off";
    $("heroReason").textContent = "Duo prompts fall back to your phone.";
  } else {
    hero.classList.add("armed");
    $("heroGlyph").innerHTML = ICONS.shieldCheck;
    $("heroState").textContent = "Armed";
    $("heroReason").textContent = `${creds.length} credential${creds.length > 1 ? "s" : ""} ready — no phone, no touch.`;
  }
}

function renderCreds(creds) {
  const block = $("credBlock");
  const group = $("credGroup");
  if (creds.length === 0) {
    block.hidden = true;
    group.innerHTML = "";
    return;
  }
  block.hidden = false;
  group.innerHTML = creds
    .map((c) => {
      const isUsb = c.transport === "usb";
      const icon = isUsb ? ICONS.key : ICONS.fingerprint;
      const factor = isUsb ? "Security key" : "Touch ID";
      const count = Number(c.signCount).toLocaleString();
      return `<div class="row">
        <span class="ico">${icon}</span>
        <div class="row-main">
          <div class="row-title">${escapeHtml(factor)}</div>
          <div class="row-desc">${escapeHtml(c.transport)} · ${escapeHtml(c.rpId)}</div>
        </div>
        <span class="val">${count}</span>
      </div>`;
    })
    .join("");
}

function setSwitch(el, on) {
  el.setAttribute("aria-checked", on ? "true" : "false");
}
function renderToggles(s) {
  setSwitch($("tgEnabled"), s.enabled);
  setSwitch($("tgTrust"), s.trustClick);
  setSwitch($("tgToast"), s.toast);
}

async function refresh() {
  const [creds, settings] = await Promise.all([loadStored(), loadSettings()]);
  renderHero(creds, settings);
  renderCreds(creds);
  renderToggles(settings);
}

// ── toggles ──
function bindToggle(el, key) {
  el.addEventListener("click", async () => {
    const on = el.getAttribute("aria-checked") !== "true";
    setSwitch(el, on); // optimistic
    await saveSettings({ [key]: on });
    if (key === "enabled") renderHero(await loadStored(), await loadSettings());
  });
}

// ── credential actions ──
// Two-step inline confirm — no native confirm() dialog.
let clearArmed = false;
let clearTimer = null;
function resetClear() {
  clearArmed = false;
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
  $("clearLabel").textContent = "Clear credentials";
  $("actClear").classList.remove("confirming");
}
async function clearCreds() {
  if (!clearArmed) {
    clearArmed = true;
    $("clearLabel").textContent = "Tap again to confirm";
    $("actClear").classList.add("confirming");
    clearTimer = setTimeout(resetClear, 3000);
    return;
  }
  resetClear();
  await chrome.storage.session.remove(STORAGE_KEY);
  await refresh();
  setMsg($("actMsg"), "Cleared stored credentials.", "warn");
}

$("actClear").addEventListener("click", clearCreds);
bindToggle($("tgEnabled"), "enabled");
bindToggle($("tgTrust"), "trustClick");
bindToggle($("tgToast"), "toast");
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[STORAGE_KEY] || area === "local" && changes[SETTINGS_KEY]) refresh();
});
refresh();
