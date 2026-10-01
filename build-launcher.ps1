$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$launcherDirectory = Join-Path $PSScriptRoot 'dist/v0.4.0'
$launcherExe = Join-Path $launcherDirectory 'ViewerGcode.exe'
python -m venv work/launcher-venv
if ($LASTEXITCODE) { throw 'Не удалось создать Python venv' }
$launcherPython = Join-Path $PSScriptRoot 'work/launcher-venv/Scripts/python.exe'
& $launcherPython -m pip install 'pyinstaller==6.20.0' 'pystray==0.19.5' 'Pillow==12.3.0'
if ($LASTEXITCODE) { throw 'Не удалось установить PyInstaller' }
# Keep one installed launcher at its existing location, including future builds.
Get-Process ViewerGcode -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $launcherExe } | ForEach-Object { Stop-Process -Id $_.Id -Force; Wait-Process -Id $_.Id -Timeout 10 -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $launcherExe) { Remove-Item -LiteralPath $launcherExe -Force }
& $launcherPython -m PyInstaller --noconfirm --clean --onefile --windowed --name ViewerGcode --icon "$PSScriptRoot/assets/ViewerGcode.ico" --distpath $launcherDirectory --workpath work/launcher-build --specpath work --add-data "$PSScriptRoot/cnc-viewer;cnc-viewer" --add-data "$PSScriptRoot/assets;assets" launcher.py
if ($LASTEXITCODE) { throw 'Не удалось собрать ViewerGcode.exe' }
