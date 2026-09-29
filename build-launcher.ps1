$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
python -m venv work/launcher-venv
if ($LASTEXITCODE) { throw 'Не удалось создать Python venv' }
$launcherPython = Join-Path $PSScriptRoot 'work/launcher-venv/Scripts/python.exe'
& $launcherPython -m pip install 'pyinstaller==6.20.0' 'pystray==0.19.5' 'Pillow==12.3.0'
if ($LASTEXITCODE) { throw 'Не удалось установить PyInstaller' }
& $launcherPython -m PyInstaller --noconfirm --clean --onefile --windowed --name ViewerGcode --icon "$PSScriptRoot/assets/ViewerGcode.ico" --distpath dist --workpath work/launcher-build --specpath work --add-data "$PSScriptRoot/cnc-viewer;cnc-viewer" --add-data "$PSScriptRoot/assets;assets" launcher.py
if ($LASTEXITCODE) { throw 'Не удалось собрать ViewerGcode.exe' }
