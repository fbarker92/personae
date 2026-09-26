// Stand-in for the Electron bridge so the UI can be developed in a plain browser (`npm run preview`).
// Inside the app, preload.js has already defined window.personae and this file does nothing.
if (!window.personae) {
  const now = Date.now() / 1000;
  const accounts = [
    { steamId: '76561198000000001', accountName: 'ergonomichamster', personaName: 'ergonomicHamster', timestamp: now - 3600, active: true },
    { steamId: '76561198000000002', accountName: 'hamster_smurf', personaName: 'Definitely Not Hamster', timestamp: now - 86400 * 2 },
    { steamId: '76561198000000003', accountName: 'family_shared', personaName: 'The Barker Household', timestamp: now - 86400 * 9 },
    { steamId: '76561198000000004', accountName: 'dev_testing', personaName: 'build-bot', timestamp: now - 86400 * 45, offline: true },
    { steamId: '76561198000000005', accountName: 'old_main_2014', personaName: 'xX_Hamster_Xx', timestamp: now - 86400 * 400 },
  ].map(a => ({ remembered: true, offline: false, active: false, avatar: null, ...a }));

  let running = true;
  const on = { start: () => {}, step: () => {}, end: () => {} };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function perform(accountName) {
    on.start(accountName);
    on.step('closing'); await wait(900);
    on.step('updating'); await wait(600);
    on.step('starting'); await wait(700);
    for (const a of accounts) a.active = a.accountName === accountName;
    const target = accounts.find(a => a.active);
    if (target) target.timestamp = Date.now() / 1000;
    running = true;
    on.end({ ok: true, accountName });
  }

  const DEFAULT_SETTINGS = {
    mode: 'system', theme: 'steam', customThemes: [], compact: false, showLoginNames: true,
    afterSwitch: 'stay', warnInGame: true, launchArgs: '', closeTo: 'tray', openAtLogin: false, startHidden: true,
    autoUpdate: true, dismissedUpdate: '',
    hiddenAccounts: [], trayHintShown: false,
  };
  const load = () => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('mock:settings')) }; } catch { return { ...DEFAULT_SETTINGS }; } };
  const save = s => { try { localStorage.setItem('mock:settings', JSON.stringify(s)); } catch {} return s; };
  let settings = load();

  window.personae = {
    getSettings: async () => ({ ...settings, canOpenAtLogin: false, version: '0.1.0-preview' }),
    setSettings: async patch => (settings = save({ ...settings, ...patch })),
    resetSettings: async () => (settings = save({ ...DEFAULT_SETTINGS, customThemes: settings.customThemes, hiddenAccounts: settings.hiddenAccounts })),
    onSettingsChanged: () => {},
    onOpenSettings: () => {},
    // Add ?game to the preview URL to simulate a running game.
    runningGame: async () => (location.search.includes('game') ? { appId: 730, name: 'Counter-Strike 2' } : null),
    // Add ?update=available|downloading|ready|current|error to the preview URL to simulate update states.
    updateState: async () => {
      const status = new URLSearchParams(location.search).get('update') || 'current';
      return { status, currentVersion: '0.1.0', version: '0.2.0', percent: 42, error: "Couldn't reach GitHub", lastChecked: Date.now() - 300000, canSelfUpdate: true };
    },
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    installUpdate: async () => {},
    openRelease: async () => {},
    onUpdateChanged: () => {},
    clearAvatarCache: async () => {},
    setChrome: async () => {},
    minimiseWindow: async () => {},
    listAccounts: async () => structuredClone(accounts),
    steamRunning: async () => running,
    switchTo: perform,
    addAccount: () => perform(null),
    launchSteam: async () => { running = true; },
    remoteAvatar: async () => null,
    openProfile: async () => {},
    openSteamFolder: async () => {},
    copy: async text => navigator.clipboard?.writeText(text),
    hideWindow: async () => {},
    onSwitchStart: cb => { on.start = cb; },
    onSwitchStep: cb => { on.step = cb; },
    onSwitchEnd: cb => { on.end = cb; },
  };
}
