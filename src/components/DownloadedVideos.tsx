import { useMemo, useState } from 'react';
import { HistoryEntry } from '../types';
import { Calendar, Link as LinkIcon, FolderOpen, Trash2, Download, X, RotateCcw, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../hooks/useToast';

type SortKey = 'newest' | 'oldest' | 'title' | 'status';

interface DownloadedVideosProps {
  history: HistoryEntry[];
  onRemove: (timestamp: string) => void;
  onClear: () => void;
  /** Cancels just this download, leaving the rest of the queue running. */
  onCancel: (entry: HistoryEntry) => void;
  /** Re-runs a failed or cancelled download. */
  onRetry: (entry: HistoryEntry) => void;
}

const DownloadedVideos = ({ history, onRemove, onClear, onCancel, onRetry }: DownloadedVideosProps) => {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? history.filter(
          h =>
            h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q),
        )
      : history;

    const byTime = (e: HistoryEntry) => new Date(e.timestamp).getTime();
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return byTime(a) - byTime(b);
        case 'title':
          return a.title.localeCompare(b.title);
        case 'status':
          return (a.status || 'finished').localeCompare(b.status || 'finished');
        default:
          return byTime(b) - byTime(a);
      }
    });
  }, [history, query, sort]);

  const handleOpenLocation = async (path: string | undefined) => {
    if (!path) return;
    try {
      await invoke('open_file_location', { path });
    } catch (e) {
      console.error('Failed to open location:', e);
      toast('Could not open file location. The file may have been moved or deleted.', 'error');
    }
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-2xl font-bold">Download History</h2>
          <p className="text-sm text-grabix-muted">Track and manage your downloads.</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white text-xs font-bold transition-all active:scale-95"
          >
            <Trash2 size={14} />
            CLEAR ALL
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-grabix-dim pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title or URL..."
              className="w-full h-11 pl-11 pr-4 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-sm focus:outline-none focus:border-grabix-purple transition-all"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            aria-label="Sort history"
            className="h-11 px-4 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-xs font-bold focus:outline-none focus:border-grabix-purple transition-all cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title (A–Z)</option>
            <option value="status">Status</option>
          </select>
        </div>
      )}

      {history.length === 0 ? (
        <div className="p-12 rounded-2xl border-2 border-dashed border-grabix-border dark:border-grabix-border-dark flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-grabix-surface dark:bg-grabix-surface-dark rounded-full flex items-center justify-center mb-4">
            <Calendar className="text-grabix-muted" size={32} />
          </div>
          <h3 className="text-lg font-bold">No downloads yet</h3>
          <p className="text-sm text-grabix-muted max-w-xs mx-auto mt-2">
            Your completed downloads will appear here for quick access.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="p-12 rounded-2xl border-2 border-dashed border-grabix-border dark:border-grabix-border-dark text-center">
          <h3 className="text-sm font-bold">No matches</h3>
          <p className="text-xs text-grabix-muted mt-1">
            Nothing in your history matches “{query}”.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((entry) => {
            // Entries written before status tracking existed have no status;
            // treat those as finished so old history still reads correctly.
            const status = entry.status || 'finished';
            const isDownloading = status === 'downloading';
            const isError = status === 'error';
            const isCancelled = status === 'cancelled';

            return (
              <div
                key={entry.timestamp}
                className="group relative p-4 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark hover:border-grabix-purple/30 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h4 className="font-bold text-sm truncate" title={entry.title}>
                        {entry.title}
                      </h4>
                      <span
                        className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider ${
                          isError
                            ? 'bg-red-500/10 text-red-500'
                            : isCancelled
                            ? 'bg-grabix-muted/10 text-grabix-muted'
                            : isDownloading
                            ? 'bg-grabix-purple/10 text-grabix-purple'
                            : 'bg-green-500/10 text-green-500'
                        }`}
                      >
                        {isError
                          ? 'Failed'
                          : isCancelled
                          ? 'Cancelled'
                          : isDownloading
                          ? 'Downloading'
                          : 'Finished'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-y-1 gap-x-4 mt-2 text-[11px] text-grabix-muted">
                      <span className="flex items-center gap-1.5">
                        <Calendar size={12} />
                        {formatDate(entry.timestamp)}
                      </span>
                      <span className="flex items-center gap-1.5 truncate max-w-[200px]">
                        <LinkIcon size={12} />
                        {entry.url}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isDownloading && entry.id && (
                      <button
                        onClick={() => onCancel(entry)}
                        className="p-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                        title="Cancel this download"
                      >
                        <X size={18} />
                      </button>
                    )}
                    {(isError || isCancelled) && (
                      <button
                        onClick={() => onRetry(entry)}
                        className="p-2.5 rounded-xl bg-grabix-purple/10 text-grabix-purple hover:bg-grabix-purple hover:text-white transition-all"
                        title="Retry this download"
                      >
                        <RotateCcw size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenLocation(entry.path)}
                      disabled={!entry.path || isDownloading}
                      className="p-2.5 rounded-xl bg-grabix-purple/10 text-grabix-purple hover:bg-grabix-purple hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-grabix-purple/10 disabled:hover:text-grabix-purple"
                      title="Open Location"
                    >
                      <FolderOpen size={18} />
                    </button>
                    <button
                      onClick={() => onRemove(entry.timestamp)}
                      className="p-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                      title="Remove from history"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {isDownloading && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold text-grabix-purple uppercase tracking-widest">
                      <div className="flex items-center gap-3">
                        <Download size={11} className="animate-pulse" />
                        <span>{entry.speed || '...'}</span>
                        <span>ETA: {entry.eta || '...'}</span>
                      </div>
                      <span>{Math.round(entry.progress || 0)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-grabix-purple/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-grabix-purple rounded-full transition-all duration-300"
                        style={{ width: `${entry.progress || 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DownloadedVideos;
