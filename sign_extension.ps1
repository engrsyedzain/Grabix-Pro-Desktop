# sign_extension.ps1
# Signs the extension with Mozilla (AMO) and writes a signed .xpi into installer\.
#
# WHY THIS EXISTS
#   Firefox refuses to permanently install an unsigned add-on, and it removed
#   installer-based ("sideloaded") add-ons in version 74 - so no desktop installer
#   can add the extension for the user. A Mozilla-signed .xpi is the only way to
#   ship a Firefox add-on that installs and stays installed.
#
#   Channel "unlisted" (the default here) signs the add-on for self-distribution:
#   Mozilla signs it, but it is NOT published on addons.mozilla.org, so you keep
#   shipping the .xpi yourself. Users still install it by hand (about:addons ->
#   Install Add-on From File) - signing removes the "unsigned" block, not the
#   manual step. Use "listed" instead if you want an AMO listing and review.
#
# CREDENTIALS
#   Generate an API key at https://addons.mozilla.org/developers/addon/api/key/
#   then set them for the session (do not commit these):
#     $env:AMO_JWT_ISSUER = "user:12345678:123"
#     $env:AMO_JWT_SECRET = "<secret>"
#
# USAGE
#   .\sign_extension.ps1                  # unlisted (self-distribution)
#   .\sign_extension.ps1 -Channel listed  # submit to AMO for listing

param(
    [ValidateSet('unlisted', 'listed')]
    [string]$Channel = 'unlisted'
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

if (-not $env:AMO_JWT_ISSUER -or -not $env:AMO_JWT_SECRET) {
    throw @"
AMO credentials are not set. Get a key at
  https://addons.mozilla.org/developers/addon/api/key/
then run:
  `$env:AMO_JWT_ISSUER = "user:12345678:123"
  `$env:AMO_JWT_SECRET = "<secret>"
"@
}

$ExtensionDir = Join-Path $Root "extension"
$OutputDir    = Join-Path $Root "installer"

if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Bump the version in extension\manifest.json before re-signing: AMO rejects a
# version it has already seen, so a repeat sign of the same version will fail.
$manifest = Get-Content (Join-Path $ExtensionDir "manifest.json") -Raw | ConvertFrom-Json
Write-Host "Signing $($manifest.name) v$($manifest.version) on the '$Channel' channel..." -ForegroundColor Cyan

npx --yes web-ext sign `
    --source-dir="$ExtensionDir" `
    --artifacts-dir="$OutputDir" `
    --channel=$Channel `
    --api-key="$env:AMO_JWT_ISSUER" `
    --api-secret="$env:AMO_JWT_SECRET"

if ($LASTEXITCODE -ne 0) { throw "web-ext sign failed with exit code $LASTEXITCODE" }

$signed = Get-ChildItem (Join-Path $OutputDir "*.xpi") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ""
Write-Host "Signed: $($signed.FullName)" -ForegroundColor Green
Write-Host "Install it in Firefox via about:addons -> gear icon -> Install Add-on From File." -ForegroundColor DarkGray
