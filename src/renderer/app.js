const api = window.personae;
const $ = sel => document.querySelector(sel);

// Settings live in the main process; this is the window's copy, kept in sync via onSettingsChanged.
let settings = {};
let appInfo = { canOpenAtLogin: false, version: '' };

const state = {
  accounts: [],
  query: '',
  focus: -1,
  running: false,
  busy: false,
  showHidden: false,
  switchStartedHere: false,
  avatarRequested: new Set(),
};

const hiddenIds = () => new Set(settings.hiddenAccounts || []);

// ---------- helpers ----------

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(ts) {
  if (!ts) return 'Never';
  const secs = ts - Date.now() / 1000;
  for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(secs) >= n) return rtf.format(Math.round(secs / n), unit);
  }
  return 'Just now';
}

function hue(str) {
  let h = 0x811c9dc5;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  h ^= h >>> 15;
  return (Math.imul(h, 0x2c1b3c6d) >>> 0) % 360;
}

function paintAvatar(el, account) {
  const img = el.querySelector('img');
  const initials = el.querySelector('.initials');
  const h = hue(account.steamId);
  el.style.background = `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 28%))`;
  initials.textContent = (account.personaName.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  if (account.avatar) img.src = account.avatar;
  else img.removeAttribute('src');
}

const errorText = err => String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function toast(message, { error = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<svg><use href="#i-${error ? 'power' : 'check'}"/></svg><span></span>`;
  el.querySelector('span').textContent = message;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, error ? 5000 : 2600);
}

function confirmDialog({ title, body, ok }) {
  return new Promise(resolve => {
    const scrim = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = ok;
    scrim.hidden = false;
    $('#confirm-cancel').focus();

    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); } };
    const done = value => {
      scrim.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    document.addEventListener('keydown', onKey, true);
    $('#confirm-ok').onclick = () => done(true);
    $('#confirm-cancel').onclick = () => done(false);
    scrim.onclick = e => { if (e.target === scrim) done(false); };
  });
}

// ---------- theme ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
let previewTheme = null; // set by the theme editor while it's open

const isDark = () => settings.mode === 'dark' || (settings.mode !== 'light' && darkQuery.matches);

function currentTheme() {
  return previewTheme ?? allThemes(settings.customThemes).find(t => t.id === settings.theme) ?? OFFICIAL_THEMES[0];
}

let themingTimer;
function applyTheme({ animate = false } = {}) {
  const root = document.documentElement;
  const palette = resolvePalette(currentTheme(), isDark());
  if (animate) {
    document.body.classList.add('theming');
    clearTimeout(themingTimer);
    themingTimer = setTimeout(() => document.body.classList.remove('theming'), 320);
  }
  for (const [key, value] of Object.entries(palette)) root.style.setProperty(`--${key}`, value);
  root.dataset.mode = isDark() ? 'dark' : 'light';
  api.setChrome({ color: palette['bg-1'], symbolColor: palette['text-2'] });
}

darkQuery.addEventListener('change', () => applyTheme({ animate: true }));

function applySettings({ animate = false } = {}) {
  applyTheme({ animate });
  document.body.classList.toggle('compact', settings.compact);
  render();
  if (typeof syncSettingsPage === 'function') syncSettingsPage();
  if (typeof renderUpdate === 'function') renderUpdate();
}

async function updateSettings(patch) {
  settings = { ...settings, ...patch };
  applySettings({ animate: 'mode' in patch || 'theme' in patch });
  try {
    settings = { ...settings, ...(await api.setSettings(patch)) };
  } catch (err) {
    toast(`Couldn't save settings: ${errorText(err)}`, { error: true });
  }
}

api.onSettingsChanged(next => {
  settings = { ...settings, ...next };
  applySettings();
});

// ---------- rendering ----------

function visibleAccounts() {
  const q = state.query.trim().toLowerCase();
  const hidden = hiddenIds();
  return state.accounts.filter(a =>
    (state.showHidden || !hidden.has(a.steamId)) &&
    (!q || a.personaName.toLowerCase().includes(q) || (settings.showLoginNames && a.accountName.toLowerCase().includes(q))));
}

function render() {
  const list = $('#accounts');
  const tpl = $('#account-tpl');
  const items = visibleAccounts();
  const hidden = hiddenIds();
  const hiddenCount = state.accounts.filter(a => hidden.has(a.steamId)).length;

  const total = state.accounts.length - (state.showHidden ? 0 : hiddenCount);
  $('#account-count').textContent = `${total} account${total === 1 ? '' : 's'}`;

  list.replaceChildren(...items.map((a, i) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = a.steamId;
    li.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
    li.classList.toggle('active', a.active);
    li.classList.toggle('hidden-acct', hidden.has(a.steamId));
    li.classList.toggle('focused', i === state.focus);
    li.setAttribute('aria-selected', i === state.focus);

    paintAvatar(li.querySelector('.avatar'), a);
    li.querySelector('.persona').textContent = a.personaName;

    const login = li.querySelector('.login');
    const loginText = a.active ? (state.running ? 'Signed in' : 'Signs in next') : settings.showLoginNames ? a.accountName : '';
    if (loginText) {
      if (a.offline) login.innerHTML = '<svg><use href="#i-offline"/></svg>';
      login.append(loginText);
    }

    const meta = li.querySelector('.meta');
    if (a.active) { meta.className = 'meta pill'; meta.textContent = state.running ? 'Online' : 'Current'; }
    else meta.textContent = ago(a.timestamp);

    const name = settings.showLoginNames ? a.accountName : a.personaName;
    li.title = a.active ? name : `Switch to ${name}`;
    return li;
  }));

  const empty = items.length === 0;
  $('#empty').hidden = !empty;
  list.hidden = empty;
  if (empty) {
    const searching = state.query && state.accounts.length;
    $('#empty-title').textContent = searching ? 'No matches' : 'No saved accounts yet';
    $('#empty-body').innerHTML = searching
      ? 'Nothing matches that search.'
      : 'Sign in to Steam with <b>Remember me</b> ticked and the account will show up here.';
  }

  for (const a of items) if (!a.avatar) loadRemoteAvatar(a);
}

function renderStatus() {
  $('#steam-dot').classList.toggle('on', state.running);
  $('#steam-status').textContent = state.running ? 'Steam running' : 'Steam closed';
  $('#launch-btn').classList.toggle('running', state.running);
  $('#launch-label').textContent = state.running ? 'Open Steam' : 'Launch Steam';
}

async function loadRemoteAvatar(account) {
  if (state.avatarRequested.has(account.steamId)) return;
  state.avatarRequested.add(account.steamId);
  const src = await api.remoteAvatar(account.steamId).catch(() => null);
  if (!src) return;
  account.avatar = src;
  const img = document.querySelector(`.account[data-id="${account.steamId}"] img`);
  if (img) img.src = src;
}

// ---------- data ----------

async function refresh() {
  try {
    const [accounts, running] = await Promise.all([api.listAccounts(), api.steamRunning()]);
    state.accounts = accounts;
    state.running = running;
  } catch (err) {
    toast(`Couldn't read Steam accounts: ${errorText(err)}`, { error: true });
  }
  state.focus = Math.min(state.focus, visibleAccounts().length - 1);
  render();
  renderStatus();
}

async function pollStatus() {
  if (state.busy || document.hidden) return;
  const running = await api.steamRunning().catch(() => state.running);
  if (running !== state.running) {
    state.running = running;
    renderStatus();
    render();
  }
}

// ---------- switching ----------

const STEPS = ['closing', 'updating', 'starting', 'done'];

function showOverlay(account) {
  const holder = $('#switch-avatar');
  holder.className = 'switch-avatar';
  holder.innerHTML = '<div class="avatar"><img alt=""><span class="initials"></span></div>';
  if (account) paintAvatar(holder.firstElementChild, account);
  else holder.firstElementChild.querySelector('.initials').textContent = '+';

  $('#switch-kicker').textContent = account ? 'Signing in as' : 'Opening Steam sign-in';
  $('#switch-name').textContent = account ? account.personaName : 'New account';
  setStep('closing');
  $('#overlay').hidden = false;
}

function setStep(step) {
  const at = STEPS.indexOf(step);
  for (const li of document.querySelectorAll('.steps li')) {
    const i = STEPS.indexOf(li.dataset.step);
    li.className = i < at ? 'ok' : i === at ? 'now' : '';
  }
  if (step === 'done') $('#switch-avatar').classList.add('done');
}

const findAccount = name => state.accounts.find(a => a.accountName.toLowerCase() === String(name).toLowerCase());

// Switches run in the main process and can start from here or from the tray; these events drive the overlay either way.
api.onSwitchStart(accountName => {
  state.busy = true;
  closeMenu();
  showOverlay(accountName ? findAccount(accountName) ?? { steamId: accountName, accountName, personaName: accountName } : null);
});

api.onSwitchStep(setStep);

api.onSwitchEnd(async ({ ok, accountName, error }) => {
  const account = accountName && findAccount(accountName);
  if (ok) {
    setStep('done');
    await new Promise(r => setTimeout(r, 900));
  }
  $('#overlay').hidden = true;
  state.busy = false;

  if (!ok) toast(error, { error: true });
  else if (state.switchStartedHere && settings.afterSwitch === 'minimise') api.minimiseWindow();
  else if (state.switchStartedHere && settings.afterSwitch === 'tray') api.hideWindow();
  else toast(account ? `Signed in as ${account.personaName}` : 'Steam is opening its sign-in screen');

  state.switchStartedHere = false;
  state.query = '';
  $('#search').value = '';
  refresh();
});

async function runSwitch(account) {
  if (state.busy) return;
  if (account?.active && state.running) return toast(`Already signed in as ${account.personaName}`);

  if (settings.warnInGame && state.running) {
    const game = await api.runningGame().catch(() => null);
    if (game && !(await confirmDialog({
      title: `${game.name} is running`,
      body: 'Switching accounts closes Steam, which may close the game too.',
      ok: 'Switch anyway',
    }))) return;
  }

  state.switchStartedHere = true;
  account ? api.switchTo(account.accountName) : api.addAccount();
}

// ---------- menus ----------

let menuAnchor = null;

function openMenu(anchor, items) {
  closeMenu();
  const menu = $('#menu');
  menu.replaceChildren(...items.map(item => {
    if (item === '-') return document.createElement('hr');
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<svg><use href="#i-${item.icon}"/></svg><span></span>`;
    b.querySelector('span').textContent = item.label;
    if (item.kbd) b.insertAdjacentHTML('beforeend', `<kbd>${item.kbd}</kbd>`);
    b.onclick = () => { closeMenu(); item.run(); };
    return b;
  }));
  menu.hidden = false;

  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const top = r.bottom + 6 + m.height > innerHeight - 8 ? r.top - m.height - 6 : r.bottom + 6;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8))}px`;

  menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus({ focusVisible: false });
}

function closeMenu() {
  $('#menu').hidden = true;
  menuAnchor?.setAttribute('aria-expanded', 'false');
  menuAnchor = null;
}

function toggleHidden(a) {
  const hidden = hiddenIds();
  const wasHidden = hidden.has(a.steamId);
  wasHidden ? hidden.delete(a.steamId) : hidden.add(a.steamId);
  updateSettings({ hiddenAccounts: [...hidden] });
  if (!wasHidden) toast(`${a.personaName} hidden — show hidden accounts from the ⋯ menu`);
}

function accountMenu(anchor, a) {
  const hidden = hiddenIds().has(a.steamId);
  openMenu(anchor, [
    { icon: 'arrow', label: a.active ? 'Restart Steam as this account' : 'Switch to this account', run: () => runSwitch(a) },
    '-',
    { icon: 'external', label: 'View Steam profile', run: () => api.openProfile(a.steamId) },
    { icon: 'copy', label: 'Copy SteamID64', run: () => api.copy(a.steamId).then(() => toast('SteamID copied')) },
    { icon: 'copy', label: 'Copy account name', run: () => api.copy(a.accountName).then(() => toast('Account name copied')) },
    '-',
    { icon: hidden ? 'show' : 'hide', label: hidden ? 'Unhide account' : 'Hide from list', run: () => toggleHidden(a) },
  ]);
}

function mainMenu(anchor) {
  const hiddenCount = hiddenIds().size;
  openMenu(anchor, [
    { icon: 'refresh', label: 'Refresh accounts', kbd: 'F5', run: () => refresh().then(() => toast('Accounts refreshed')) },
    { icon: 'folder', label: 'Open Steam folder', run: () => api.openSteamFolder() },
    ...(hiddenCount ? [{
      icon: state.showHidden ? 'hide' : 'show',
      label: state.showHidden ? 'Hide hidden accounts' : `Show hidden accounts (${hiddenCount})`,
      run: () => { state.showHidden = !state.showHidden; render(); },
    }] : []),
    '-',
    { icon: 'settings', label: 'Settings', kbd: 'Ctrl+,', run: () => openSettings() },
  ]);
}

// ---------- events ----------

$('#accounts').addEventListener('click', e => {
  const li = e.target.closest('.account');
  if (!li) return;
  const account = state.accounts.find(a => a.steamId === li.dataset.id);
  if (e.target.closest('.more')) return accountMenu(e.target.closest('.more'), account);
  runSwitch(account);
});

$('#accounts').addEventListener('contextmenu', e => {
  const li = e.target.closest('.account');
  if (!li) return;
  e.preventDefault();
  accountMenu(li.querySelector('.more'), state.accounts.find(a => a.steamId === li.dataset.id));
});

$('#menu-btn').addEventListener('click', e => menuAnchor === e.currentTarget ? closeMenu() : mainMenu(e.currentTarget));
$('#settings-btn').addEventListener('click', () => openSettings());
$('#add-btn').addEventListener('click', () => runSwitch(null));
$('#launch-btn').addEventListener('click', () =>
  api.launchSteam().then(() => setTimeout(pollStatus, 1500)).catch(err => toast(errorText(err), { error: true })));

$('#search').addEventListener('input', e => {
  state.query = e.target.value;
  state.focus = state.query ? 0 : -1;
  render();
});

document.addEventListener('mousedown', e => {
  if (!$('#menu').hidden && !e.target.closest('#menu') && e.target.closest('[aria-expanded="true"]') !== menuAnchor) closeMenu();
});

function moveFocus(delta) {
  const n = visibleAccounts().length;
  if (!n) return;
  state.focus = state.focus < 0 ? (delta > 0 ? 0 : n - 1) : (state.focus + delta + n) % n;
  render();
  document.querySelector('.account.focused')?.scrollIntoView({ block: 'nearest' });
}

const layerOpen = () => !$('#settings').hidden || !$('#confirm').hidden || !$('#theme-editor').hidden;

document.addEventListener('keydown', e => {
  if (state.busy) return;
  if (e.key === ',' && e.ctrlKey) { e.preventDefault(); return $('#settings').hidden ? openSettings() : closeSettings(); }
  if (layerOpen()) return; // settings.js handles keys inside its own layers

  const search = $('#search');
  const typing = document.activeElement === search;

  if (e.key === 'Escape') {
    if (!$('#menu').hidden) return closeMenu();
    if (search.value) { search.value = ''; state.query = ''; state.focus = -1; render(); }
    return search.blur();
  }
  if (!$('#menu').hidden) return;

  if (e.key === 'ArrowDown') { e.preventDefault(); return moveFocus(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); return moveFocus(-1); }
  if (e.key === 'Enter' && state.focus >= 0) { e.preventDefault(); return runSwitch(visibleAccounts()[state.focus]); }
  if ((e.key === '/' && !typing) || (e.key === 'f' && e.ctrlKey)) { e.preventDefault(); return search.focus(); }
  if (e.key === 'n' && e.ctrlKey) { e.preventDefault(); return runSwitch(null); }
  if (e.key === 'F5' || (e.key === 'r' && e.ctrlKey)) { e.preventDefault(); return refresh(); }
  if (!typing && /^[1-9]$/.test(e.key)) {
    const a = visibleAccounts()[Number(e.key) - 1];
    if (a) runSwitch(a);
  }
});

// Coming back from the tray: the active account may have changed while we were hidden.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.busy) refresh(); });
api.onOpenSettings(() => openSettings());

// ---------- start ----------

async function start() {
  const { canOpenAtLogin, version, ...loaded } = await api.getSettings();
  settings = loaded;
  appInfo = { canOpenAtLogin, version };

  // Earlier versions kept hidden accounts in localStorage; move them into settings once.
  try {
    const legacy = JSON.parse(localStorage.getItem('personae:hidden') || '[]');
    if (legacy.length && !settings.hiddenAccounts.length) await updateSettings({ hiddenAccounts: legacy });
    localStorage.removeItem('personae:hidden');
    localStorage.removeItem('personae:hideAfterSwitch');
  } catch {}

  applySettings();
  document.body.classList.add('ready');
  refresh();
  setInterval(pollStatus, 3000);
}

// Wait for settings.js to load too; start() uses its syncSettingsPage.
document.addEventListener('DOMContentLoaded', start);
