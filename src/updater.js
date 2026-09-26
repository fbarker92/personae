// Auto-update from GitHub Releases. Installer (NSIS) builds download and install updates themselves;
// MSI and portable builds can't replace themselves, so they only report new versions and link to the release.
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const PLACEHOLDER_OWNER = 'YOUR_GITHUB_USERNAME';
const FIRST_CHECK_DELAY = 10 * 1000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

// package.json "repository" is the single source of truth; electron-builder publishes to the same repo.
function repoInfo() {
  const pkg = require('../package.json');
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.#]+)/);
  return m && m[1] !== PLACEHOLDER_OWNER ? { owner: m[1], repo: m[2] } : null;
}

function installKind() {
  if (!app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`))) return 'installer';
  return 'msi';
}

const repo = repoInfo();
const kind = installKind();
const canSelfUpdate = kind === 'installer';

let state = {
  // dev | unconfigured | idle | checking | current | available | downloading | ready | error
  status: kind === 'dev' ? 'dev' : repo ? 'idle' : 'unconfigured',
  currentVersion: app.getVersion(),
  version: null,
  percent: 0,
  error: null,
  lastChecked: null,
  canSelfUpdate,
};

let onChange = () => {};
let automatic = true;
let timer;

const enabled = () => kind !== 'dev' && Boolean(repo);

function set(patch) {
  state = { ...state, ...patch };
  onChange(state);
}

function releaseUrl() {
  const base = `https://github.com/${repo.owner}/${repo.repo}/releases`;
  return state.version ? `${base}/tag/v${state.version}` : `${base}/latest`;
}

async function check() {
  if (!enabled() || ['checking', 'downloading', 'ready'].includes(state.status)) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    set({ status: 'error', error: shortError(err) });
  }
}

function shortError(err) {
  const msg = String(err?.message || err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::/i.test(msg)) return "Couldn't reach GitHub";
  if (/404/.test(msg)) return 'No published releases found';
  return msg.split('\n')[0].slice(0, 140);
}

function download() {
  if (!canSelfUpdate) return shell.openExternal(releaseUrl());
  if (state.status !== 'available') return;
  set({ status: 'downloading', percent: 0 });
  autoUpdater.downloadUpdate().catch(err => set({ status: 'error', error: shortError(err) }));
}

// Runs the installer silently and relaunches Personae on the new version.
function install() {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

function setAutomatic(value) {
  automatic = Boolean(value);
  autoUpdater.autoDownload = canSelfUpdate && automatic;
  clearInterval(timer);
  if (enabled() && automatic) timer = setInterval(check, CHECK_INTERVAL);
}

function init({ onStateChange, automatic: auto }) {
  onChange = onStateChange;
  if (!enabled()) return;

  autoUpdater.autoInstallOnAppQuit = canSelfUpdate;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', lastChecked: Date.now() }));
  autoUpdater.on('update-available', info => set({
    status: canSelfUpdate && autoUpdater.autoDownload ? 'downloading' : 'available',
    version: info.version,
    percent: 0,
    lastChecked: Date.now(),
  }));
  autoUpdater.on('download-progress', p => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', info => set({ status: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', err => set({ status: 'error', error: shortError(err) }));

  setAutomatic(auto);
  if (automatic) setTimeout(check, FIRST_CHECK_DELAY);
}

module.exports = {
  init,
  check,
  download,
  install,
  setAutomatic,
  openRelease: () => repo && shell.openExternal(releaseUrl()),
  getState: () => state,
};
