import React, { useState } from 'react';
import { VideoInfo } from '../types';
import { Check, List, Search } from 'lucide-react';

interface PlaylistStepProps {
  info: VideoInfo;
  selectedVideos: string[]; // array of ids or webpage_urls
  toggleVideo: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onContinue: () => void;
  settings: any;
}

const PlaylistStep: React.FC<PlaylistStepProps> = ({ info, selectedVideos, toggleVideo, onSelectAll, onDeselectAll, onContinue, settings }) => {
  const [search, setSearch] = useState('');
  const [sortMethod, setSortMethod] = useState<'none' | 'title' | 'duration'>('none');
  const entries = info.entries || [];
  
  const filteredEntries = entries
    .filter(e => e.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortMethod === 'title') return a.title.localeCompare(b.title);
      if (sortMethod === 'duration') return (b.duration || 0) - (a.duration || 0);
      return 0;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-grabix-purple rounded-full" />
          <h3 className="text-xs font-bold text-grabix-muted uppercase tracking-wider">
            {info.title || 'Playlist'} ({entries.length} videos)
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setSortMethod('title')}
              className={`text-[10px] font-bold hover:underline ${sortMethod === 'title' ? 'text-grabix-purple' : 'text-grabix-dim'}`}
            >
              Sort Title
            </button>
            <span className="text-grabix-border">|</span>
            <button 
              onClick={() => setSortMethod('duration')}
              className={`text-[10px] font-bold hover:underline ${sortMethod === 'duration' ? 'text-grabix-purple' : 'text-grabix-dim'}`}
            >
              Sort Duration
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onSelectAll}
              className="text-[10px] font-bold text-grabix-purple hover:underline"
            >
              Select All
            </button>
            <span className="text-grabix-border">|</span>
            <button 
              onClick={onDeselectAll}
              className="text-[10px] font-bold text-grabix-dim hover:underline"
            >
              Deselect All
            </button>
          </div>
          <button 
            onClick={onContinue}
            disabled={selectedVideos.length === 0}
            className="text-xs font-bold text-grabix-purple hover:underline disabled:opacity-50 transition-all"
          >
            Continue with {selectedVideos.length} videos
          </button>
        </div>
      </div>

      <div className="relative">
        <input 
          type="text" 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter videos..." 
          className="w-full h-10 px-4 pr-10 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-xs focus:outline-none transition-all"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-grabix-dim">
          <Search size={14} />
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
        {entries.length === 0 && (
          <div className="py-12 flex flex-col items-center justify-center space-y-3 opacity-50">
            <List size={32} className="text-grabix-purple animate-pulse" />
            <p className="text-xs font-medium">Fetching individual video metadata...</p>
          </div>
        )}
        
        {filteredEntries.map((entry) => {
          const entryId = entry.id || entry.webpage_url;
          const isSelected = selectedVideos.includes(entryId);
          return (
            <button
              key={entryId}
              onClick={() => toggleVideo(entryId)}
              className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-all animate-in fade-in zoom-in-95 duration-300 ${
                isSelected 
                  ? 'border-grabix-purple bg-grabix-purple/5 ring-1 ring-grabix-purple' 
                  : 'border-grabix-border dark:border-grabix-border-dark hover:bg-grabix-surface dark:hover:bg-grabix-border-dark text-grabix-muted'
              }`}
            >
              <div className={`relative flex-shrink-0 aspect-video rounded-lg overflow-hidden bg-black/5 dark:bg-white/5 transition-all duration-300 ${settings.showThumbnail ? 'w-24' : 'w-8 h-8'}`}>
                {settings.showThumbnail && (entry.thumbnail ? (
                  <img src={entry.thumbnail} alt={entry.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <List size={16} />
                  </div>
                ))}
                <div className={`absolute flex items-center justify-center border transition-colors ${
                  settings.showThumbnail 
                    ? 'top-1.5 left-1.5 w-4 h-4 rounded-md' 
                    : 'inset-0 w-full h-full border-none bg-transparent'
                } ${
                  isSelected ? 'bg-grabix-purple border-grabix-purple text-white shadow-lg shadow-grabix-purple/20' : 'bg-white/80 dark:bg-black/80 border-grabix-border dark:border-grabix-border-dark'
                }`}>
                  {isSelected && <Check size={settings.showThumbnail ? 10 : 16} />}
                </div>
                {settings.showThumbnail && entry.duration && (
                  <div className="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-[9px] font-bold text-white">
                    {Math.floor(entry.duration / 60)}:{(entry.duration % 60).toString().padStart(2, '0')}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <h5 className={`text-[11px] font-bold leading-tight line-clamp-2 ${isSelected ? 'text-black dark:text-white' : ''}`}>
                  {entry.title}
                </h5>
                <p className="text-[9px] text-grabix-dim truncate mt-0.5">
                  {entry.webpage_url}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PlaylistStep;
