# build_extension.ps1
# Packages the browser extension for distribution (Chrome/Edge/Brave and Firefox).
#
# One package serves both: manifest.json declares background.scripts for Firefox
# alongside background.service_worker for Chrome, so the same files load on each.
# Firefox only wants the .xpi extension on the filename.
#
# Output goes to installer\ next to the setup.exe, so every build artifact lives in
# one place and extension\ stays purely source. The artifacts there are gitignored.

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

$ExtensionDir = Join-Path $Root "extension"
$OutputDir    = Join-Path $Root "installer"
$ZipFile      = Join-Path $OutputDir "grabix_pro_extension.zip"
$XpiFile      = Join-Path $OutputDir "grabix_pro_extension.xpi"

if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

if (Test-Path $ZipFile) { Remove-Item $ZipFile }
if (Test-Path $XpiFile) { Remove-Item $XpiFile }

Write-Host "Zipping extension..." -ForegroundColor Cyan

# Deliberately NOT Compress-Archive: on Windows PowerShell 5.1 it writes nested
# entries with backslashes ("icons\icon16.png"), which breaks the ZIP spec - entry
# names must use forward slashes. Browsers then can't resolve icons/icon16.png and
# the extension loads with no icon. Entry names are built by hand so the separator
# is guaranteed regardless of the .NET version underneath.
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($ZipFile, 'Create')
try {
    $prefix = (Resolve-Path $ExtensionDir).Path.TrimEnd('\') + '\'
    Get-ChildItem -Path $ExtensionDir -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($prefix.Length).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally {
    $archive.Dispose()
}

# Fail loudly rather than shipping another silently icon-less package.
$check = [System.IO.Compression.ZipFile]::OpenRead($ZipFile)
try {
    $bad = @($check.Entries | Where-Object { $_.FullName -like '*\*' })
    $iconCount = @($check.Entries | Where-Object { $_.FullName -like 'icons/*' }).Count
}
finally {
    $check.Dispose()
}
if ($bad.Count -gt 0) { throw "Package has $($bad.Count) backslash entries: $($bad[0].FullName)" }
if ($iconCount -eq 0) { throw "Package contains no icons/ entries - browsers would show no icon." }
Write-Host "  verified: forward-slash entries, $iconCount icons packaged" -ForegroundColor DarkGray

# Firefox extensions are essentially ZIPs with an .xpi extension.
Copy-Item $ZipFile $XpiFile -Force

Write-Host "Done! Extension packages created in installer\:" -ForegroundColor Green
Write-Host " - Chrome/Edge/General: grabix_pro_extension.zip"
Write-Host " - Firefox:             grabix_pro_extension.xpi"
Write-Host ""
Write-Host "Note: the .xpi is unsigned. Firefox installs unsigned add-ons permanently" -ForegroundColor Yellow
Write-Host "only after AMO signing; to test now use about:debugging -> Load Temporary Add-on." -ForegroundColor Yellow
