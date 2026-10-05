// Update banner on the main view and the Updates section in settings. State comes from the main process (updater.js).

let update = { status: 'idle', mode: 'auto', kind: 'dev', currentVersion: '' };

// "Automatic" won't retry a version whose install didn't take (e.g. the admin prompt was declined).
const installsByItself = u => u.mode === 'auto' && settings.skipAutoInstall !== u.version;

function updateCopy(u) {
  const v = u.version;
  switch (u.status) {
    case 'dev': return { sub: 'Updates are off when running from source' };
    case 'unconfigured': return { sub: "Updates aren't set up for this build" };
    case 'checking': return { sub: 'Checking for updates…', button: 'Checking…', disabled: true };
    case 'current': return {
      sub: `You're up to date${u.lastChecked ? ` · checked ${ago(u.lastChecked / 1000).toLowerCase()}` : ''}`,
      button: 'Check now',
    };
    case 'available': return { sub: `Version ${v} is available`, button: 'Download', banner: `Personae ${v} is available`, action: 'Download' };
    case 'downloading': return {
      sub: `Downloading ${v}… ${u.percent}%`, button: 'Downloading…', disabled: true,
      banner: u.mode === 'manual' ? `Downloading Personae ${v}… ${u.percent}%` : null, // otherwise it's background work
    };
    case 'ready': return installsByItself(u)
      ? { sub: `Version ${v} will install when you're not using Personae`, button: 'Install now', banner: `Personae ${v} will install in the background`, action: 'Install now' }
      : { sub: `Version ${v} is ready to install`, button: 'Install now', banner: `Personae ${v} is ready to install`, action: 'Install' };
    case 'installing': return { sub: `Installing ${v}… Personae will restart`, button: 'Installing…', disabled: true, banner: `Installing Personae ${v}…` };
    case 'error': return { sub: u.error || 'Update check failed', button: 'Try again' };
    default: return { sub: 'Not checked yet', button: 'Check now' };
  }
}

function modeCopy(u) {
  const admin = u.needsAdmin ? ' Windows will ask for admin permission.' : '';
  switch (u.mode) {
    case 'auto': return `Downloads in the background and installs when you're not using Personae — never during a game.${admin}`;
    case 'ask': return `Downloads in the background, then waits for you to install.${admin}`;
    default: return 'Only checks for new versions; you choose when to download.';
  }
}

function runUpdateAction() {
  if (update.status === 'ready') return api.installUpdate();
  if (update.status === 'available') return api.downloadUpdate();
  if (update.status !== 'installing') api.checkForUpdates();
}

function renderUpdate() {
  const copy = updateCopy(update);
  const off = update.status === 'dev' || update.status === 'unconfigured';
  const hasUpdate = Boolean(update.version) && ['available', 'downloading', 'ready', 'installing'].includes(update.status);

  // Banner: only for news worth interrupting for, and not for a version the user already waved off.
  $('#update-banner').hidden = !copy.banner || (settings.dismissedUpdate === update.version && update.status !== 'installing');
  $('#update-text').textContent = copy.banner || '';
  $('#update-notes').hidden = !hasUpdate;
  $('#update-action').hidden = !copy.action;
  $('#update-action').textContent = copy.action || '';
  $('#update-dismiss').hidden = update.status === 'installing';

  // Settings section
  $('#update-title').textContent = `Personae ${update.currentVersion}`;
  $('#update-sub').textContent = copy.sub;
  const btn = $('#update-btn');
  btn.hidden = !copy.button;
  btn.textContent = copy.button || '';
  btn.disabled = Boolean(copy.disabled);

  const notes = $('#update-notes-settings');
  notes.hidden = off;
  notes.textContent = hasUpdate ? `Release notes for ${update.version}` : `What's new in ${update.currentVersion}`;

  $('#updatemode-sub').textContent = off ? 'Available in installed and portable builds' : modeCopy(update);
  $('#row-updatemode').classList.toggle('disabled', off);
  for (const b of page.querySelectorAll('[data-setting="updateMode"] button')) b.disabled = off;
}

const openNotes = () => api.openReleaseNotes(
  ['available', 'downloading', 'ready', 'installing'].includes(update.status) ? update.version : update.currentVersion);

$('#update-action').addEventListener('click', runUpdateAction);
$('#update-btn').addEventListener('click', runUpdateAction);
$('#update-notes').addEventListener('click', openNotes);
$('#update-notes-settings').addEventListener('click', openNotes);
$('#update-dismiss').addEventListener('click', () => updateSettings({ dismissedUpdate: update.version || '' }));

api.onUpdateChanged(next => {
  update = next;
  renderUpdate();
});

document.addEventListener('DOMContentLoaded', async () => {
  update = await api.updateState();
  renderUpdate();

  // First launch after an update (when Personae came back with its window showing).
  const outcome = await api.takeUpdateOutcome();
  if (outcome?.ok) {
    toast(`Updated to ${outcome.version}`, { action: { label: "What's new", run: () => api.openReleaseNotes(outcome.version) } });
  } else if (outcome) {
    toast(`Personae ${outcome.version} wasn't installed. You can install it from Settings → Updates.`, { error: true });
  }
});
