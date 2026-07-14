import React from 'react';
import { Folder, HardDrive } from 'lucide-react';

interface DestinationStepProps {
  savePath: string;
  onSelectPath: () => void;
}

const DestinationStep: React.FC<DestinationStepProps> = ({ savePath, onSelectPath }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-grabix-purple rounded-full" />
        <h3 className="text-xs font-bold text-grabix-muted uppercase tracking-wider">Step 3 - Save Location</h3>
      </div>

      <div className="space-y-3">
        <label className="text-[11px] text-grabix-muted font-medium px-1">Choose where to save the downloaded file:</label>
        <div className="flex gap-3">
          <div className="flex-1 h-11 px-4 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark flex items-center gap-3">
            <Folder size={16} className="text-grabix-muted" />
            <span className={`text-sm truncate ${savePath ? 'text-black dark:text-white' : 'text-grabix-dim'}`}>
              {savePath || 'No folder selected'}
            </span>
          </div>
          <button 
            onClick={onSelectPath}
            className="px-6 h-11 rounded-xl bg-grabix-purple hover:bg-grabix-purple-hover text-white text-sm font-bold transition-all shadow-lg shadow-grabix-purple/20 active:scale-[0.98]"
          >
            Browse
          </button>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark flex items-start gap-4">
        <div className="p-3 rounded-xl bg-grabix-purple/10 text-grabix-purple">
          <HardDrive size={24} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-black dark:text-white">Review Settings</h4>
          <p className="text-[10px] text-grabix-muted mt-1 leading-relaxed">
            Grabix will use high-quality merge settings for MP4 output. 
            Ensure you have enough disk space for the download.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DestinationStep;
