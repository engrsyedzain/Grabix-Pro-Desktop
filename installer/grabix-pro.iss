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
#define AppPublisher   "Grabix"
#define AppUrl         "https://grabix-pro.vercel.app"
#define AppExeName     "GrabixPro.exe"
#define SrcRoot        ".."
#define ReleaseDir     SrcRoot + "\src-tauri\target\release"
#define MainExe        ReleaseDir + "\grabix-pro.exe"

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

OutputDir={#SrcRoot}\dist_installer
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

; Sidecars, sourced from the checked-in binaries dir and stripped of the target
; triple. deps.rs finds them by prefix next to the exe and copies them into app data.
Source: "{#SrcRoot}\src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe";  DestDir: "{app}"; DestName: "ffmpeg.exe";  Flags: ignoreversion
Source: "{#SrcRoot}\src-tauri\binaries\ffprobe-x86_64-pc-windows-msvc.exe"; DestDir: "{app}"; DestName: "ffprobe.exe"; Flags: ignoreversion
Source: "{#SrcRoot}\src-tauri\binaries\yt-dlp-x86_64-pc-windows-msvc.exe";  DestDir: "{app}"; DestName: "yt-dlp.exe";  Flags: ignoreversion

; Browser extension, unpacked so users can load-unpacked it from chrome://extensions.
; The zip/xpi in dist_extension are for store/Firefox distribution, not the installer.
Source: "{#SrcRoot}\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs

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

[Code]
var
  DownloadPage: TDownloadWizardPage;

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
  Result := True;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), @OnDownloadProgress);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if (CurPageID = wpReady) and (not WebView2Installed) then
  begin
    DownloadPage.Clear;
    DownloadPage.Add('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
        { Per-user runtime install, matching this installer's scope: no elevation prompt. }
        if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
                    SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
          MsgBox('The WebView2 runtime could not be installed automatically.' + #13#10 +
                 'Grabix Pro will install, but may show a blank window until you install WebView2 from' + #13#10 +
                 'https://developer.microsoft.com/microsoft-edge/webview2/', mbInformation, MB_OK);
      except
        { A failed download shouldn't block the install - the app may still find a runtime. }
        MsgBox('Could not download the WebView2 runtime:' + #13#10 + GetExceptionMessage + #13#10#13#10 +
               'Setup will continue. If Grabix Pro opens a blank window, install WebView2 from' + #13#10 +
               'https://developer.microsoft.com/microsoft-edge/webview2/', mbInformation, MB_OK);
      end;
    finally
      DownloadPage.Hide;
    end;
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
