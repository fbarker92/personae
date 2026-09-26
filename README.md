# Personae

A small, modern Steam account switcher for Windows.

## Run

```bash
npm install
npm start
```

If `npm start` complains that Electron failed to install, fetch its binary manually:

```bash
node node_modules/electron/install.js
```

## Build for release

```bash
npm run dist
```

This writes three packages to `dist/`:

| File | What it's for |
| --- | --- |
| `Personae-Setup-<version>.exe` | Installer for most people. Per-user, no admin needed, lets you pick the folder |
| `Personae-<version>.msi` | Installs for all users (needs admin); suits Intune/GPO deployment |
| `Personae-<version>-portable.exe` | Runs without installing |

`npm run dist:setup`, `dist:msi` and `dist:portable` build just one. Bump `version` in `package.json` before
each release; installers upgrade in place.

## Releases and auto-update

Personae updates itself from GitHub Releases on the repo named in `package.json` → `repository`.

**One-time setup:** create a **public** GitHub repo (the app can't read a private repo's releases), replace
`YOUR_GITHUB_USERNAME` in `repository` with your username, and push this project to it. Until then, builds
show "Updates aren't set up for this build".

**Each release:**

1. Bump `version` in `package.json` (e.g. `0.2.0`) and commit
2. Tag and push: `git tag v0.2.0 && git push origin main v0.2.0`
3. The *Release* workflow (`.github/workflows/release.yml`) builds on Windows and uploads everything to a
   **draft** release. Review it on GitHub and click **Publish**; installed copies pick it up within 6 hours,
   or straight away via Settings → Updates → Check now.

**What each build does with an update:**

| Build | Behaviour |
| --- | --- |
| Setup `.exe` | Downloads in the background, then offers *Restart* (banner, Settings and tray). Installs on quit if you don't |
| `.msi` / portable | Shows that a new version exists; *Get it* opens the release page. (electron-updater can't replace these in place — MSI updates are for your deployment tool) |

Turning off **Update automatically** in Settings stops background checks; *Check now* still works.

The builds aren't code-signed, so Windows SmartScreen will warn on first run ("More info → Run anyway").
To sign, add a certificate via electron-builder's `win.signtoolOptions` or Azure Trusted Signing (`win.azureSignOptions`).

## How switching works

Steam signs into whichever account `HKCU\Software\Valve\Steam\AutoLoginUser` names, as long as that account has a
remembered login. To switch, Personae:

1. asks Steam to shut down (`steam.exe -shutdown`), force-closing it after 20 s if needed
2. sets `AutoLoginUser` and `RememberPassword`
3. marks the account as most recent in `<Steam>\config\loginusers.vdf` (a backup is kept as `loginusers.vdf.personae.bak`)
4. starts Steam again

**Add account** clears `AutoLoginUser`, so Steam opens on its sign-in screen. Tick *Remember me* and the account
will appear in the list next time.

Accounts only switch silently if Steam still holds a valid remembered login for them. If Steam asks for a
password, sign in once with *Remember me* ticked.

## Tray

Personae lives in the system tray. Closing the window hides it there; **Quit** is in the tray menu.

- **Left-click** the icon to open the window
- **Right-click** for quick switching: your accounts (the current one ticked), *Add account…*, *Launch/Open Steam*,
  and *Start with Windows* (packaged builds only, starts hidden in the tray)

Accounts hidden in the window are left out of the tray menu too. Switches started from the tray show their
progress in the window if it's open, and a Windows notification if something goes wrong while it's hidden.

## Settings

Open with the gear icon, `Ctrl+,`, or **Settings** in the tray menu. Stored in `%APPDATA%\Personae\settings.json`.

- **Appearance**: System / Dark / Light mode; official themes (Steam, Deck, Classic, Midnight, Neon); custom
  themes built from three colours (accent, background tint, play button) with a live preview; compact list;
  hide login names (for streaming)
- **Switching**: stay open, minimise or hide to tray afterwards; warn when a game is running (Personae reads
  `RunningAppID` and looks the name up in your library); Steam launch options such as `-silent`
- **Window & tray**: whether closing the window hides to the tray or quits; start with Windows, optionally
  hidden (packaged builds only)
- **Data**: clear cached avatars; reset settings (keeps custom themes and hidden accounts)

## Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` / `Enter` | Pick and switch |
| `1`–`9` | Switch to the nth account |
| `/` or `Ctrl+F` | Search |
| `Ctrl+N` | Add account |
| `Ctrl+,` | Settings |
| `F5` | Refresh |
| Right-click an account | Profile, copy SteamID, hide |

## Developing the UI

`npm run preview` serves `src/renderer` at http://localhost:5173 with mock accounts (`mock.js`), so the UI can be
worked on in a normal browser without touching Steam. Add `?game` to the URL to simulate a running game, or
`?update=available|downloading|ready|current|error` to see the update states.

## Layout

```
src/main.js        Electron window, tray menu + IPC
src/settings.js    persisted settings with defaults and validation
src/updater.js     GitHub Releases auto-update (electron-updater)
src/renderer/themes.js    official theme palettes + the custom theme generator
src/assets/        app and tray icons (regenerate with scripts/make-icons.ps1)
src/preload.js     the window.personae bridge
src/steam.js       registry, loginusers.vdf, steam.exe process control
src/renderer/      the UI
```
