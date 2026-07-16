# build-installer.ps1
# Builds the app and compiles the Inno Setup installer into dist_installer\.
#
#   .\installer\build-installer.ps1              # full build, then package
#   .\installer\build-installer.ps1 -SkipBuild   # package whatever is in target\release

param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$Iscc = @(
    "C:\Program Files\Inno Setup 7\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 7\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Iscc) {
    throw "ISCC.exe not found. Install Inno Setup, or edit the search paths in this script."
}

if (-not $SkipBuild) {
    # No build_extension.ps1 here: the installer ships extension\ unpacked, not the
    # zip/xpi. Run that script separately when publishing to the browser stores.
    Write-Host "Building the app (npm run tauri build)..." -ForegroundColor Cyan
    Push-Location $Root
    try {
        npm run tauri build
        if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

$MainExe = Join-Path $Root "src-tauri\target\release\grabix-pro.exe"
if (-not (Test-Path $MainExe)) {
    throw "Missing $MainExe. Run without -SkipBuild first."
}

Write-Host "Compiling the installer..." -ForegroundColor Cyan
& $Iscc "$PSScriptRoot\grabix-pro.iss"
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }

$Output = Get-ChildItem (Join-Path $Root "dist_installer\*.exe") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "Done: $($Output.FullName)" -ForegroundColor Green
