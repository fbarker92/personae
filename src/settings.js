// Persisted user settings (userData/settings.json). The main process owns them; the window reads and edits via IPC.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // appearance
  mode: 'system', // system | dark | light
  theme: 'steam', // an official theme id, or a custom theme's id
  customThemes: [], // [{ id, name, accent, base, play }]
  compact: false,
  showLoginNames: true,
  // switching
  afterSwitch: 'stay', // stay | minimise | tray
  warnInGame: true,
  launchArgs: '',
  // window & tray
  closeTo: 'tray', // tray | quit
  openAtLogin: false,
  startHidden: true,
  // updates
  autoUpdate: true,
  dismissedUpdate: '', // version whose banner the user closed
  // bookkeeping
  hiddenAccounts: [],
  trayHintShown: false,
};

const ENUMS = {
  mode: ['system', 'dark', 'light'],
  afterSwitch: ['stay', 'minimise', 'tray'],
  closeTo: ['tray', 'quit'],
};

const HEX = /^#[0-9a-f]{6}$/i;

function sanitizeTheme(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string') return null;
  if (![t.accent, t.base, t.play].every(c => HEX.test(c))) return null;
  return { id: t.id.slice(0, 40), name: String(t.name || 'Custom').slice(0, 24), accent: t.accent, base: t.base, play: t.play };
}

function sanitize(input) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = input[key];
    if (value === undefined) continue;
    const def = DEFAULTS[key];
    if (ENUMS[key]) { if (ENUMS[key].includes(value)) out[key] = value; }
    else if (key === 'customThemes') out[key] = Array.isArray(value) ? value.map(sanitizeTheme).filter(Boolean).slice(0, 30) : def;
    else if (key === 'hiddenAccounts') out[key] = Array.isArray(value) ? value.map(String).filter(id => /^\d{17}$/.test(id)) : def;
    else if (typeof def === 'boolean') out[key] = Boolean(value);
    else if (typeof def === 'string') out[key] = String(value).slice(0, 300);
  }
  return out;
}

let cache;
const file = () => path.join(app.getPath('userData'), 'settings.json');

function get() {
  if (!cache) {
    try { cache = sanitize(JSON.parse(fs.readFileSync(file(), 'utf8'))); } catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}

function update(patch) {
  cache = sanitize({ ...get(), ...patch });
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch {}
  return cache;
}

// Appearance and behaviour go back to defaults; custom themes, hidden accounts and one-off hints are kept.
function reset() {
  const { customThemes, hiddenAccounts, trayHintShown, dismissedUpdate } = get();
  return update({ ...DEFAULTS, customThemes, hiddenAccounts, trayHintShown, dismissedUpdate });
}

module.exports = { get, update, reset, DEFAULTS };
