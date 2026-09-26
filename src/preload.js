const { contextBridge, ipcRenderer } = require('electron');

const subscribe = channel => cb => {
  const handler = (_, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('personae', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  steamRunning: () => ipcRenderer.invoke('steam:status'),
  runningGame: () => ipcRenderer.invoke('steam:game'),
  switchTo: accountName => ipcRenderer.invoke('steam:switch', accountName),
  addAccount: () => ipcRenderer.invoke('steam:add'),
  launchSteam: () => ipcRenderer.invoke('steam:launch'),
  remoteAvatar: steamId => ipcRenderer.invoke('avatar:remote', steamId),
  clearAvatarCache: () => ipcRenderer.invoke('avatar:clearCache'),
  openProfile: steamId => ipcRenderer.invoke('open:profile', steamId),
  openSteamFolder: () => ipcRenderer.invoke('open:steamFolder'),
  copy: text => ipcRenderer.invoke('clipboard:write', text),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  minimiseWindow: () => ipcRenderer.invoke('window:minimise'),
  setChrome: colors => ipcRenderer.invoke('window:chrome', colors),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettingsChanged: subscribe('settings:changed'),
  updateState: () => ipcRenderer.invoke('updates:state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openRelease: () => ipcRenderer.invoke('updates:openRelease'),
  onUpdateChanged: subscribe('updates:changed'),
  onOpenSettings: subscribe('settings:open'),
  // Switches can start from the window or the tray; the window follows along via these events.
  onSwitchStart: subscribe('switch:start'),
  onSwitchStep: subscribe('switch:step'),
  onSwitchEnd: subscribe('switch:end'),
});
