import React from 'react';
import { Scissors } from 'lucide-react';

/** seconds -> m:ss / h:mm:ss */
export function formatDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

interface TrimControlProps {
  duration: number;
  enabled: boolean;
  start: number;
  end: number;
  onToggle: (enabled: boolean) => void;
  onChange: (start: number, end: number) => void;
}

/**
 * Clip selection. Two independent sliders rather than an overlapping dual-thumb
 * control: each thumb has its own track, so they can't fight over a shared
 * pointer target. Bounds are enforced here — start can never pass end, and
 * neither can leave [0, duration] — so an invalid section can't be constructed.
 */
const TrimControl: React.FC<TrimControlProps> = ({
  duration,
  enabled,
  start,
  end,
  onToggle,
  onChange,
}) => {
  if (!duration || duration <= 0) return null;

  const clipLength = Math.max(0, end - start);
  const leftPct = (start / duration) * 100;
  const widthPct = (clipLength / duration) * 100;

  return (
    <div className="p-5 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg transition-colors ${
              enabled ? 'bg-grabix-purple/10 text-grabix-purple' : 'bg-grabix-muted/10 text-grabix-muted'
            }`}
          >
            <Scissors size={18} />
          </div>
          <div>
            <span className="text-sm font-medium block">Trim clip</span>
            <span className="text-[10px] text-grabix-muted">
              Download only part of this video
            </span>
          </div>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          role="switch"
          aria-checked={enabled}
          aria-label="Trim clip"
          className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
            enabled ? 'bg-grabix-purple' : 'bg-grabix-muted/30'
          }`}
        >
          <div
            className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
              enabled ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Selected region preview */}
          <div className="relative h-2 w-full rounded-full bg-grabix-border dark:bg-grabix-border-dark overflow-hidden">
            <div
              className="absolute h-full bg-grabix-purple rounded-full"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <label className="space-y-2">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                <span className="text-grabix-muted">Start</span>
                <span className="text-grabix-purple font-mono">{formatDuration(start)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={duration}
                step={1}
                value={start}
                onChange={e => {
                  const v = Number(e.target.value);
                  // Keep at least a 1s clip; never let start cross end.
                  onChange(Math.min(v, end - 1), end);
                }}
                className="w-full accent-grabix-purple cursor-pointer"
              />
            </label>

            <label className="space-y-2">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                <span className="text-grabix-muted">End</span>
                <span className="text-grabix-purple font-mono">{formatDuration(end)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={duration}
                step={1}
                value={end}
                onChange={e => {
                  const v = Number(e.target.value);
                  onChange(start, Math.max(v, start + 1));
                }}
                className="w-full accent-grabix-purple cursor-pointer"
              />
            </label>
          </div>

          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-grabix-border dark:border-grabix-border-dark">
            <span className="text-grabix-muted">
              Clip length{' '}
              <span className="font-mono font-bold text-black dark:text-white">
                {formatDuration(clipLength)}
              </span>
            </span>
            <span className="text-grabix-dim font-mono">
              of {formatDuration(duration)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrimControl;
