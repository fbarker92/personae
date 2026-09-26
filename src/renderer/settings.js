// The settings page and the custom theme editor. Shares globals with app.js (settings, updateSettings, applyTheme…).

const page = $('#settings');
const launchField = page.querySelector('[data-setting="launchArgs"]');

function openSettings() {
  if (state.busy) return;
  closeMenu();
  page.hidden = false;
  syncSettingsPage();
  $('#settings-back').focus();
}

function closeSettings() {
  if (!$('#theme-editor').hidden) closeEditor();
  page.hidden = true;
  $('#settings-btn').focus();
}

// ---------- controls ----------

for (const seg of page.querySelectorAll('.segmented[data-setting]')) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-value]');
    if (b) updateSettings({ [seg.dataset.setting]: b.dataset.value });
  });
}

for (const sw of page.querySelectorAll('.switch[data-setting]')) {
  sw.addEventListener('click', () => updateSettings({ [sw.dataset.setting]: !settings[sw.dataset.setting] }));
}

let launchTimer;
launchField.addEventListener('input', () => {
  clearTimeout(launchTimer);
  launchTimer = setTimeout(() => updateSettings({ launchArgs: launchField.value.trim() }), 400);
});

$('#settings-back').addEventListener('click', closeSettings);

$('#clear-avatars').addEventListener('click', async () => {
  await api.clearAvatarCache();
  state.avatarRequested.clear();
  await refresh();
  toast('Avatar cache cleared');
});

$('#reset-settings').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Reset settings?',
    body: 'Appearance, switching and window options go back to their defaults. Your custom themes and hidden accounts are kept.',
    ok: 'Reset',
  });
  if (!ok) return;
  settings = { ...settings, ...(await api.resetSettings()) };
  applySettings({ animate: true });
  toast('Settings reset');
});

function syncSettingsPage() {
  if (page.hidden) return;

  for (const seg of page.querySelectorAll('.segmented[data-setting]')) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.value === settings[seg.dataset.setting]);
  }
  for (const sw of page.querySelectorAll('.switch[data-setting]')) sw.setAttribute('aria-checked', Boolean(settings[sw.dataset.setting]));
  if (document.activeElement !== launchField) launchField.value = settings.launchArgs || '';

  const canLogin = appInfo.canOpenAtLogin;
  page.querySelector('[data-setting="openAtLogin"]').disabled = !canLogin;
  page.querySelector('[data-setting="startHidden"]').disabled = !canLogin || !settings.openAtLogin;
  $('#row-login').classList.toggle('disabled', !canLogin);
  $('#row-hidden').classList.toggle('disabled', !canLogin || !settings.openAtLogin);
  $('#login-sub').textContent = canLogin ? 'Open Personae when you sign in' : 'Available in the built app (npm run dist)';
  $('#about').textContent = `Personae ${appInfo.version} · Not affiliated with Valve or Steam`.replace('  ', ' ');

  renderSwatches();
}

// ---------- theme swatches ----------

function swatch(theme, { selected = false, editable = false } = {}) {
  const el = $('#swatch-tpl').content.firstElementChild.cloneNode(true);
  const p = resolvePalette(theme, isDark());
  const art = el.querySelector('.swatch-art');
  for (const key of ['bg-0', 'bg-1', 'card', 'accent', 'text', 'play-a', 'play-b']) art.style.setProperty(`--sw-${key}`, p[key]);
  el.querySelector('.swatch-name').textContent = theme.name;
  el.dataset.id = theme.id;
  el.setAttribute('aria-checked', selected);
  if (editable) {
    el.title = 'Double-click to edit';
    art.insertAdjacentHTML('beforeend', '<span class="edit" title="Edit theme"><svg><use href="#i-pencil"/></svg></span>');
  }
  return el;
}

function renderSwatches() {
  $('#official-themes').replaceChildren(...OFFICIAL_THEMES.map(t => swatch(t, { selected: settings.theme === t.id })));

  const add = document.createElement('button');
  add.className = 'swatch new';
  add.innerHTML = '<span class="swatch-art"><svg><use href="#i-plus"/></svg></span><span class="swatch-name">New theme</span>';
  $('#custom-themes').replaceChildren(
    ...settings.customThemes.map(t => swatch(buildCustomTheme(t), { selected: settings.theme === t.id, editable: true })),
    add,
  );
}

$('#official-themes').addEventListener('click', e => {
  const s = e.target.closest('.swatch');
  if (s) updateSettings({ theme: s.dataset.id });
});

$('#custom-themes').addEventListener('click', e => {
  const s = e.target.closest('.swatch');
  if (!s) return;
  if (s.classList.contains('new')) return openEditor();
  const theme = settings.customThemes.find(t => t.id === s.dataset.id);
  if (e.target.closest('.edit')) return openEditor(theme);
  updateSettings({ theme: theme.id });
});

$('#custom-themes').addEventListener('dblclick', e => {
  const s = e.target.closest('.swatch:not(.new)');
  if (s) openEditor(settings.customThemes.find(t => t.id === s.dataset.id));
});

// ---------- custom theme editor ----------

const PRESETS = {
  accent: ['#1a9fff', '#66c0f4', '#c86bff', '#ff4f8b', '#ff8a3d', '#c4b550', '#3ddc97'],
  base: ['#1b2838', '#171a21', '#1e1633', '#2b1a1f', '#16291f', '#2b3025', '#262626'],
  play: ['#6fce1e', '#1a9fff', '#ff4fd8', '#ff8a3d', '#e8c547', '#3ddc97'],
};

let editing = null; // { id, name, accent, base, play } while the editor is open

function seedColors() {
  const t = currentTheme();
  if (t.source) return { ...t.source };
  return { accent: t.dark.accent, base: t.dark['bg-1'], play: t.dark['play-a'] };
}

function openEditor(theme) {
  editing = theme ? { ...theme } : { id: `custom-${Date.now().toString(36)}`, name: '', ...seedColors() };
  $('#te-title').textContent = theme ? 'Edit theme' : 'New theme';
  $('#te-save').textContent = theme ? 'Save changes' : 'Save theme';
  $('#te-name').value = editing.name;
  $('#te-delete').hidden = !theme;
  buildColorRows();
  $('#theme-editor').hidden = false;
  previewEditing();
  $('#te-name').focus();
}

function closeEditor() {
  $('#theme-editor').hidden = true;
  editing = null;
  previewTheme = null;
  applyTheme({ animate: true });
  syncSettingsPage();
}

function buildColorRows() {
  for (const row of document.querySelectorAll('#theme-editor .color-row')) {
    const key = row.dataset.color;
    const chips = PRESETS[key].map(color => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.title = color;
      b.dataset.color = color;
      b.style.setProperty('--chip', color);
      b.onclick = () => setColor(key, color);
      return b;
    });

    const pick = document.createElement('label');
    pick.className = 'color-pick';
    pick.title = 'Pick any colour';
    pick.innerHTML = '<i></i><span></span><input type="color">';
    const input = pick.querySelector('input');
    input.setAttribute('aria-label', `Custom ${key} colour`);
    input.addEventListener('input', () => setColor(key, input.value));

    row.replaceChildren(...chips, pick);
    updateColorRow(row);
  }
}

function updateColorRow(row) {
  const value = editing[row.dataset.color];
  for (const chip of row.querySelectorAll('.chip')) chip.setAttribute('aria-checked', chip.dataset.color === value);
  const pick = row.querySelector('.color-pick');
  pick.style.setProperty('--chip', value);
  pick.querySelector('span').textContent = value.toUpperCase();
  const input = pick.querySelector('input');
  if (document.activeElement !== input) input.value = value;
}

function setColor(key, color) {
  editing[key] = color.toLowerCase();
  updateColorRow(document.querySelector(`#theme-editor .color-row[data-color="${key}"]`));
  previewEditing();
}

function previewEditing() {
  previewTheme = buildCustomTheme({ ...editing, name: editing.name || 'Custom' });
  applyTheme();
}

$('#te-name').addEventListener('input', e => { editing.name = e.target.value; });
$('#te-cancel').addEventListener('click', closeEditor);

$('#te-save').addEventListener('click', () => {
  const theme = { id: editing.id, name: editing.name.trim() || 'Custom', accent: editing.accent, base: editing.base, play: editing.play };
  const list = [...settings.customThemes];
  const at = list.findIndex(t => t.id === theme.id);
  at >= 0 ? (list[at] = theme) : list.push(theme);
  closeEditor();
  updateSettings({ customThemes: list, theme: theme.id });
  toast(`${theme.name} saved`);
});

$('#te-delete').addEventListener('click', async () => {
  const { id, name } = editing;
  const ok = await confirmDialog({ title: `Delete ${name || 'this theme'}?`, body: "This can't be undone.", ok: 'Delete' });
  if (!ok) return;
  closeEditor();
  updateSettings({
    customThemes: settings.customThemes.filter(t => t.id !== id),
    ...(settings.theme === id ? { theme: 'steam' } : {}),
  });
});

$('#theme-editor').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'te-name') $('#te-save').click();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !$('#confirm').hidden) return;
  if (!$('#theme-editor').hidden) { e.preventDefault(); return closeEditor(); }
  if (!page.hidden) { e.preventDefault(); closeSettings(); }
});
