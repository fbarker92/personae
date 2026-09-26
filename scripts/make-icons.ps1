# Renders the Personae mark (two overlapping circles, sky-to-blue gradient) to PNGs in src/assets.
Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\src\assets'
New-Item -ItemType Directory -Force $assets | Out-Null

function Render([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  # Same geometry as the SVG mark: circles r=8.5 at (12,16) and (20,16) on a 32 grid, nudged to fill the square.
  $s = $size / 32.0
  $r = 9.5 * $s
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $sky = [System.Drawing.Color]::FromArgb(255, 0x66, 0xc0, 0xf4)
  $blue = [System.Drawing.Color]::FromArgb(255, 0x2d, 0x73, 0xff)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $sky, $blue, 45.0
  $back = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(150, $sky)), ([System.Drawing.Color]::FromArgb(150, $blue)), 45.0

  $g.FillEllipse($back, [single](11 * $s - $r), [single](16 * $s - $r), [single](2 * $r), [single](2 * $r))
  $g.FillEllipse($brush, [single](21 * $s - $r), [single](16 * $s - $r), [single](2 * $r), [single](2 * $r))

  $bmp.Save((Join-Path $assets $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Render 256 'icon.png'
Render 16 'tray.png'
Render 32 'tray@2x.png'
Render 48 'tray@3x.png'
