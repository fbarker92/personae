// Background updates from GitHub Releases.
//   Setup .exe (NSIS)  electron-updater downloads (differentially) and runs the installer silently.
//   .msi               downloads the new .msi and runs msiexec once Personae has exited; Windows asks for admin.
//   portable .exe      downloads the new portable .exe and swaps it in once Personae has exited.
// In "auto" mode a downloaded update installs as soon as main.js reports Personae is idle, then Personae
// relaunches the way it was (see justUpdated in main.js).
const { app, shell, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { runDetachedInstall } = require('./update-installer');

const PLACEHOLDER_OWNER = 'YOUR_GITHUB_USERNAME';
const FIRST_CHECK_DELAY = 10 * 1000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const IDLE_POLL = 60 * 1000;

// package.json "repository" is the single source of truth; the release workflow publishes to the same repo.
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
const workDir = () => path.join(app.getPath('temp'), 'personae-update');
const notesUrl = version => `https://github.com/${repo.owner}/${repo.repo}/releases/tag/v${version}`;
const userAgent = () => `Personae/${app.getVersion()}`;

let state = {
  // dev | unconfigured | idle | checking | current | available | downloading | ready | installing | error
  status: kind === 'dev' ? 'dev' : repo ? 'idle' : 'unconfigured',
  kind,
  mode: 'auto',
  currentVersion: app.getVersion(),
  currentNotesUrl: repo ? notesUrl(app.getVersion()) : null,
  version: null,
  notesUrl: null,
  percent: 0,
  error: null,
  lastChecked: null,
  needsAdmin: kind === 'msi',
};

let hooks = {
  onChange: () => {},
  isIdle: async () => false,
  shouldAutoInstall: () => true,
  beforeInstall: () => {},
  installFailed: () => {},
};
let pending = null; // MSI / portable: { version, asset, file }
let checkTimer;
let idleTimer;

const enabled = () => kind !== 'dev' && Boolean(repo);

function set(patch) {
  state = { ...state, ...patch };
  hooks.onChange(state);
  scheduleIdleInstall();
}

function shortError(err) {
  const msg = String(err?.message || err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::|aborted|timed? ?out/i.test(msg)) return "Couldn't reach GitHub";
  if (/404/.test(msg)) return 'No published releases found';
  return msg.split('\n')[0].slice(0, 140);
}

function isNewer(candidate, current) {
  const parse = v => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// ---------- checking ----------

async function check() {
  if (!enabled() || ['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return;
  try {
    if (kind === 'installer') await autoUpdater.checkForUpdates(); // state follows from the events in init()
    else await checkGitHub();
  } catch (err) {
    set({ status: 'error', error: shortError(err) });
  }
}

async function checkGitHub() {
  set({ status: 'checking', error: null });
  const res = await net.fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error('404');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const release = await res.json();

  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!isNewer(version, app.getVersion())) return set({ status: 'current', lastChecked: Date.now() });

  const name = kind === 'msi' ? `${app.getName()}-${version}.msi` : `${app.getName()}-${version}-portable.exe`;
  const asset = (release.assets || []).find(a => a.name === name);
  if (!asset) throw new Error(`Release ${version} doesn't include ${name}`);

  pending = { version, asset, file: null };
  set({ status: 'available', version, notesUrl: release.html_url || notesUrl(version), percent: 0, lastChecked: Date.now() });
  if (state.mode !== 'manual') await download();
}

// ---------- downloading ----------

async function download() {
  if (state.status !== 'available') return;
  set({ status: 'downloading', percent: 0, error: null });
  try {
    if (kind === 'installer') return void (await autoUpdater.downloadUpdate());
    pending.file = await downloadAsset(pending.asset);
    set({ status: 'ready', percent: 100 });
  } catch (err) {
    set({ status: 'error', error: shortError(err) });
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Downloads a release asset into the temp folder, checking its size and (when GitHub provides one) its SHA-256.
async function downloadAsset(asset) {
  const dir = workDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, asset.name);
  const expected = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : null;

  // Already downloaded on an earlier run?
  const existing = await fs.promises.stat(file).catch(() => null);
  if (existing?.size === asset.size && (!expected || (await sha256(file)) === expected)) return file;

  // Clear out packages for other versions.
  for (const f of await fs.promises.readdir(dir)) {
    if (/\.(msi|exe|partial)$/i.test(f) && f !== asset.name) await fs.promises.rm(path.join(dir, f), { force: true });
  }

  const res = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);

  const partial = `${file}.partial`;
  const out = fs.createWriteStream(partial);
  const hash = crypto.createHash('sha256');
  let received = 0;
  let lastPercent = -1;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      const percent = Math.floor((received / asset.size) * 100);
      if (percent !== lastPercent) { lastPercent = percent; set({ percent: Math.min(percent, 100) }); }
    }
  } finally {
    await new Promise(resolve => out.end(resolve));
  }

  if (received !== asset.size) throw new Error('The download was incomplete');
  if (expected && hash.digest('hex') !== expected) {
    await fs.promises.rm(partial, { force: true });
    throw new Error("The downloaded update didn't match its checksum");
  }
  await fs.promises.rename(partial, file);
  return file;
}

// ---------- installing ----------

function install() {
  if (state.status !== 'ready') return;
  hooks.beforeInstall(state.version);
  set({ status: 'installing' });

  if (kind === 'installer') {
    // Silent install, then relaunch. electron-updater elevates itself if the install folder needs admin.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return;
  }
  runDetachedInstall({
    kind,
    packagePath: pending.file,
    target: kind === 'portable' ? process.env.PORTABLE_EXECUTABLE_FILE : process.execPath,
    workDir: workDir(),
  })
    .then(() => app.quit()) // the install script waits for this process to exit
    .catch(err => {
      hooks.installFailed(state.version);
      set({ status: 'error', error: shortError(err) });
    });
}

let tryingIdle = false;
async function tryIdleInstall() {
  if (tryingIdle) return;
  tryingIdle = true;
  try {
    if (wantsIdleInstall() && (await hooks.isIdle())) install();
  } finally {
    tryingIdle = false;
  }
}

const wantsIdleInstall = () => state.status === 'ready' && state.mode === 'auto' && hooks.shouldAutoInstall(state.version);

function scheduleIdleInstall() {
  if (wantsIdleInstall() && !idleTimer) {
    idleTimer = setInterval(tryIdleInstall, IDLE_POLL);
    setTimeout(tryIdleInstall, 5000);
  } else if (!wantsIdleInstall() && idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

// ---------- setup ----------

function setMode(mode) {
  autoUpdater.autoDownload = mode !== 'manual';
  autoUpdater.autoInstallOnAppQuit = mode === 'auto';
  clearInterval(checkTimer);
  if (enabled() && mode !== 'manual') checkTimer = setInterval(check, CHECK_INTERVAL);
  set({ mode });
  if (mode !== 'manual' && state.status === 'available') download();
}

// MSI / portable downloads from a previous run have either been installed or will be fetched again.
function cleanUpDownloads() {
  fs.promises.readdir(workDir())
    .then(files => Promise.all(files.filter(f => /\.(msi|exe|partial|ps1)$/i.test(f))
      .map(f => fs.promises.rm(path.join(workDir(), f), { force: true }))))
    .catch(() => {});
}

function init({ mode, ...hookFns }) {
  hooks = { ...hooks, ...hookFns };
  if (!enabled()) return hooks.onChange(state);

  if (kind === 'installer') {
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => set({ status: 'current', lastChecked: Date.now() }));
    autoUpdater.on('update-available', info => set({
      status: autoUpdater.autoDownload ? 'downloading' : 'available',
      version: info.version,
      notesUrl: notesUrl(info.version),
      percent: 0,
      lastChecked: Date.now(),
    }));
    autoUpdater.on('download-progress', p => set({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', info => set({ status: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', err => { if (state.status !== 'installing') set({ status: 'error', error: shortError(err) }); });
  } else {
    cleanUpDownloads();
  }

  setMode(mode);
  if (mode !== 'manual') setTimeout(check, FIRST_CHECK_DELAY);
}

function openNotes(version) {
  if (!repo) return;
  const v = /^\d+\.\d+\.\d+$/.test(version) ? version : state.version || app.getVersion();
  return shell.openExternal(notesUrl(v));
}

module.exports = { init, check, download, install, setMode, openNotes, getState: () => state };
