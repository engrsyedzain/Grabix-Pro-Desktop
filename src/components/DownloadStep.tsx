import React from 'react';
import { DownloadProgress } from '../types';
import { CloudDownload, CheckCircle, Film } from 'lucide-react';

interface DownloadStepProps {
  progress: DownloadProgress | null;
  onStart: () => void;
  onStop: () => void;
  isDownloading: boolean;
  onReset: () => void;
  url: string;
  selectedFormat: string;
  savePath: string;
  /** Set when more than one video is queued; drives the aggregate bar. */
  queueStats: { total: number; done: number; overall: number } | null;
  thumbnail?: string;
  videoTitle?: string;
}

/**
 * Turns an internal yt-dlp selector into something a human can read.
 * The review screen used to print the raw string, e.g.
 * "bestvideo[height<=1080]+bestaudio/best__aac".
 */
function describeFormat(selector: string): string {
  if (!selector) return 'Best available';

  const [base, codec] = selector.split('__');

  if (base === 'mp3') return 'Audio only · MP3 (320 kbps)';
  if (base === 'aac_audio') return 'Audio only · M4A (AAC)';

  const height = base.match(/height<=(\d+)/)?.[1];
  const label = height
    ? { '2160': '4K · 2160p', '1440': '2K · 1440p', '1080': '1080p · Full HD', '720': '720p · HD' }[height] ??
      `${height}p`
    : base === 'best' || base === 'bestvideo+bestaudio/best'
    ? 'Best available'
    : null;

  const audio = codec === 'opus' ? 'Opus' : codec === 'aac' ? 'AAC' : null;

  // Fall back to the raw id for explicit per-format picks (e.g. "137+140"),
  // which are meaningful to yt-dlp but have no friendly name.
  if (!label) return audio ? `${base} · ${audio}` : base;
  return audio ? `${label} · MP4 (${audio})` : `${label} · MP4`;
}

const DownloadStep: React.FC<DownloadStepProps> = ({
  progress,
  url,
  selectedFormat,
  savePath,
  isDownloading,
  queueStats,
  thumbnail,
  videoTitle,
}) => {
  const isFinished = progress?.status === 'finished';
  // With a multi-item queue the single last-event percentage is meaningless —
  // show progress across the whole queue instead.
  const pct = queueStats ? queueStats.overall : progress?.progress || 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-grabix-purple rounded-full" />
        <h3 className="text-xs font-bold text-grabix-muted uppercase tracking-wider">Step 4 - Download</h3>
      </div>

      {!isDownloading && !isFinished && (
        <div className="p-5 rounded-2xl bg-grabix-purple/5 border border-grabix-purple/10 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <h4 className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest">Review Summary</h4>

          <div className="flex gap-4">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                className="w-32 h-20 object-cover rounded-xl shadow-md shrink-0"
              />
            ) : (
              <div className="w-32 h-20 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark flex items-center justify-center text-grabix-dim shrink-0">
                <Film size={22} />
              </div>
            )}

            <div className="flex-1 min-w-0 space-y-2">
              {videoTitle && (
                <div className="text-sm font-bold truncate text-black dark:text-white" title={videoTitle}>
                  {videoTitle}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold text-grabix-muted uppercase">Format</span>
                <span className="text-xs font-medium text-black dark:text-white">
                  {describeFormat(selectedFormat)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold text-grabix-muted uppercase">Save Location</span>
                <span className="text-xs font-medium truncate text-black dark:text-white" title={savePath}>
                  {savePath}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 pt-1 border-t border-grabix-purple/10">
            <span className="text-[9px] font-bold text-grabix-muted uppercase mt-2">Source URL</span>
            <span className="text-[11px] font-mono truncate text-grabix-muted" title={url}>{url}</span>
          </div>
        </div>
      )}

      <div className="text-center space-y-4">
        <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center transition-all ${
          isFinished ? 'bg-green-500/10 text-green-500' :
          isDownloading ? 'bg-grabix-purple/10 text-grabix-purple animate-pulse' :
          'bg-grabix-surface dark:bg-grabix-input-dark text-grabix-muted'
        }`}>
          {isFinished ? <CheckCircle size={40} /> : <CloudDownload size={40} />}
        </div>

        <div className="space-y-1">
          <h4 className="text-lg font-bold text-black dark:text-white">
            {isFinished ? 'Download Complete!' : isDownloading ? 'Downloading Media...' : 'Ready to Start'}
          </h4>
          <p className="text-xs text-grabix-muted">
            {isDownloading && queueStats
              ? `${queueStats.done} of ${queueStats.total} complete`
              : isDownloading
              ? `Speed: ${progress?.speed || '...'} • ETA: ${progress?.eta || '...'}`
              : isFinished
              ? 'Your file has been saved to the selected folder.'
              : 'Click the button below to begin the extraction process.'}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-grabix-muted">
            {queueStats ? 'QUEUE PROGRESS' : 'PROGRESS'}
          </span>
          <span className="text-[11px] font-bold text-grabix-purple">{Math.round(pct)}%</span>
        </div>
        <div className="h-3 w-full bg-grabix-surface dark:bg-grabix-input-dark rounded-full overflow-hidden border border-grabix-border dark:border-grabix-border-dark">
          <div
            className="h-full bg-grabix-purple transition-all duration-300 shadow-[0_0_10px_rgba(15,155,224,0.5)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default DownloadStep;
