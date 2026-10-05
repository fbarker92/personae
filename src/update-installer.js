// Installs a downloaded MSI or portable update. Both need Personae to have exited first (the MSI replaces files
// in use; the portable .exe is held open by its launcher), so the work happens in a detached PowerShell script
// that waits for this process to exit, installs, and starts Personae again.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = String.raw`
param(
  [Parameter(Mandatory)][ValidateSet('msi', 'portable')][string]$Kind,
  [Parameter(Mandatory)][int]$WaitPid,
  [Parameter(Mandatory)][string]$Package,
  [Parameter(Mandatory)][string]$Target,
  [string]$InstallDir = '',
  [Parameter(Mandatory)][string]$Log
)

# Sticks to plain cmdlets (no .NET calls) so it also works where PowerShell runs in Constrained Language Mode.
function Write-Log($message) { Add-Content -LiteralPath $Log -Value ('{0:u}  {1}' -f (Get-Date), $message) }

Wait-Process -Id $WaitPid -Timeout 60 -ErrorAction SilentlyContinue
Write-Log "Personae exited; installing $Kind update $Package"

if ($Kind -eq 'msi') {
  # /passive shows a progress bar only. The MSI installs for all users, so Windows asks for admin consent.
  # APPLICATIONFOLDER keeps the upgrade in the folder Personae is installed in now.
  $msiArgs = '/i "{0}" /passive /norestart APPLICATIONFOLDER="{1}" /l*v "{2}"' -f $Package, $InstallDir, "$Log.msi.txt"
  $p = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru
  Write-Log "msiexec exited with $($p.ExitCode)" # 0 ok, 3010 ok (reboot pending), 1602 cancelled at the admin prompt
}
else {
  # The portable launcher keeps its .exe open until it has cleaned up after Personae, so retry for a while.
  $copied = $false; $needsAdmin = $false
  $deadline = (Get-Date).AddSeconds(90)
  while (-not $copied -and -not $needsAdmin -and (Get-Date) -lt $deadline) {
    try { Copy-Item -LiteralPath $Package -Destination $Target -Force -ErrorAction Stop; $copied = $true }
    catch {
      # PermissionDenied: the folder needs admin. Anything else (WriteError): the file is still in use.
      if ("$($_.CategoryInfo.Category)" -eq 'PermissionDenied') { $needsAdmin = $true }
      else { Start-Sleep -Milliseconds 500 }
    }
  }
  if ($needsAdmin) {
    Write-Log 'The portable folder needs admin rights; asking for elevation'
    # Windows paths can't contain double quotes, and single quotes are doubled, so this quoting is safe.
    $copy = "Copy-Item -LiteralPath '{0}' -Destination '{1}' -Force -ErrorAction Stop" -f $Package.Replace("'", "''"), $Target.Replace("'", "''")
    try {
      $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ('-NoProfile -Command "{0}"' -f $copy)
      $copied = $p.ExitCode -eq 0
    }
    catch { Write-Log "Elevation declined: $($_.Exception.Message)" }
  }
  Write-Log "Replaced portable exe: $copied"
}

# Start Personae again either way: the new version if it installed, the old one if it didn't.
Start-Process -FilePath $Target
Write-Log 'Relaunched Personae'
`;

/**
 * Hands the install to a background script. Resolves once the script is running independently of Personae,
 * at which point the caller should quit; rejects if it couldn't be started.
 * @param {{ kind: 'msi' | 'portable', packagePath: string, target: string, workDir: string }} opts
 *   target: the .exe to relaunch (and, for portable, to overwrite)
 * @returns {Promise<void>}
 */
function runDetachedInstall({ kind, packagePath, target, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  const script = path.join(workDir, 'install-update.ps1');
  // UTF-8 with BOM so Windows PowerShell 5.1 reads non-ASCII paths correctly.
  fs.writeFileSync(script, '﻿' + SCRIPT, 'utf8');

  const args = [
    'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', script,
    '-Kind', kind,
    '-WaitPid', String(process.pid),
    '-Package', packagePath,
    '-Target', target,
    '-Log', path.join(workDir, 'install-update.log'),
  ];
  if (kind === 'msi') args.push('-InstallDir', path.dirname(target));

  // Node puts ordinary child processes in a job that's killed when Personae exits, and a `detached`
  // powershell.exe has no console, which some machines' PowerShell won't run without. So cmd's START
  // launches it instead: cmd stays in the job and exits at once, while powershell (a grandchild) is allowed
  // out of the job and shares cmd's hidden console. Windows paths can't contain double quotes, so quoting
  // each argument is enough; /s strips the outer quotes from the /c line.
  const line = `"start "" /b ${args.map(a => `"${a}"`).join(' ')}"`;
  return new Promise((resolve, reject) => {
    spawn('cmd.exe', ['/d', '/s', '/c', line], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      .on('error', reject)
      .on('exit', code => (code === 0 ? resolve() : reject(new Error(`Couldn't start the installer (cmd exited ${code})`))));
  });
}

module.exports = { runDetachedInstall };
