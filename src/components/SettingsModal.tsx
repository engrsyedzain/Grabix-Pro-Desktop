import React, { useState } from "react";
import { Settings, HistoryEntry } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  X,
  Save,
  Monitor,
  FileText,
  Layout,
  Zap,
  Download,
  Folder,
  Globe,
  CheckCircle2,
  AlertCircle,
  List,
  RefreshCw,
  Terminal,
  Mail,
  MessageCircle,
  Bell,
} from "lucide-react";

const CONTACT_EMAIL = "me@syed-zain.com";
const CONTACT_WHATSAPP = "+923002652848";
const WEBSITE_URL = "https://syed-zain.com";
// wa.me wants the number without '+' or separators.
const WHATSAPP_URL = `https://wa.me/${CONTACT_WHATSAPP.replace(/\D/g, "")}`;
const MAILTO_URL = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Grabix Pro — Support")}`;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  setSettings: (settings: Settings) => void;
  /** History with live progress merged in (progress is not persisted in settings). */
  history: HistoryEntry[];
  savePath: string;
  onSelectPath: () => void;
}

/** One preference row. Shared so every toggle reads as the same control —
 *  these were previously seven different hardcoded colors. */
const ToggleRow: React.FC<{
  icon: React.ElementType;
  label: string;
  value: boolean;
  onToggle: () => void;
}> = ({ icon: Icon, label, value, onToggle }) => (
  <div className="p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark flex items-center justify-between gap-3 hover:border-grabix-purple/40 transition-colors">
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={`p-2 rounded-lg transition-colors shrink-0 ${
          value
            ? "bg-grabix-purple/10 text-grabix-purple"
            : "bg-grabix-muted/10 text-grabix-muted"
        }`}
      >
        <Icon size={18} />
      </div>
      <span className="text-sm font-medium truncate">{label}</span>
    </div>
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
        value ? "bg-grabix-purple" : "bg-grabix-muted/30"
      }`}
    >
      <div
        className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
          value ? "left-6" : "left-1"
        }`}
      />
    </button>
  </div>
);

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  setSettings,
  history,
  savePath,
  onSelectPath,
}) => {
  const [activeTab, setActiveTab] = useState<"settings" | "history" | "about">(
    "settings",
  );
  const [extensionStatus, setExtensionStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [extensionId, setExtensionId] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // yt-dlp engine
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [updateMsg, setUpdateMsg] = useState("");
  // Read from the bundle manifest rather than hardcoded — the old "1.0.0"
  // string had already drifted from the real 0.1.1.
  const [appVersion, setAppVersion] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      invoke<boolean>("check_extension_status")
        .then(res => setIsRegistered(res))
        .catch(() => setIsRegistered(false));

      invoke<string>("get_ytdlp_version")
        .then(v => setYtdlpVersion(v))
        .catch(() => setYtdlpVersion(null));

      invoke<string>("get_app_version")
        .then(v => setAppVersion(v))
        .catch(() => setAppVersion(null));
    }
  }, [isOpen]);

  // Esc closes the modal, as every other dialog on the platform does.
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const updateSetting = (key: keyof Settings, value: any) => {
    setSettings({ ...settings, [key]: value });
  };

  const clearHistory = () => {
    setSettings({ ...settings, history: [] });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  const handleUpdateYtdlp = async () => {
    setUpdateStatus("loading");
    setUpdateMsg("");
    try {
      const result = await invoke<string>("update_ytdlp");
      setUpdateStatus("success");
      setUpdateMsg(result || "yt-dlp is up to date.");
      // Re-read the version so the badge reflects whatever we just installed.
      const v = await invoke<string>("get_ytdlp_version").catch(() => null);
      if (v) setYtdlpVersion(v);
    } catch (e) {
      setUpdateStatus("error");
      setUpdateMsg(typeof e === "string" ? e : "Failed to update yt-dlp.");
    }
  };

  const handleSetupExtension = async () => {
    if (!extensionId) {
      setExtensionStatus("error");
      setStatusMsg("Please enter your Extension ID first.");
      return;
    }

    setExtensionStatus("loading");
    try {
      const result = await invoke<string>("setup_browser_extension", { extensionId });
      setExtensionStatus("success");
      setStatusMsg("Browser extension host registered successfully!");
      setIsRegistered(true);
      console.log(result);
    } catch (e) {
      setExtensionStatus("error");
      setStatusMsg(typeof e === "string" ? e : "Failed to register host.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-grabix-bg dark:bg-grabix-bg-dark rounded-3xl border border-grabix-border dark:border-grabix-border-dark shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-8 py-6 border-b border-grabix-border dark:border-grabix-border-dark flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-black dark:text-white">
              Grabix Control Center
            </h2>
            <p className="text-xs text-grabix-muted mt-1">
              Manage preferences, history and about
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-grabix-surface dark:hover:bg-grabix-border-dark text-grabix-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-grabix-border dark:border-grabix-border-dark px-8">
          {(["settings", "history", "about"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 text-xs font-bold uppercase tracking-widest transition-all relative ${
                activeTab === tab
                  ? "text-grabix-purple"
                  : "text-grabix-dim hover:text-grabix-muted"
              }`}
            >
              {tab}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-6 right-6 h-0.5 bg-grabix-purple rounded-full" />
              )}
            </button>
          ))}
        </div>

        <div className="px-8 py-8 overflow-y-auto max-h-[60vh] custom-scrollbar">
          {activeTab === "settings" && (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* Download Engine Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest">
                    Download Engine
                  </h3>
                  {ytdlpVersion && (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-grabix-purple/10 text-grabix-purple font-mono">
                      {ytdlpVersion}
                    </span>
                  )}
                </div>

                <div className="p-5 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-5">
                    <div className="w-14 h-14 bg-grabix-purple/10 rounded-2xl flex items-center justify-center text-grabix-purple shrink-0">
                      <Terminal size={28} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h4 className="text-sm font-bold">yt-dlp Engine</h4>
                      <p className="text-[11px] text-grabix-muted leading-relaxed">
                        Sites change often, so Grabix Pro checks for a newer
                        engine every time it starts and installs one when it
                        finds it. Use this to pull a fix in mid-session.
                      </p>
                    </div>
                    <button
                      onClick={handleUpdateYtdlp}
                      disabled={updateStatus === "loading"}
                      className={`h-11 px-6 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 shrink-0 disabled:opacity-70 disabled:cursor-not-allowed ${
                        updateStatus === "success"
                          ? "bg-green-500 text-white shadow-green-500/20"
                          : updateStatus === "error"
                          ? "bg-red-500 text-white shadow-red-500/20"
                          : "bg-grabix-purple hover:bg-grabix-purple-hover text-white shadow-grabix-purple/20"
                      }`}
                    >
                      <RefreshCw
                        size={14}
                        className={updateStatus === "loading" ? "animate-spin" : ""}
                      />
                      {updateStatus === "loading"
                        ? "Updating..."
                        : updateStatus === "success"
                        ? "Updated"
                        : updateStatus === "error"
                        ? "Retry"
                        : "Update"}
                    </button>
                  </div>

                  {updateStatus !== "idle" && updateStatus !== "loading" && updateMsg && (
                    <div
                      className={`p-3 rounded-xl text-[10px] leading-tight border ${
                        updateStatus === "success"
                          ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
                          : "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1 font-bold uppercase tracking-tighter">
                        {updateStatus === "success" ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <AlertCircle size={12} />
                        )}
                        {updateStatus === "success" ? "Success" : "Error"}
                      </div>
                      <div className="whitespace-pre-wrap opacity-90 font-mono">
                        {updateMsg}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Browser Extension Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest">
                    Browser Integration
                  </h3>
                  {isRegistered !== null && (
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${isRegistered ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                      {isRegistered ? 'CONNECTED' : 'DISCONNECTED'}
                    </span>
                  )}
                </div>
                
                <div className="p-5 rounded-2xl bg-grabix-purple/5 border border-grabix-purple/20 space-y-5">
                  <div className="flex flex-col md:flex-row items-start gap-6">
                    <div className="w-14 h-14 bg-grabix-purple/10 rounded-2xl flex items-center justify-center text-grabix-purple shrink-0">
                      <Globe size={28} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h4 className="text-sm font-bold">Browser Extension Connection</h4>
                      <p className="text-[11px] text-grabix-muted leading-relaxed">
                        To enable one-click downloads, enter your Extension ID from <span className="font-mono text-grabix-purple underline cursor-pointer" onClick={() => copyToClipboard('chrome://extensions')}>chrome://extensions</span> and click register.
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <input 
                        type="text" 
                        value={extensionId}
                        onChange={(e) => setExtensionId(e.target.value)}
                        placeholder="Paste Extension ID here..."
                        className="w-full h-11 px-4 rounded-xl bg-white dark:bg-black/20 border border-grabix-border dark:border-grabix-border-dark text-xs focus:outline-none focus:border-grabix-purple transition-all"
                      />
                    </div>
                    <button 
                      onClick={handleSetupExtension}
                      disabled={extensionStatus === "loading"}
                      className={`h-11 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg active:scale-95 ${
                        extensionStatus === "success" 
                          ? "bg-green-500 text-white shadow-green-500/20" 
                          : extensionStatus === "error"
                          ? "bg-red-500 text-white shadow-red-500/20"
                          : "bg-grabix-purple hover:bg-grabix-purple-hover text-white shadow-grabix-purple/20"
                      }`}
                    >
                      {extensionStatus === "loading" ? "Wait..." : 
                       extensionStatus === "success" ? "Registered" : 
                       extensionStatus === "error" ? "Retry" : "Register Host"}
                    </button>
                  </div>

                  {extensionStatus !== "idle" && (
                    <div className={`p-3 rounded-xl text-[10px] leading-tight border ${
                      extensionStatus === "success" ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400" : "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
                    }`}>
                      <div className="flex items-center gap-2 mb-1 font-bold uppercase tracking-tighter">
                        {extensionStatus === "success" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        {extensionStatus === "success" ? "Success" : "Error"}
                      </div>
                      <div className="whitespace-pre-wrap opacity-90">{statusMsg}</div>
                    </div>
                  )}

                  {!isRegistered && extensionStatus === "idle" && (
                    <div className="space-y-2 mt-4">
                      <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] leading-relaxed">
                        <strong>Manual Setup (Chrome/Edge/Brave):</strong> If automatic registration fails, run this in PowerShell: <br/>
                        <code className="bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded block mt-1 select-all break-all">New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\grabix_pro_host" -Force</code>
                      </div>
                      <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/10 text-orange-700 dark:text-orange-400 text-[10px] leading-relaxed">
                        <strong>Manual Setup (Firefox):</strong> For Firefox, run this in PowerShell: <br/>
                        <code className="bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded block mt-1 select-all break-all">New-Item -Path "HKCU:\Software\Mozilla\NativeMessagingHosts\grabix_pro_host" -Force</code>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* General Section */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest px-1">
                  General Behavior
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ToggleRow
                    icon={Zap}
                    label="Auto-Advance Steps"
                    value={settings.autoAdvance}
                    onToggle={() => updateSetting("autoAdvance", !settings.autoAdvance)}
                  />
                  <ToggleRow
                    icon={Save}
                    label="Auto-Paste URL"
                    value={settings.autoPaste}
                    onToggle={() => updateSetting("autoPaste", !settings.autoPaste)}
                  />
                  <ToggleRow
                    icon={Layout}
                    label="Show Activity Log"
                    value={settings.showActivity}
                    onToggle={() => updateSetting("showActivity", !settings.showActivity)}
                  />
                  <ToggleRow
                    icon={Monitor}
                    label="Show Thumbnails"
                    value={settings.showThumbnail}
                    onToggle={() => updateSetting("showThumbnail", !settings.showThumbnail)}
                  />
                  <ToggleRow
                    icon={Folder}
                    label="Auto-Open Folder"
                    value={settings.autoOpenFolder}
                    onToggle={() => updateSetting("autoOpenFolder", !settings.autoOpenFolder)}
                  />
                  <ToggleRow
                    icon={Bell}
                    label="Desktop Notifications"
                    value={settings.desktopNotifications}
                    onToggle={() =>
                      updateSetting("desktopNotifications", !settings.desktopNotifications)
                    }
                  />
                </div>
              </section>

              {/* Download Config Section */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest px-1">
                  Download Configuration
                </h3>
                <div className="space-y-4">
                  <div className="p-5 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-sm font-medium">
                        <div className="p-2 rounded-lg bg-grabix-purple/10 text-grabix-purple">
                          <Download size={18} />
                        </div>
                        Default Download Path
                      </div>
                      <button
                        onClick={onSelectPath}
                        className="text-[10px] font-bold text-grabix-purple hover:underline"
                      >
                        Change Path
                      </button>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-black/20 border border-grabix-border dark:border-grabix-border-dark text-[11px] font-mono text-grabix-muted truncate">
                      {savePath || "Not set (will ask every time)"}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-3">
                      <span className="text-[11px] font-bold text-grabix-muted block">
                        CONCURRENT DOWNLOADS
                      </span>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((num) => (
                          <button
                            key={num}
                            onClick={() =>
                              updateSetting("concurrentDownloads", num)
                            }
                            className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all ${
                              settings.concurrentDownloads === num
                                ? "bg-grabix-purple text-white shadow-lg shadow-grabix-purple/20"
                                : "bg-white dark:bg-black/20 border border-grabix-border dark:border-grabix-border-dark hover:border-grabix-purple/50"
                            }`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-3">
                      <span className="text-[11px] font-bold text-grabix-muted block text-right">
                        DEFAULT RESOLUTION
                      </span>
                      <select
                        value={settings.defaultResolution}
                        onChange={(e) =>
                          updateSetting("defaultResolution", e.target.value)
                        }
                        className="w-full h-9 rounded-lg text-[10px] font-bold bg-white dark:bg-black/20 border border-grabix-border dark:border-grabix-border-dark px-2 focus:outline-none"
                      >
                        <option value="custom">Custom Selection</option>
                        <optgroup label="MP4 + AAC (Recommended)">
                          <option value="2160p__aac">4K (2160p) — AAC</option>
                          <option value="1440p__aac">2K (1440p) — AAC</option>
                          <option value="1080p__aac">1080p — AAC</option>
                          <option value="720p__aac">720p — AAC</option>
                        </optgroup>
                        <optgroup label="MP4 + Opus (Fast)">
                          <option value="2160p__opus">4K (2160p) — Opus</option>
                          <option value="1440p__opus">2K (1440p) — Opus</option>
                          <option value="1080p__opus">1080p — Opus</option>
                          <option value="720p__opus">720p — Opus</option>
                        </optgroup>
                        <optgroup label="Audio Only">
                          <option value="audio-mp3">Audio — MP3 (320k)</option>
                          <option value="audio-aac">Audio — AAC (M4A)</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-3">
                      <span className="text-[11px] font-bold text-grabix-muted block">
                        SIGN IN VIA BROWSER COOKIES
                      </span>
                      <select
                        value={settings.cookiesFromBrowser}
                        onChange={(e) => updateSetting("cookiesFromBrowser", e.target.value)}
                        className="w-full h-9 rounded-lg text-[10px] font-bold bg-white dark:bg-black/20 border border-grabix-border dark:border-grabix-border-dark px-2 focus:outline-none"
                      >
                        <option value="">Off (public videos only)</option>
                        <option value="chrome">Google Chrome</option>
                        <option value="edge">Microsoft Edge</option>
                        <option value="firefox">Mozilla Firefox</option>
                        <option value="brave">Brave</option>
                        <option value="opera">Opera</option>
                        <option value="vivaldi">Vivaldi</option>
                      </select>
                      <p className="text-[9px] text-grabix-dim leading-relaxed">
                        Reuses your browser session so age-restricted, private and
                        members-only videos can be downloaded. Close the browser first
                        if it locks its cookie database.
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-3">
                      <span className="text-[11px] font-bold text-grabix-muted block">
                        SPEED LIMIT
                      </span>
                      <select
                        value={settings.limitRate}
                        onChange={(e) => updateSetting("limitRate", e.target.value)}
                        className="w-full h-9 rounded-lg text-[10px] font-bold bg-white dark:bg-black/20 border border-grabix-border dark:border-grabix-border-dark px-2 focus:outline-none"
                      >
                        <option value="">Unlimited</option>
                        <option value="500K">500 KB/s</option>
                        <option value="1M">1 MB/s</option>
                        <option value="2M">2 MB/s</option>
                        <option value="5M">5 MB/s</option>
                        <option value="10M">10 MB/s</option>
                      </select>
                      <p className="text-[9px] text-grabix-dim leading-relaxed">
                        Caps download bandwidth so Grabix does not saturate your
                        connection.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToggleRow
                      icon={FileText}
                      label="Download Subtitles"
                      value={settings.dlSubtitles}
                      onToggle={() => updateSetting("dlSubtitles", !settings.dlSubtitles)}
                    />
                    <ToggleRow
                      icon={List}
                      label="Playlist Download"
                      value={settings.playlistDownload}
                      onToggle={() =>
                        updateSetting("playlistDownload", !settings.playlistDownload)
                      }
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest">
                  Download History
                </h3>
                <button
                  onClick={clearHistory}
                  className="text-[10px] font-bold text-red-500 hover:underline"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-3">
                {!history || history.length === 0 ? (
                  <div className="py-20 text-center opacity-30">
                    <Download size={48} className="mx-auto mb-4" />
                    <p className="text-sm font-medium">
                      No history recorded yet.
                    </p>
                  </div>
                ) : (
                  history.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark flex flex-col gap-3 group"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold truncate text-black dark:text-white">
                            {item.title}
                          </h4>
                          <p className="text-[10px] text-grabix-muted truncate mt-1">
                            {item.url}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                           {item.status === 'finished' && item.path && (
                             <button
                               onClick={() => invoke('open_file_location', { path: item.path })}
                               className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all"
                               title="Open Folder"
                             >
                               <Folder size={16} />
                             </button>
                           )}
                           <button
                             onClick={() => copyToClipboard(item.url)}
                             className="p-2 rounded-lg bg-grabix-purple/10 text-grabix-purple hover:bg-grabix-purple hover:text-white transition-all"
                             title="Copy URL"
                           >
                             <Save size={16} />
                           </button>
                        </div>
                      </div>

                      {item.status === 'downloading' && (
                        <div className="space-y-2 animate-pulse">
                          <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-grabix-purple">
                            <div className="flex gap-3">
                              <span>{item.speed || '...'}</span>
                              <span>ETA: {item.eta || '...'}</span>
                            </div>
                            <span>{Math.round(item.progress || 0)}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-grabix-purple/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-grabix-purple transition-all duration-300" 
                              style={{ width: `${item.progress || 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {item.status === 'error' && (
                        <div className="text-[9px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1">
                          <AlertCircle size={10} />
                          Download Failed
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-grabix-border/50 dark:border-grabix-border-dark/50">
                        <span className="text-[9px] font-medium text-grabix-dim uppercase">
                          {new Date(item.timestamp).toLocaleDateString()} at {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                          item.status === 'finished' ? 'bg-green-500/10 text-green-500' : 
                          item.status === 'error' ? 'bg-red-500/10 text-red-500' :
                          'bg-grabix-purple/10 text-grabix-purple'
                        }`}>
                          {item.status || 'finished'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === "about" && (
            <div className="space-y-8 animate-in fade-in duration-300 text-center py-4">
              <div className="space-y-2">
                <img
                  src="/icon.png"
                  alt="Grabix Pro"
                  className="w-20 h-20 rounded-2xl mx-auto mb-4 shadow-xl shadow-black/25 select-none"
                  draggable={false}
                />
                <h3 className="text-2xl font-black text-black dark:text-white">
                  Grabix Pro
                </h3>
                <p className="text-xs font-bold text-grabix-purple uppercase tracking-widest">
                  {appVersion ? `Version ${appVersion}` : "Version —"}
                </p>
                {ytdlpVersion && (
                  <p className="text-[10px] text-grabix-dim font-mono">
                    yt-dlp {ytdlpVersion}
                  </p>
                )}
              </div>

              <div className="max-w-md mx-auto space-y-4">
                <p className="text-sm text-grabix-muted leading-relaxed">
                  A high-quality media extraction tool built with modern web
                  technologies and powered by the industry-standard yt-dlp
                  engine.
                </p>

                <div className="flex flex-wrap justify-center gap-2">
                  {["React", "Tauri", "Rust", "yt-dlp", "FFmpeg"].map(
                    (tech) => (
                      <span
                        key={tech}
                        className="px-3 py-1 rounded-full bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-[10px] font-bold text-grabix-muted"
                      >
                        {tech}
                      </span>
                    ),
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="max-w-md mx-auto space-y-3 pt-4">
                <p className="text-[10px] font-bold text-grabix-muted uppercase tracking-widest">
                  Need help? Contact the developer
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => openUrl(WEBSITE_URL)}
                    className="group flex items-center gap-3 p-3 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark hover:border-grabix-purple transition-all text-left active:scale-[0.98] sm:col-span-2"
                  >
                    <div className="p-2 rounded-lg bg-grabix-purple/10 text-grabix-purple shrink-0">
                      <Globe size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-grabix-muted uppercase tracking-wider">
                        Website
                      </div>
                      <div className="text-[11px] font-medium truncate text-black dark:text-white group-hover:text-grabix-purple transition-colors">
                        syed-zain.com
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => openUrl(MAILTO_URL)}
                    className="group flex items-center gap-3 p-3 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark hover:border-grabix-purple transition-all text-left active:scale-[0.98]"
                  >
                    <div className="p-2 rounded-lg bg-grabix-purple/10 text-grabix-purple shrink-0">
                      <Mail size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-grabix-muted uppercase tracking-wider">
                        Email
                      </div>
                      <div className="text-[11px] font-medium truncate text-black dark:text-white group-hover:text-grabix-purple transition-colors">
                        {CONTACT_EMAIL}
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => openUrl(WHATSAPP_URL)}
                    className="group flex items-center gap-3 p-3 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark hover:border-green-500 transition-all text-left active:scale-[0.98]"
                  >
                    <div className="p-2 rounded-lg bg-green-500/10 text-green-500 shrink-0">
                      <MessageCircle size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-grabix-muted uppercase tracking-wider">
                        WhatsApp
                      </div>
                      <div className="text-[11px] font-medium truncate text-black dark:text-white group-hover:text-green-500 transition-colors">
                        {CONTACT_WHATSAPP}
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="pt-8 border-t border-grabix-border dark:border-grabix-border-dark">
                <p className="text-[10px] font-bold text-grabix-dim uppercase tracking-tighter">
                  Developed by
                </p>
                <p className="text-lg font-black text-grabix-purple">SYED ZAIN</p>
                <button
                  onClick={() => openUrl(WEBSITE_URL)}
                  className="text-[10px] font-bold text-grabix-muted hover:text-grabix-purple transition-colors"
                >
                  syed-zain.com
                </button>
                <p className="text-[10px] text-grabix-muted mt-2">
                  © 2025 All Rights Reserved
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-8 py-6 bg-grabix-surface dark:bg-black/20 border-t border-grabix-border dark:border-grabix-border-dark flex items-center justify-between">
          <div className="text-[10px] text-grabix-muted uppercase tracking-widest font-bold">
            Control Center
          </div>
          <button
            onClick={onClose}
            className="px-8 py-3 rounded-xl bg-grabix-purple hover:bg-grabix-purple-hover text-white text-xs font-bold transition-all shadow-lg shadow-grabix-purple/20 active:scale-[0.98]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
