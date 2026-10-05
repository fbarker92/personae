const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, nativeTheme, Tray, Menu, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const steam = require('./steam');
const settings = require('./settings');
const updater = require('./updater');

// A separate profile (settings, caches, single-instance lock) for testing alongside a real copy.
if (process.env.PERSONAE_USER_DATA) app.setPath('userData', process.env.PERSONAE_USER_DATA);

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('dev.personae.app'); // Windows attributes notifications and taskbar grouping to this id

const ASSETS = path.join(__dirname, 'assets');
const ICON = path.join(ASSETS, 'icon.png');
const UPDATE_IDLE_AFTER = 2 * 60 * 1000; // window unfocused this long counts as "not in use"

let win;
let tray;
let quitting = false;
let busy = false;
let startHidden = process.argv.includes('--hidden');
let blurredAt = 0;
let updateOutcomeForWindow = null; // shown as a toast once the window asks for it

// ---------- window ----------

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 380,
    minHeight: 520,
    title: 'Personae',
    icon: ICON,
    backgroundColor: dark ? '#0f151d' : '#f2f5f8',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#0f151d' : '#f2f5f8', symbolColor: dark ? '#9aa6b2' : '#4a5a6a', height: 40 },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.on('blur', () => { blurredAt = Date.now(); });
  win.on('focus', () => { blurredAt = 0; });

  win.on('close', e => {
    if (quitting) return;
    if (settings.get().closeTo === 'quit') { quitting = true; return; }
    e.preventDefault();
    win.hide();
    if (!settings.get().trayHintShown) {
      settings.update({ trayHintShown: true });
      tray.displayBalloon({
        iconType: 'custom',
        icon: ICON,
        title: 'Personae is still running',
        content: 'Switch accounts from the tray icon. Right-click it to quit.',
      });
    }
  });
}

function showWindow() {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };
const windowVisible = () => win && win.isVisible() && !win.isMinimized();

function notifyError(err) {
  if (windowVisible() || !Notification.isSupported()) return;
  new Notification({ title: "Couldn't switch account", body: err.message, icon: ICON }).show();
}

// ---------- settings side effects ----------

function loginItem(s) {
  return { path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: s.startHidden ? ['--hidden'] : [] };
}

function applySettings(prev, next) {
  nativeTheme.themeSource = next.mode;
  if (app.isPackaged && (!prev || prev.openAtLogin !== next.openAtLogin || prev.startHidden !== next.startHidden)) {
    // Clear any entry with the old arguments before writing the new one.
    if (prev) app.setLoginItemSettings({ ...loginItem(prev), openAtLogin: false });
    app.setLoginItemSettings({ ...loginItem(next), openAtLogin: next.openAtLogin });
  }
  if (prev && prev.updateMode !== next.updateMode) updater.setMode(next.updateMode);
  refreshTray();
}

function changeSettings(fn) {
  const prev = settings.get();
  const next = fn();
  applySettings(prev, next);
  send('settings:changed', next);
  return next;
}

// ---------- switching (shared by window and tray) ----------

async function performSwitch(accountName) {
  if (busy) throw new Error('A switch is already in progress');
  busy = true;
  refreshTray();
  send('switch:start', accountName);
  try {
    const onStep = step => send('switch:step', step);
    const opts = { launchArgs: settings.get().launchArgs };
    await (accountName ? steam.switchTo(accountName, onStep, opts) : steam.addAccount(onStep, opts));
    send('switch:end', { ok: true, accountName });
  } catch (err) {
    send('switch:end', { ok: false, accountName, error: err.message });
    throw err;
  } finally {
    busy = false;
    refreshTray();
  }
}

// The window asks before switching with its own dialog; the tray has no UI of its own, so it uses a native one.
async function confirmGameRunning() {
  if (!settings.get().warnInGame || !(await steam.isSteamRunning())) return true;
  const game = await steam.getRunningGame();
  if (!game) return true;
  const { response } = await dialog.showMessageBox(windowVisible() ? win : undefined, {
    type: 'warning',
    title: 'Personae',
    message: `${game.name} is running`,
    detail: 'Switching accounts closes Steam, which may close the game too.',
    buttons: ['Switch anyway', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}

async function switchFromTray(accountName) {
  if (busy || !(await confirmGameRunning())) return;
  performSwitch(accountName).catch(notifyError);
}

// ---------- updates ----------

// Installing restarts Personae (and MSI updates bring up an admin prompt), so only do it when nobody's using
// Personae and no game is running.
async function idleForUpdate() {
  if (busy || !win) return false;
  const inUse = windowVisible() && (win.isFocused() || Date.now() - blurredAt < UPDATE_IDLE_AFTER);
  if (inUse) return false;
  return !(await steam.getRunningGame().catch(() => null));
}

// Remember how Personae looked so the relaunched version can come back the same way, and check it worked.
function beforeInstall(version) {
  settings.update({ justUpdated: { from: app.getVersion(), to: version, hidden: !windowVisible() }, dismissedUpdate: '' });
}

// The installer never started, so Personae is still running: forget the pending relaunch and don't retry
// this version automatically (Install now still works).
function installFailed(version) {
  settings.update({ justUpdated: null, skipAutoInstall: version });
}

// Runs at startup: did the update we started last time actually install?
function readUpdateOutcome() {
  const last = settings.get().justUpdated;
  if (!last) return null;
  const ok = app.getVersion() === last.to;
  settings.update({ justUpdated: null, ...(ok ? {} : { skipAutoInstall: last.to }) });
  if (last.hidden) startHidden = true;
  return { ok, version: last.to, from: last.from };
}

function announceUpdateOutcome(outcome) {
  if (!startHidden) { updateOutcomeForWindow = outcome; return; }
  if (!Notification.isSupported()) return;
  const n = outcome.ok
    ? new Notification({ title: `Personae updated to ${outcome.version}`, body: "Click to see what's new.", icon: ICON })
    : new Notification({
        title: `Personae ${outcome.version} wasn't installed`,
        body: 'The update was cancelled or needs admin permission. You can install it from Settings → Updates.',
        icon: ICON,
      });
  n.on('click', () => {
    if (outcome.ok) updater.openNotes(outcome.version);
    else { showWindow(); send('settings:open'); }
  });
  n.show();
}

// ---------- tray ----------

// "&" marks a mnemonic in Windows menus, so double it to show a literal ampersand.
const menuText = s => s.replace(/&/g, '&&');

function accountLabel(a, showLoginNames) {
  const persona = menuText(a.personaName);
  if (!showLoginNames || a.personaName.toLowerCase() === a.accountName.toLowerCase()) return persona;
  return `${persona}   (${menuText(a.accountName)})`;
}

async function refreshTray() {
  if (!tray) return;
  const s = settings.get();
  const [accounts, running] = await Promise.all([steam.getAccounts({ avatars: false }).catch(() => []), steam.isSteamRunning()]);
  const hidden = new Set(s.hiddenAccounts);
  const visible = accounts.filter(a => !hidden.has(a.steamId));
  const active = accounts.find(a => a.active);

  const accountItems = visible.length
    ? visible.map(a => ({
        label: accountLabel(a, s.showLoginNames),
        type: 'radio',
        checked: a.active,
        enabled: !busy,
        click: () => { if (!(a.active && running)) switchFromTray(a.accountName); },
      }))
    : [{ label: 'No saved accounts', enabled: false }];

  const update = updater.getState();
  const updateItems = [];
  if (update.status === 'ready') updateItems.push({ label: `Install update ${update.version} now`, click: () => updater.install() });
  if (['available', 'downloading', 'ready'].includes(update.status)) {
    updateItems.push({ label: `Release notes for ${update.version}`, click: () => updater.openNotes(update.version) });
  }
  if (updateItems.length) updateItems.push({ type: 'separator' });

  tray.setContextMenu(Menu.buildFromTemplate([
    ...updateItems,
    { label: busy ? 'Switching…' : 'Switch account', enabled: false },
    ...accountItems,
    { type: 'separator' },
    { label: 'Add account…', enabled: !busy, click: () => switchFromTray(null) },
    { label: running ? 'Open Steam' : 'Launch Steam', enabled: !busy, click: () => steam.startSteam(s.launchArgs).catch(notifyError) },
    { type: 'separator' },
    { label: 'Show Personae', click: showWindow },
    { label: 'Settings', click: () => { showWindow(); send('settings:open'); } },
    { label: 'Quit', click: () => app.quit() },
  ]));

  const status = busy ? 'Switching…' : active ? `${active.personaName}${running ? '' : ' (Steam closed)'}` : 'No account selected';
  tray.setToolTip(`Personae — ${status}`);
}

function createTray() {
  tray = new Tray(path.join(ASSETS, 'tray.png'));
  tray.setToolTip('Personae');
  tray.on('click', showWindow);
  refreshTray();
  setInterval(refreshTray, 5000);
}

// ---------- IPC ----------

const withoutRejection = p => p.catch(() => {}); // failures reach the window via switch:end
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

ipcMain.handle('accounts:list', () => steam.getAccounts());
ipcMain.handle('steam:status', () => steam.isSteamRunning());
ipcMain.handle('steam:game', () => steam.getRunningGame());
ipcMain.handle('steam:switch', (_, accountName) => withoutRejection(performSwitch(String(accountName))));
ipcMain.handle('steam:add', () => withoutRejection(performSwitch(null)));
ipcMain.handle('steam:launch', () => steam.startSteam(settings.get().launchArgs));
ipcMain.handle('avatar:remote', (_, steamId) =>
  steam.fetchRemoteAvatar(steamId, path.join(app.getPath('userData'), 'avatars')));
ipcMain.handle('avatar:clearCache', () =>
  fs.promises.rm(path.join(app.getPath('userData'), 'avatars'), { recursive: true, force: true }));
ipcMain.handle('open:profile', (_, steamId) => {
  if (/^\d{17}$/.test(steamId)) return shell.openExternal(`https://steamcommunity.com/profiles/${steamId}`);
});
ipcMain.handle('open:steamFolder', async () => shell.openPath(await steam.getSteamPath()));
ipcMain.handle('clipboard:write', (_, text) => clipboard.writeText(String(text)));
ipcMain.handle('window:hide', () => win.hide());
ipcMain.handle('window:minimise', () => win.minimize());
ipcMain.handle('window:chrome', (_, { color, symbolColor } = {}) => {
  if (COLOR.test(color) && COLOR.test(symbolColor)) {
    win.setTitleBarOverlay({ color, symbolColor, height: 40 });
    win.setBackgroundColor(color);
  }
});
ipcMain.handle('settings:get', () => ({ ...settings.get(), canOpenAtLogin: app.isPackaged, version: app.getVersion() }));
ipcMain.handle('settings:set', (_, patch) => changeSettings(() => settings.update(patch && typeof patch === 'object' ? patch : {})));
ipcMain.handle('settings:reset', () => changeSettings(() => settings.reset()));
ipcMain.handle('updates:state', () => updater.getState());
ipcMain.handle('updates:check', () => updater.check());
ipcMain.handle('updates:download', () => updater.download());
ipcMain.handle('updates:install', () => updater.install());
ipcMain.handle('updates:openNotes', (_, version) => updater.openNotes(String(version || '')));
ipcMain.handle('updates:takeOutcome', () => {
  const outcome = updateOutcomeForWindow;
  updateOutcomeForWindow = null;
  return outcome;
});

// ---------- lifecycle ----------

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  const updateOutcome = readUpdateOutcome(); // may set startHidden, so before createWindow
  applySettings(null, settings.get());
  createTray();
  createWindow();
  if (updateOutcome) announceUpdateOutcome(updateOutcome);

  let lastStatus;
  updater.init({
    mode: settings.get().updateMode,
    isIdle: idleForUpdate,
    shouldAutoInstall: version => settings.get().skipAutoInstall !== version,
    beforeInstall,
    installFailed,
    onChange: state => {
      send('updates:changed', state);
      if (state.status !== lastStatus) { lastStatus = state.status; refreshTray(); }
    },
  });
});
