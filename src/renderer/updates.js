// Update banner on the main view and the Updates section in settings. State comes from the main process (updater.js).

let update = { status: 'idle', currentVersion: '', canSelfUpdate: false };

function updateCopy(u) {
  const v = u.version;
  switch (u.status) {
    case 'dev': return { sub: 'Updates are off when running from source' };
    case 'unconfigured': return { sub: "Updates aren't set up for this build" };
    case 'checking': return { sub: 'Checking for updates…', button: 'Checking…', disabled: true };
    case 'current': return { sub: `You're up to date${u.lastChecked ? ` · checked ${ago(u.lastChecked / 1000).toLowerCase()}` : ''}`, button: 'Check now' };
    case 'available': return {
      sub: `Version ${v} is available`,
      button: u.canSelfUpdate ? 'Download' : 'Get update',
      banner: `Personae ${v} is available`,
      action: u.canSelfUpdate ? 'Download' : 'Get it',
    };
    case 'downloading': return {
      sub: `Downloading ${v}… ${u.percent}%`, button: 'Downloading…', disabled: true,
      banner: `Downloading Personae ${v}… ${u.percent}%`,
    };
    case 'ready': return {
      sub: `Version ${v} is ready — it installs when Personae restarts`,
      button: 'Restart now',
      banner: `Personae ${v} is ready to install`,
      action: 'Restart',
    };
    case 'error': return { sub: u.error || 'Update check failed', button: 'Try again' };
    default: return { sub: 'Not checked yet', button: 'Check now' };
  }
}

function runUpdateAction() {
  if (update.status === 'ready') return api.installUpdate();
  if (update.status === 'available') return api.downloadUpdate();
  api.checkForUpdates();
}

function renderUpdate() {
  const copy = updateCopy(update);

  // Banner: only for news worth interrupting for, and not for a version the user already waved off.
  const banner = $('#update-banner');
  banner.hidden = !copy.banner || settings.dismissedUpdate === update.version;
  $('#update-text').textContent = copy.banner || '';
  $('#update-action').hidden = !copy.action;
  $('#update-action').textContent = copy.action || '';

  // Settings section
  $('#update-title').textContent = `Personae ${update.currentVersion}`;
  $('#update-sub').textContent = copy.sub;
  const btn = $('#update-btn');
  btn.hidden = !copy.button;
  btn.textContent = copy.button || '';
  btn.disabled = Boolean(copy.disabled);

  const off = update.status === 'dev' || update.status === 'unconfigured';
  $('#row-autoupdate').classList.toggle('disabled', off);
  page.querySelector('[data-setting="autoUpdate"]').disabled = off;
  $('#autoupdate-sub').textContent = update.canSelfUpdate
    ? 'Download new versions in the background and install them on restart'
    : 'Check for new versions every few hours';
}

$('#update-action').addEventListener('click', runUpdateAction);
$('#update-btn').addEventListener('click', runUpdateAction);
$('#update-dismiss').addEventListener('click', () => updateSettings({ dismissedUpdate: update.version || '' }));

api.onUpdateChanged(next => {
  update = next;
  renderUpdate();
});

document.addEventListener('DOMContentLoaded', async () => {
  update = await api.updateState();
  renderUpdate();
});
