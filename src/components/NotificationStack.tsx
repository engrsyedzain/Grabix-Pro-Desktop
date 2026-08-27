import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, Download, AlertTriangle, X } from 'lucide-react';

type NotifyKind = 'started' | 'finished' | 'error';

/** Mirrors `NotifyPayload` in src-tauri/src/notify.rs. Progress ticks are the
 *  same shape as the cards, arriving on the same event - see the note there on
 *  why this is one channel and not two. */
interface NotifyPayload {
  id: string;
  kind: NotifyKind;
  title: string;
  path?: string | null;
  progress?: number | null;
  speed?: string | null;
  eta?: string | null;
}

/** How long each kind stays on screen. "started" is informational, so it goes
 *  quickly; the other two are outcomes worth reading, and "finished" is also a
 *  button, so it needs long enough to be clicked. */
const DISMISS_MS: Record<NotifyKind, number> = {
  started: 5000,
  finished: 9000,
  error: 9000,
};

/** Keeps a downloading card alive between progress ticks.
 *
 *  A "started" card would otherwise vanish after 5s and leave the rest of a long
 *  download unreported. Rather than making it permanent - which would strand a
 *  card forever if yt-dlp died without a finish or error event - each tick
 *  refreshes this window, so the card outlives the download and no more. */
const PROGRESS_KEEPALIVE_MS = 20000;

/** How long a card stays up, given what just arrived for it. */
function dismissDelay(payload: NotifyPayload): number {
  if (payload.kind === 'started' && typeof payload.progress === 'number') {
    return PROGRESS_KEEPALIVE_MS;
  }
  return DISMISS_MS[payload.kind] ?? 6000;
}

const STYLES: Record<
  NotifyKind,
  { gradient: string; ring: string; label: string; Icon: typeof Download }
> = {
  started: {
    gradient: 'from-[#0f9be0] to-[#3b4fd8]',
    ring: 'ring-[#35bfff]/40',
    label: 'Download started',
    Icon: Download,
  },
  finished: {
    gradient: 'from-[#10b981] to-[#0d9488]',
    ring: 'ring-emerald-300/40',
    label: 'Download complete',
    Icon: CheckCircle2,
  },
  error: {
    gradient: 'from-[#f43f5e] to-[#dc2626]',
    ring: 'ring-rose-300/40',
    label: 'Download failed',
    Icon: AlertTriangle,
  },
};

export default function NotificationStack() {
  const [items, setItems] = useState<NotifyPayload[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);
  const timers = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    window.clearTimeout(timers.current[id]);
    delete timers.current[id];
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const stop = await listen<NotifyPayload>('notify-push', event => {
        const payload = event.payload;

        setItems(prev => {
          const next = prev.filter(i => i.id !== payload.id);
          // Replace rather than append, for both halves of the job: a progress
          // tick updates the card in place, and a download that finishes while
          // its "started" card is still on screen flips that card over instead
          // of stacking a second one for the same download.
          return [...next, payload];
        });

        window.clearTimeout(timers.current[payload.id]);
        timers.current[payload.id] = window.setTimeout(
          () => dismiss(payload.id),
          dismissDelay(payload),
        );
      });

      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;

      // Only now is it safe for Rust to emit. Anything raised before this point
      // is queued on the Rust side and flushed by this call.
      await invoke('notify_ready').catch(() => {});
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      Object.values(timers.current).forEach(window.clearTimeout);
      timers.current = {};
    };
  }, [dismiss]);

  // Drive the window's height from the rendered content. The window is
  // transparent but still eats clicks across its whole rectangle, so it has to
  // be exactly as tall as the cards - no slack, and no window at all when the
  // stack is empty.
  useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el) return;

    const report = () => {
      const height = items.length === 0 ? 0 : Math.ceil(el.getBoundingClientRect().height);
      invoke('notify_resize', { height }).catch(() => {});
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  const open = (item: NotifyPayload) => {
    if (item.kind !== 'finished' || !item.path) return;
    invoke('notify_open_location', { path: item.path }).catch(() => {});
    dismiss(item.id);
  };

  return (
    <div ref={wrapper} className="flex flex-col gap-2 p-2">
      {items.map(item => {
        const style = STYLES[item.kind] ?? STYLES.started;
        const { Icon } = style;
        const clickable = item.kind === 'finished' && !!item.path;

        return (
          <div
            key={item.id}
            onClick={() => open(item)}
            role={clickable ? 'button' : undefined}
            className={`animate-notify-in relative overflow-hidden rounded-2xl bg-gradient-to-br ${style.gradient} p-4 shadow-2xl ring-1 ${style.ring} select-none ${
              clickable ? 'cursor-pointer transition-transform active:scale-[0.98]' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-xl bg-white/20 p-2 text-white">
                <Icon size={18} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold tracking-wide text-white">
                  {item.kind === 'started' && typeof item.progress === 'number'
                    ? 'Downloading'
                    : style.label}
                </p>
                {/* Titles are arbitrary video names: clamp instead of letting one
                    long title grow the window to full screen height. */}
                <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-relaxed text-white/80">
                  {item.title}
                </p>
                {clickable && (
                  <p className="mt-1.5 text-[10px] font-semibold text-white/70">
                    Click to open the file location
                  </p>
                )}
              </div>

              <button
                onClick={e => {
                  e.stopPropagation();
                  dismiss(item.id);
                }}
                aria-label="Dismiss"
                className="shrink-0 rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            {item.kind === 'started' && (
              <>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-black/20">
                  {/* Indeterminate until the first tick arrives: yt-dlp can spend
                      several seconds resolving formats before it reports any
                      percentage, and a bar pinned at 0% reads as "stuck". */}
                  {typeof item.progress === 'number' ? (
                    <div
                      className="h-full rounded-full bg-white/90 transition-all duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-white/70" />
                  )}
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] font-semibold tabular-nums text-white/75">
                  <span>
                    {typeof item.progress === 'number'
                      ? `${item.progress.toFixed(1)}%`
                      : 'Starting...'}
                  </span>
                  <span className="truncate">
                    {[item.speed, item.eta && `ETA ${item.eta}`]
                      .filter(Boolean)
                      .join('  ')}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
