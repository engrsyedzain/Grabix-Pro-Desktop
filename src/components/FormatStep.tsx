import React from 'react';
import { VideoInfo, Settings } from '../types';
import { Play, Music, Monitor, List, Check } from 'lucide-react';
import TrimControl from './TrimControl';

interface FormatStepProps {
  info: VideoInfo | null;
  selectedFormat: string;
  setSelectedFormat: (id: string) => void;
  selectedVideos: string[];
  settings: Settings;
  trimEnabled: boolean;
  trimStart: number;
  trimEnd: number;
  onTrimToggle: (enabled: boolean) => void;
  onTrimChange: (start: number, end: number) => void;
}

const FormatStep: React.FC<FormatStepProps> = ({
  info,
  selectedFormat,
  setSelectedFormat,
  selectedVideos,
  settings,
  trimEnabled,
  trimStart,
  trimEnd,
  onTrimToggle,
  onTrimChange,
}) => {
  if (!info) return null;

  const formatSize = (bytes: number) => {
    if (!bytes) return '';
    const mb = bytes / 1024 / 1024;
    if (mb >= 1000) return `(~${(mb / 1024).toFixed(1)} GB)`;
    return `(~${mb.toFixed(1)} MB)`;
  };

  const getQualityLabel = (h: number) => {
    if (h >= 2160) return '4K';
    if (h >= 1440) return '2K';
    if (h >= 1080) return 'Full HD';
    if (h >= 720) return 'HD';
    return 'SD';
  };

  const isPlaylist = info._type === 'playlist' || (info.entries && info.entries.length > 0);

  if (isPlaylist) {
    const selectedEntries = info.entries?.filter(e => selectedVideos.includes(e.id || e.webpage_url || e.url || '')) || [];
    
    // Generic resolutions for playlists
    const playlistResolutions = [
      { id: 'bestvideo+bestaudio/best', label: 'Best Available', desc: 'Auto-select highest quality' },
      { id: 'bestvideo[height<=2160]+bestaudio/best__opus', label: '4K (2160p) — Opus', desc: 'Ultra HD (Fast/VLC)' },
      { id: 'bestvideo[height<=2160]+bestaudio/best__aac', label: '4K (2160p) — AAC', desc: 'Ultra HD (Windows Compatible)' },
      { id: 'bestvideo[height<=1080]+bestaudio/best__opus', label: '1080p — Opus', desc: 'Full HD (Fast/VLC)' },
      { id: 'bestvideo[height<=1080]+bestaudio/best__aac', label: '1080p — AAC', desc: 'Full HD (Windows Compatible)' },
      { id: 'bestvideo[height<=720]+bestaudio/best__opus', label: '720p — Opus', desc: 'High Definition (Fast/VLC)' },
      { id: 'bestvideo[height<=720]+bestaudio/best__aac', label: '720p — AAC', desc: 'High Definition (Windows Compatible)' },
      { id: 'mp3', label: 'Audio Only — MP3', desc: 'High Quality 320kbps' },
      { id: 'aac_audio', label: 'Audio Only — AAC', desc: 'M4A format for Apple/Windows' },
    ];

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-grabix-purple rounded-full" />
          <h3 className="text-xs font-bold text-grabix-muted uppercase tracking-wider">Step 2 - Confirm Playlist Selection</h3>
        </div>

        <div className="p-4 rounded-2xl bg-grabix-purple/5 border border-grabix-purple/10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-grabix-purple/20 flex items-center justify-center text-grabix-purple">
              <List size={20} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-black dark:text-white truncate max-w-[200px]">{info.title}</h4>
              <p className="text-[10px] text-grabix-muted uppercase tracking-wider font-bold">
                {selectedEntries.length} Videos Selected
              </p>
            </div>
          </div>
          <div className="px-3 py-1 rounded-full bg-grabix-purple text-white text-[10px] font-bold">
            Ready to Download
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[11px] text-grabix-muted font-bold flex items-center gap-2 px-1">
            <Play size={14} className="text-grabix-purple" />
            DOWNLOAD QUALITY {settings.defaultResolution === 'custom' ? '(CUSTOM)' : ''}
          </label>
          
          <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
            {settings.defaultResolution === 'custom' ? (
              playlistResolutions.map((res) => (
                <button
                  key={res.id}
                  onClick={() => setSelectedFormat(res.id)}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                    selectedFormat === res.id
                      ? 'border-grabix-purple bg-grabix-purple/5 ring-1 ring-grabix-purple'
                      : 'border-grabix-border dark:border-grabix-border-dark bg-grabix-surface dark:bg-grabix-input-dark'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-grabix-purple flex items-center justify-center text-white">
                      {res.id.includes('audio') || res.id === 'mp3' ? <Music size={16} /> : <Monitor size={16} />}
                    </div>
                    <div className="text-left">
                      <span className="text-sm font-bold block text-black dark:text-white">{res.label}</span>
                      <span className="text-[10px] text-grabix-muted uppercase">{res.desc}</span>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selectedFormat === res.id ? 'border-grabix-purple bg-grabix-purple' : 'border-grabix-border dark:border-grabix-border-dark'
                  }`}>
                    {selectedFormat === res.id && <Check size={12} className="text-white" />}
                  </div>
                </button>
              ))
            ) : (
              <button
                onClick={() => setSelectedFormat('bestvideo+bestaudio/best')}
                className="w-full flex items-center justify-between p-4 rounded-2xl border border-grabix-purple bg-grabix-purple/5 ring-1 ring-grabix-purple transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg bg-grabix-purple flex items-center justify-center text-white">
                    <Monitor size={16} />
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-bold block text-black dark:text-white">Best Available Quality</span>
                    <span className="text-[10px] text-grabix-muted uppercase">Automatic format selection</span>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center border-grabix-purple bg-grabix-purple">
                  <Check size={12} className="text-white" />
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Single Video Formatting Logic replicating grabix-ref.py
  let audioMp3Size = 0;
  let audioAacSize = 0;
  let audioOpusSize = 0;

  if (info.formats) {
    info.formats.forEach(f => {
      const sz = f.filesize || f.filesize_approx || 0;
      if (f.acodec !== 'none' && f.vcodec === 'none') {
        if (f.acodec?.includes('mp3') || f.ext === 'mp3') audioMp3Size = Math.max(audioMp3Size, sz);
        if (f.acodec?.includes('mp4a') || f.ext === 'm4a') audioAacSize = Math.max(audioAacSize, sz);
        if (f.acodec?.includes('opus') || f.ext === 'webm') audioOpusSize = Math.max(audioOpusSize, sz);
      }
    });
  }

  const videoHeights: number[] = [];
  const videoSizes: Record<number, number> = {};
  
  info.formats?.forEach(f => {
    if (f.vcodec !== 'none' && f.resolution) {
      const h = parseInt(f.resolution.split('x')[1]) || parseInt(f.resolution);
      if (h) {
        if (!videoHeights.includes(h)) videoHeights.push(h);
        const sz = f.filesize || f.filesize_approx || 0;
        videoSizes[h] = Math.max(videoSizes[h] || 0, sz);
      }
    }
  });

  videoHeights.sort((a, b) => b - a);

  const formatOptions: any[] = [];
  videoHeights.forEach(h => {
    const vSz = videoSizes[h] || 0;
    const qTag = getQualityLabel(h);
    
    // AAC option (MP4)
    formatOptions.push({
      id: `bestvideo[height<=${h}]+bestaudio/best__aac`,
      label: `${h}p [${qTag}] — MP4 + AAC`,
      desc: 'WINDOWS COMPATIBLE (RECOMMENDED)',
      size: formatSize(vSz + audioAacSize),
      icon: <Monitor size={16} />,
      type: 'video'
    });

    // Opus option (MP4)
    formatOptions.push({
      id: `bestvideo[height<=${h}]+bestaudio/best__opus`,
      label: `${h}p [${qTag}] — MP4 + Opus`,
      desc: 'FAST DOWNLOAD / VLC RECOMMENDED',
      size: formatSize(vSz + audioOpusSize),
      icon: <Play size={16} />,
      type: 'video'
    });
  });

  // Add Audio options
  formatOptions.push({
    id: 'mp3',
    label: 'AUDIO ONLY — MP3',
    desc: '320 KBPS HIGH QUALITY',
    size: formatSize(audioMp3Size),
    icon: <Music size={16} />,
    type: 'audio'
  });
  formatOptions.push({
    id: 'aac_audio',
    label: 'AUDIO ONLY — M4A (AAC)',
    desc: 'APPLE & WINDOWS READY',
    size: formatSize(audioAacSize),
    icon: <Music size={16} />,
    type: 'audio'
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-grabix-purple rounded-full" />
        <h3 className="text-xs font-bold text-grabix-muted uppercase tracking-wider">Step 2 - Choose Quality & Format</h3>
      </div>

      <div className="flex gap-6 p-4 rounded-2xl bg-grabix-bg dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark">
        {info.thumbnail && (
          <img src={info.thumbnail} alt={info.title} className="w-40 h-24 object-cover rounded-lg shadow-md" />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold truncate text-black dark:text-white">{info.title}</h4>
          <p className="text-[10px] text-grabix-muted mt-1">
            Duration: {info.duration ? `${Math.floor(info.duration / 60)}:${(info.duration % 60).toString().padStart(2, '0')}` : 'Unknown'}
          </p>
        </div>
      </div>

      {/* Trimming a whole playlist makes no sense, and we need a duration to bound it. */}
      {!isPlaylist && !!info.duration && (
        <TrimControl
          duration={Math.floor(info.duration)}
          enabled={trimEnabled}
          start={trimStart}
          end={trimEnd}
          onToggle={onTrimToggle}
          onChange={onTrimChange}
        />
      )}

      <div className="space-y-3">
        <label className="text-[11px] text-grabix-muted font-bold flex items-center gap-2 px-1">
          <Play size={14} className="text-grabix-purple" />
          AVAILABLE FORMATS
        </label>

        <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
          {formatOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedFormat(opt.id)}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                selectedFormat === opt.id
                  ? 'border-grabix-purple bg-grabix-purple/5 ring-1 ring-grabix-purple'
                  : 'border-grabix-border dark:border-grabix-border-dark bg-grabix-surface dark:bg-grabix-input-dark'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white ${selectedFormat === opt.id ? 'bg-grabix-purple' : 'bg-grabix-border dark:bg-grabix-border-dark'}`}>
                  {opt.icon}
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold block text-black dark:text-white">{opt.label}</span>
                    <span className="text-[10px] font-mono text-grabix-purple font-bold">{opt.size}</span>
                  </div>
                  <span className="text-[10px] text-grabix-muted uppercase tracking-wider">{opt.desc}</span>
                </div>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                selectedFormat === opt.id ? 'border-grabix-purple bg-grabix-purple' : 'border-grabix-border dark:border-grabix-border-dark'
              }`}>
                {selectedFormat === opt.id && <Check size={12} className="text-white" />}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FormatStep;
