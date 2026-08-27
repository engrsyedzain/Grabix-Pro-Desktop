import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, CheckCircle2, Cpu, RefreshCw, X } from 'lucide-react';

/** Mirrors `EngineStatus` in src-tauri/src/engine.rs. */
export interface EngineStatus {
  /** "engine" = yt-dlp, "media" = ffmpeg/ffprobe. */
  component: 'engine' | 'media';
  phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'error';
  message: string;
  progress: number | null;
  version: string | null;
  latest: string | null;
  /** The single source of truth for whether the app is usable right now. */
  blocking: boolean;
}

/** How long the "engine updated" confirmation stays up before fading out. */
const CONFIRM_MS = 6000;

/**
 * Locks the app while yt-dlp, ffmpeg or ffprobe are being fetched.
 *
 * None of the three ship with the app (see engine.rs) - together they are the
 * bulk of what an installer would carry, and yt-dlp goes stale within weeks.
 * Fetching them is not a background nicety: without ffmpeg nothing merges, and
 * running a download against a stale engine is the most common way this app
 * fails. So when there is work to do the UI is covered and the user is told what
 * is happening, rather than left to discover it as a cryptic error later.
 *
 * The overlay is driven entirely by `status.blocking`. An engine that is merely
 * unreachable (offline launch, working copy on disk) is never blocking.
 */
export default function EngineGate() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Whether the overlay has been up during this session, so the confirmation
    // bar only appears after work the user actually watched happen - not on
    // every launch that finds the engine already current.
    let wasBlocking = false;
    let timer = 0;

    const apply = (next: EngineStatus) => {
      setStatus(next);

      if (wasBlocking && !next.blocking && next.phase === 'ready') {
        setConfirm(next.message);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setConfirm(null), CONFIRM_MS);
      }
      wasBlocking = next.blocking;
    };

    (async () => {
      const stop = await listen<EngineStatus>('engine-status', e => apply(e.payload));
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;

      // The provisioning task starts in Rust's `setup`, before this component
      // exists, so the first events are already gone. Read the current status
      // once here; the listener above covers everything after it.
      const current = await invoke<EngineStatus>('get_engine_status').catch(() => null);
      if (current && !cancelled) apply(current);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      window.clearTimeout(timer);
    };
  }, []);

  if (confirm && !status?.blocking) {
    return (
      <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-2xl border border-grabix-border bg-grabix-surface px-4 py-3 shadow-xl dark:border-grabix-border-dark dark:bg-grabix-input-dark">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
          <p className="text-xs font-semibold">{confirm}</p>
          <button
            onClick={() => setConfirm(null)}
            aria-label="Dismiss"
            className="rounded-lg p-1 text-grabix-muted transition-colors hover:text-grabix-purple"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (!status?.blocking) return null;

  const failed = status.phase === 'error';
  const percent = status.progress;
  const media = status.component === 'media';
  const heading = failed
    ? media
      ? 'FFmpeg could not be set up'
      : 'The download engine is missing'
    : media
      ? 'Setting up FFmpeg'
      : status.phase === 'checking'
        ? 'Checking the download engine'
        : status.version
          ? 'Updating the download engine'
          : 'Setting up the download engine';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-6 w-full max-w-md rounded-3xl border border-grabix-border bg-grabix-bg p-8 shadow-2xl dark:border-grabix-border-dark dark:bg-grabix-bg-dark">
        <div
          className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${
            failed ? 'bg-rose-500/10 text-rose-500' : 'bg-grabix-purple/10 text-grabix-purple'
          }`}
        >
          {failed ? <AlertTriangle size={28} /> : <Cpu size={28} />}
        </div>

        <h2 className="text-lg font-bold">{heading}</h2>
        <p className="mt-2 text-xs leading-relaxed text-grabix-muted">
          {status.message ||
            'Grabix Pro keeps yt-dlp current so downloads keep working when sites change.'}
        </p>

        {/* Said once, on the only screen where the wait needs explaining: this
            is the one-off cost of an installer that isn't carrying 175 MB of
            FFmpeg around. It never happens again on this machine. */}
        {media && !failed && (
          <p className="mt-2 text-[11px] leading-relaxed text-grabix-dim">
            A one-time download. FFmpeg merges and converts what you grab, and
            once it is here Grabix Pro never fetches it again.
          </p>
        )}

        {!failed && (
          <>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-grabix-surface dark:bg-grabix-input-dark">
              {/* A server that sends no Content-Length leaves `progress` null, so
                  the bar falls back to an indeterminate sweep rather than sitting
                  frozen at zero. */}
              {percent === null ? (
                <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-grabix-purple" />
              ) : (
                <div
                  className="h-full rounded-full bg-grabix-purple transition-all duration-200"
                  style={{ width: `${Math.round(percent)}%` }}
                />
              )}
            </div>
            <p className="mt-2 text-[10px] font-mono text-grabix-dim">
              {percent === null ? 'Working...' : `${Math.round(percent)}%`}
              {!media && status.latest ? ` - yt-dlp ${status.latest}` : ''}
            </p>
          </>
        )}

        {failed && (
          <button
            onClick={() => invoke('recheck_engine').catch(() => {})}
            className="mt-6 flex items-center gap-2 rounded-2xl bg-grabix-purple px-5 py-3 text-xs font-bold text-white transition-colors hover:bg-grabix-purple-hover"
          >
            <RefreshCw size={16} />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
