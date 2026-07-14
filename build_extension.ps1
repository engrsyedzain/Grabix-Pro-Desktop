# build_extension.ps1
# Zips the extension directory for distribution (Chrome/Firefox/Edge)

$ExtensionDir = "extension"
$OutputDir = "dist_extension"
$ZipFile = "$OutputDir\grabix_pro_extension.zip"
$XpiFile = "$OutputDir\grabix_pro_extension.xpi"

# Ensure output directory exists
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir
}

# Remove existing zip/xpi
if (Test-Path $ZipFile) { Remove-Item $ZipFile }
if (Test-Path $XpiFile) { Remove-Item $XpiFile }

Write-Host "Zipping extension..." -ForegroundColor Cyan

# Use Compress-Archive to create the ZIP
Compress-Archive -Path "$ExtensionDir\*" -DestinationPath $ZipFile

# Firefox extensions are essentially ZIPs with .xpi extension
Copy-Item $ZipFile $XpiFile

Write-Host "Done! Extension packages created in $OutputDir`:" -ForegroundColor Green
Write-Host " - Chrome/Edge/General: grabix_pro_extension.zip"
Write-Host " - Firefox: grabix_pro_extension.xpi"
