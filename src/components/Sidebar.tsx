import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface SidebarProps {
  logs: string[];
  onClear: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ logs, onClear }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the tail as lines arrive — but only when the user is already parked
  // at the bottom, so scrolling back to read an earlier line isn't yanked away.
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const distanceFromBottom =
      pane.scrollHeight - pane.scrollTop - pane.clientHeight;
    if (distanceFromBottom < 80) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs]);

  return (
    <aside className="w-80 h-full border-l border-grabix-border dark:border-grabix-border-dark bg-grabix-surface dark:bg-grabix-surface-dark flex flex-col">
      <div className="px-4 py-3.5 flex items-center justify-between border-b border-grabix-border dark:border-grabix-border-dark">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-grabix-purple" />
          <h2 className="text-xs font-bold text-grabix-muted uppercase tracking-wider">
            Activity Log
          </h2>
          <span className="bg-grabix-purple/10 text-grabix-purple text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
            {logs.length}
          </span>
        </div>
        {logs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] font-bold text-grabix-muted hover:text-grabix-purple transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1 font-mono text-[11px] text-grabix-muted"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-40">
            <Terminal size={28} />
            <span className="italic">No activity yet</span>
          </div>
        ) : (
          <>
            {logs.map((log, i) => (
              <div
                key={i}
                className="whitespace-pre-wrap leading-relaxed rounded px-1 -mx-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                {log}
              </div>
            ))}
            <div ref={endRef} />
          </>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
