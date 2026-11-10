import React from 'react';
import { WifiOff, Database, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const OfflineBanner: React.FC = () => {
  const { isOfflineMode, setOfflineSimulated } = useAuth();

  if (!isOfflineMode) return null;

  return (
    <div
      id="offline-persistence-alert-banner"
      className="bg-warn/15 border-b border-warn/30 px-4 py-3 sm:px-8 transition-premium"
    >
      <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[8px] bg-warn/25 text-ink flex items-center justify-center shrink-0">
            <WifiOff className="w-4 h-4 text-ink" />
          </div>
          <div className="text-xs text-ink leading-relaxed font-sans">
            <span className="font-bold">Offline Field Mode Active:</span> Local storage cache is operational. 
            Receipts, taxpayer census, and payment collection will queue locally and automatically reconcile upon reconnection to Goma Revenue Cloud.
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sage bg-sage/15 border border-sage/30 px-2.5 py-1 rounded-full tabular-nums">
            <Database className="w-3 h-3 text-sage" />
            Local Cache Active
          </span>
          <button
            id="restore-connection-btn"
            type="button"
            onClick={() => setOfflineSimulated(false)}
            className="text-xs font-semibold text-accent hover:text-accent-dark transition-premium flex items-center gap-1 cursor-pointer"
          >
            Reconnect live
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
