import React from 'react';
import { Settings, Moon, Sun, History } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenSettings, onOpenHistory }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="px-7 py-5 flex items-center justify-between border-b border-grabix-border dark:border-grabix-border-dark">
      {/* The title used to be a click-to-reload target, which silently wiped an
          in-progress session on a stray click. It is plain text now. */}
      <div className="flex items-center gap-3.5">
        <img
          src="/icon.png"
          alt=""
          aria-hidden="true"
          className="w-11 h-11 rounded-xl shadow-md shadow-black/20 select-none"
          draggable={false}
        />
        <div>
          <h1 className="text-2xl font-bold text-black dark:text-grabix-white tracking-tight leading-none">
            Grabix Pro
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-grabix-muted mt-1.5">
            <span>High-quality video downloader</span>
            <span className="text-grabix-dim">•</span>
            <span className="font-bold text-grabix-purple">by Zain</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenHistory}
          title="Download history"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark hover:border-grabix-purple hover:text-grabix-purple text-grabix-muted text-xs font-bold transition-all active:scale-95 shadow-sm"
        >
          <History size={16} />
          History
        </button>

        <button
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="p-2.5 rounded-xl border border-transparent hover:border-grabix-border dark:hover:border-grabix-border-dark hover:bg-grabix-surface dark:hover:bg-grabix-input-dark text-grabix-muted hover:text-grabix-purple transition-all active:scale-90"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <button
          onClick={onOpenSettings}
          title="Settings"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark hover:border-grabix-purple hover:text-grabix-purple text-grabix-muted text-xs font-bold transition-all active:scale-95 shadow-sm"
        >
          <Settings size={16} />
          Settings
        </button>
      </div>
    </header>
  );
};

export default Header;
