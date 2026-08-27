; Grabix Pro - Inno Setup script
;
; Builds a per-user installer for the Tauri app. Per-user is not cosmetic: the app
; rewrites grabix_pro_host.json into its own exe directory on every startup
; (src-tauri/src/commands.rs), which a Program Files install would deny to a
; standard user and break browser-extension registration.
;
; Build with installer\build-installer.ps1, or directly:
;   "C:\Program Files\Inno Setup 7\ISCC.exe" installer\grabix-pro.iss

#define AppName        "Grabix Pro"
#define AppPublisher   "Syed Zain"
#define AppUrl         "https://syed-zain.com"
#define AppContact     "me@syed-zain.com"
#define AppExeName     "GrabixPro.exe"

; yt-dlp is fetched at install time rather than shipped. The engine breaks
; whenever a site changes its player, so a copy frozen at build time is stale
; before the installer is even signed. This "latest" URL redirects to the newest
; release asset, so it never needs updating here. The app re-checks on every
; launch (src-tauri/src/engine.rs) and fetches it itself if this download fails,
; which is why nothing below treats a failure as fatal.
#define YtDlpUrl       "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
#define SrcRoot        ".."
#define ReleaseDir     SrcRoot + "\src-tauri\target\release"
#define MainExe        ReleaseDir + "\grabix-pro.exe"

; The Mozilla-signed add-on, as downloaded from AMO. The name carries AMO's
; add-on hash and the version, so it changes with every signed release - update
; this one line, and ISCC will fail loudly here if the file is missing rather
; than quietly shipping an installer without it.
#define SignedXpi      "32b069fdf77d4a03bf62-1.0.3.xpi"

; Version follows the exe metadata, which Tauri stamps from tauri.conf.json,
; so the installer can't drift from the app. Override with ISCC /DAppVersion=x.y.z
#ifndef AppVersion
  #define AppVersion GetVersionNumbersString(MainExe)
#endif

[Setup]
AppId={{8F3A6C21-4E1B-4C7D-9A2E-1B7C5D9E3F40}
AppName={#AppName}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
AppUpdatesURL={#AppUrl}
AppContact={#AppContact}

; Per-user install: no elevation, and {app} stays writable at runtime.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}

; The sidecars are x86_64 builds.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; The app lives in the tray, so an upgrade must be able to shut it down.
CloseApplications=force
RestartApplications=no

; Output lands next to this script. The build artifacts (*.exe, *.zip, *.xpi) are
; gitignored, so this folder tracks only the sources that produce them.
OutputDir=.
OutputBaseFilename=GrabixPro_{#AppVersion}_x64_setup
SetupIconFile={#SrcRoot}\src-tauri\icons\icon.ico
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Main app + native messaging host. The host resolves the app by name in its own
; directory and accepts GrabixPro.exe, so the rename below is safe.
Source: "{#MainExe}"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion
Source: "{#ReleaseDir}\grabix-native-host.exe"; DestDir: "{app}"; Flags: ignoreversion

; FFmpeg sidecars, sourced from the checked-in binaries dir and stripped of the
; target triple. deps.rs finds them by prefix next to the exe and copies them
; into app data. yt-dlp is deliberately not among them - see below.
Source: "{#SrcRoot}\src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe";  DestDir: "{app}"; DestName: "ffmpeg.exe";  Flags: ignoreversion
Source: "{#SrcRoot}\src-tauri\binaries\ffprobe-x86_64-pc-windows-msvc.exe"; DestDir: "{app}"; DestName: "ffprobe.exe"; Flags: ignoreversion

; yt-dlp, downloaded to {tmp} by PrepareToInstall below rather than carried in
; the installer. "external" means Inno reads it off disk at install time;
; "skipifsourcedoesntexist" is what makes a failed download non-fatal - the app
; then fetches the engine itself on first launch.
Source: "{tmp}\yt-dlp.exe"; DestDir: "{app}"; Flags: external ignoreversion skipifsourcedoesntexist

; Browser extension, unpacked so users can load-unpacked it from chrome://extensions.
; The zip/xpi build_extension.ps1 emits are for store distribution, not the installer.
Source: "{#SrcRoot}\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs

; The signed add-on for Firefox, which installs permanently from about:addons.
; Renamed on the way in: AMO's filename is an add-on hash plus a version, which
; means nothing to a user staring at a file picker. It deliberately does NOT live
; in extension\ in the repo - that folder is the input to build_extension.ps1, so
; an .xpi sitting there would be zipped into the next package of itself.
Source: "{#SrcRoot}\installer\{#SignedXpi}"; DestDir: "{app}\extension"; DestName: "grabix-pro-firefox.xpi"; Flags: ignoreversion

; Setup guide for the extension. Neither Chrome nor Firefox permits an installer to
; add an extension for you (Chrome blocked local-CRX external installs in v33;
; Firefox removed sideloading in v74), so the best we can do is hand the user an
; accurate, offline, one-click walkthrough. It reads its own path at runtime to
; print the exact extension folder.
Source: "{#SrcRoot}\installer\extension-setup.html"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; The app creates these itself at startup; we only claim them for uninstall cleanup.
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\grabix_pro_host";  Flags: dontcreatekey uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\grabix_pro_host"; Flags: dontcreatekey uninsdeletekey
Root: HKCU; Subkey: "Software\Mozilla\NativeMessagingHosts\grabix_pro_host";        Flags: dontcreatekey uninsdeletekey

[UninstallDelete]
; Written by the app at runtime, so [Files] doesn't know about them.
Type: files; Name: "{app}\grabix_pro_host.json"
Type: files; Name: "{app}\grabix_pro_host_firefox.json"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\extension-setup.html"; Description: "Set up the browser extension (Chrome / Firefox)"; Flags: shellexec nowait postinstall skipifsilent

[Code]
{ WebView2 runtime is what Tauri renders in; absent it, the window comes up blank.
  Win11 and updated Win10 ship it, so this usually finds it and downloads nothing. }
function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  { Downloads happen on the "Preparing to Install" page, which has no progress
    bar of its own, so report through its status label instead of leaving the
    wizard looking hung on a slow connection. }
  if (ProgressMax > 0) and not WizardSilent then
    WizardForm.StatusLabel.Caption :=
      FileName + ' - ' + IntToStr((Progress * 100) div ProgressMax) + '%';
  Result := True;
end;

{ Warn only where someone is watching. Under /SILENT the messages go to the log,
  and a MsgBox here would be auto-answered and never read. }
procedure WarnYtDlp(const Detail: String);
begin
  Log('yt-dlp: ' + Detail);
  if not WizardSilent then
    MsgBox(Detail + #13#10#13#10 +
           'Setup will continue. Grabix Pro will download the engine itself the' + #13#10 +
           'first time you open it, so make sure you are online then.',
           mbInformation, MB_OK);
end;

procedure WarnWebView2(const Detail: String);
begin
  Log('WebView2: ' + Detail);
  if not WizardSilent then
    MsgBox(Detail + #13#10#13#10 +
           'Setup will continue. If Grabix Pro opens a blank window, install WebView2 from' + #13#10 +
           'https://developer.microsoft.com/microsoft-edge/webview2/', mbInformation, MB_OK);
end;

{ Deliberately PrepareToInstall rather than NextButtonClick(wpReady): silent installs
  skip every wizard page, so page-driven code never runs. This runs in both modes.
  Never fatal - a missing runtime degrades the app, but a failed download shouldn't
  block an install that might well find a runtime anyway. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';

  { The current yt-dlp, straight from GitHub. Best-effort by design: the [Files]
    entry is skipped when this leaves nothing in the temp directory, and the app
    fetches the engine itself on first launch. Never block an install over it. }
  if not WizardSilent then
    WizardForm.StatusLabel.Caption := 'Downloading the yt-dlp download engine...';
  try
    DownloadTemporaryFile('{#YtDlpUrl}', 'yt-dlp.exe', '', @OnDownloadProgress);
    Log('yt-dlp: downloaded the latest release.');
  except
    WarnYtDlp('Could not download the yt-dlp engine: ' + GetExceptionMessage);
  end;

  if WebView2Installed then
  begin
    Log('WebView2: runtime already present, nothing to download.');
    Exit;
  end;

  try
    DownloadTemporaryFile('https://go.microsoft.com/fwlink/p/?LinkId=2124703',
                          'MicrosoftEdgeWebview2Setup.exe', '', @OnDownloadProgress);
    { Per-user runtime install, matching this installer's scope: no elevation prompt. }
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
                SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      WarnWebView2('The WebView2 runtime could not be installed automatically.');
  except
    WarnWebView2('Could not download the WebView2 runtime: ' + GetExceptionMessage);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppData: String;
begin
  { Settings, download history and the app-data copies of yt-dlp/ffmpeg. Kept unless
    explicitly asked for, since history is the kind of thing people reinstall to keep.

    Only ever ask interactively. /SUPPRESSMSGBOXES auto-answers a yes/no MsgBox with
    YES regardless of MB_DEFBUTTON2, so prompting under it would silently delete a
    user's history during an unattended or scripted uninstall. Silent means keep. }
  if CurUninstallStep = usPostUninstall then
  begin
    if UninstallSilent then
      Exit;

    AppData := ExpandConstant('{userappdata}\grabix.pro');
    if DirExists(AppData) then
      if MsgBox('Also delete Grabix Pro settings, download history and the bundled engine copies?' + #13#10 +
                '(' + AppData + ')', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(AppData, True, True, True);
  end;
end;
