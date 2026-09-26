// Everything that touches Steam: registry, loginusers.vdf, and the steam.exe process.
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const run = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const REG_KEY = 'HKCU\\Software\\Valve\\Steam';
const DEFAULT_STEAM_PATH = 'C:\\Program Files (x86)\\Steam';

// ---------- registry ----------

async function regQuery(name) {
  try {
    const { stdout } = await run('reg', ['query', REG_KEY, '/v', name], { windowsHide: true });
    const m = stdout.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s*(.*)$`, 'mi'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

async function regSet(name, type, value) {
  await run('reg', ['add', REG_KEY, '/v', name, '/t', type, '/d', String(value), '/f'], { windowsHide: true });
}

async function getSteamPath() {
  const p = await regQuery('SteamPath');
  return path.normalize(p || DEFAULT_STEAM_PATH);
}

async function getSteamExe() {
  const exe = await regQuery('SteamExe');
  return exe ? path.normalize(exe) : path.join(await getSteamPath(), 'steam.exe');
}

// ---------- VDF (Valve KeyValues text format) ----------

function parseVdf(text) {
  let i = 0;
  const n = text.length;

  const skip = () => {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\uFEFF') i++;
      else if (c === '/' && text[i + 1] === '/') while (i < n && text[i] !== '\n') i++;
      else break;
    }
  };

  const str = () => {
    let s = '';
    if (text[i] === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += text[i++];
      }
      i++;
      return s;
    }
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return s;
  };

  const obj = () => {
    const o = {};
    for (;;) {
      skip();
      if (i >= n) return o;
      if (text[i] === '}') { i++; return o; }
      const key = str();
      skip();
      if (text[i] === '{') { i++; o[key] = obj(); }
      else o[key] = str();
    }
  };

  return obj();
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function stringifyVdf(obj, depth = 0) {
  const tab = '\t'.repeat(depth);
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') out += `${tab}"${esc(k)}"\n${tab}{\n${stringifyVdf(v, depth + 1)}${tab}}\n`;
    else out += `${tab}"${esc(k)}"\t\t"${esc(v)}"\n`;
  }
  return out;
}

// Steam has changed key casing over the years ("AccountName" vs "accountname").
const keyOf = (o, name) => Object.keys(o).find(k => k.toLowerCase() === name.toLowerCase());
const field = (o, name) => { const k = keyOf(o, name); return k ? o[k] : undefined; };

// ---------- accounts ----------

async function loginUsersPath() {
  return path.join(await getSteamPath(), 'config', 'loginusers.vdf');
}

async function readLoginUsers() {
  const file = await loginUsersPath();
  if (!fs.existsSync(file)) return { file, data: { users: {} } };
  return { file, data: parseVdf(fs.readFileSync(file, 'utf8')) };
}

function localAvatar(steamPath, steamId) {
  for (const ext of ['png', 'jpg']) {
    const file = path.join(steamPath, 'config', 'avatarcache', `${steamId}.${ext}`);
    if (fs.existsSync(file)) return toDataUrl(file);
  }
  return null;
}

function toDataUrl(file) {
  const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function getAccounts({ avatars = true } = {}) {
  const steamPath = await getSteamPath();
  const { data } = await readLoginUsers();
  const users = field(data, 'users') || {};
  const autoLogin = ((await regQuery('AutoLoginUser')) || '').toLowerCase();

  return Object.entries(users)
    .map(([steamId, u]) => {
      const accountName = field(u, 'AccountName') || '';
      return {
        steamId,
        accountName,
        personaName: field(u, 'PersonaName') || accountName,
        timestamp: Number(field(u, 'Timestamp')) || 0,
        remembered: field(u, 'RememberPassword') === '1',
        offline: field(u, 'WantsOfflineMode') === '1',
        active: accountName.toLowerCase() === autoLogin,
        avatar: avatars ? localAvatar(steamPath, steamId) : null,
      };
    })
    .filter(a => a.accountName)
    .sort((a, b) => b.active - a.active || b.timestamp - a.timestamp);
}

async function markMostRecent(accountName) {
  const { file, data } = await readLoginUsers();
  const users = field(data, 'users');
  if (!users) return;

  let found = false;
  for (const u of Object.values(users)) {
    const isTarget = (field(u, 'AccountName') || '').toLowerCase() === accountName.toLowerCase();
    found ||= isTarget;
    const mostRecent = keyOf(u, 'MostRecent');
    if (mostRecent) u[mostRecent] = isTarget ? '1' : '0';
    if (isTarget) {
      u[keyOf(u, 'RememberPassword') || 'RememberPassword'] = '1';
      for (const k of ['AutoLogin', 'AllowAutoLogin']) if (keyOf(u, k)) u[keyOf(u, k)] = '1';
    }
  }
  if (!found) return;

  fs.copyFileSync(file, `${file}.personae.bak`);
  fs.writeFileSync(file, stringifyVdf(data), 'utf8');
}

// ---------- process control ----------

async function isSteamRunning() {
  try {
    const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH', '/FO', 'CSV'], { windowsHide: true });
    return /"steam\.exe"/i.test(stdout);
  } catch {
    return false;
  }
}

async function closeSteam() {
  if (!(await isSteamRunning())) return;
  spawn(await getSteamExe(), ['-shutdown'], { detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!(await isSteamRunning())) break;
  }
  if (await isSteamRunning()) {
    await run('taskkill', ['/F', '/T', '/IM', 'steam.exe'], { windowsHide: true }).catch(() => {});
  }
  // Steam flushes its config on exit; give it a moment before we write ours.
  await sleep(1000);
}

// Splits "-silent -login foo" or '-arg "with spaces"' into argv. No shell is involved, so nothing is interpreted.
function parseArgs(text = '') {
  return (String(text).match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"(.*)"$/, '$1'));
}

async function startSteam(launchArgs = '') {
  const exe = await getSteamExe();
  if (!fs.existsSync(exe)) throw new Error(`Couldn't find Steam at ${exe}`);
  spawn(exe, parseArgs(launchArgs), { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
}

// Steam records the app it's running in the registry; look its name up in the library manifests.
async function getRunningGame() {
  const appId = parseInt((await regQuery('RunningAppID')) || '0', 16) || 0;
  if (!appId) return null;

  const steamPath = await getSteamPath();
  const libraries = [steamPath];
  try {
    const folders = field(parseVdf(fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8')), 'libraryfolders') || {};
    for (const f of Object.values(folders)) if (f && typeof f === 'object' && field(f, 'path')) libraries.push(field(f, 'path'));
  } catch {}

  for (const lib of libraries) {
    try {
      const manifest = parseVdf(fs.readFileSync(path.join(lib, 'steamapps', `appmanifest_${appId}.acf`), 'utf8'));
      const name = field(field(manifest, 'AppState') || {}, 'name');
      if (name) return { appId, name };
    } catch {}
  }
  return { appId, name: 'A game' };
}

async function switchTo(accountName, onStep = () => {}, { launchArgs = '' } = {}) {
  const accounts = await getAccounts({ avatars: false });
  const target = accounts.find(a => a.accountName.toLowerCase() === String(accountName).toLowerCase());
  if (!target) throw new Error(`"${accountName}" isn't a saved Steam account`);

  onStep('closing');
  await closeSteam();
  onStep('updating');
  await regSet('AutoLoginUser', 'REG_SZ', target.accountName);
  await regSet('RememberPassword', 'REG_DWORD', 1);
  await markMostRecent(target.accountName);
  onStep('starting');
  await startSteam(launchArgs);
  onStep('done');
}

// Clearing AutoLoginUser makes Steam open on its sign-in screen.
async function addAccount(onStep = () => {}, { launchArgs = '' } = {}) {
  onStep('closing');
  await closeSteam();
  onStep('updating');
  await regSet('AutoLoginUser', 'REG_SZ', '');
  onStep('starting');
  await startSteam(launchArgs);
  onStep('done');
}

// ---------- remote avatars (fallback when Steam's avatarcache is empty) ----------

async function fetchRemoteAvatar(steamId, cacheDir) {
  if (!/^\d{17}$/.test(steamId)) return null;
  const file = path.join(cacheDir, `${steamId}.jpg`);
  const cached = fs.existsSync(file) ? fs.statSync(file) : null;
  if (cached && Date.now() - cached.mtimeMs < 7 * 864e5) return toDataUrl(file);

  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`, { signal: AbortSignal.timeout(6000) });
    const url = (await res.text()).match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/)?.[1];
    if (!url) return cached ? toDataUrl(file) : null;
    const img = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(6000) })).arrayBuffer());
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, img);
    return toDataUrl(file);
  } catch {
    return cached ? toDataUrl(file) : null;
  }
}

module.exports = {
  getSteamPath,
  getAccounts,
  isSteamRunning,
  getRunningGame,
  startSteam,
  switchTo,
  addAccount,
  fetchRemoteAvatar,
  parseVdf,
  stringifyVdf,
};
