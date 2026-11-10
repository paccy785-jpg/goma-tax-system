import React, { useState } from 'react';
import { ArrowLeftRight, Clock, Loader2, LogOut, ShieldAlert, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PortalId, monogramSize, portalBrand } from '../branding';

interface PortalAccessViewProps {
  portal: PortalId;
  /** none: no account on this portal yet. requested: access asked, not yet granted. */
  mode: 'none' | 'requested';
  onSwitchPortal: (portal: PortalId) => void;
}

/**
 * Shown to a signed-in account that has no access to this portal.
 *
 * The DPRNK and DGI portals have separate user accounts: being registered on
 * one gives no access to the other. The account may ask for access — an
 * administrator of this portal then activates it from Users — sign out, or go
 * to the other portal.
 */
export const PortalAccessView: React.FC<PortalAccessViewProps> = ({ portal, mode, onSwitchPortal }) => {
  const { currentUser, userProfile, logout, requestPortalAccess } = useAuth();
  const brand = portalBrand(portal);
  const other: PortalId = portal === 'dgi' ? 'dprnk' : 'dgi';
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const email = userProfile?.email || currentUser?.email || '';

  const ask = async () => {
    setSending(true);
    setError('');
    try {
      await requestPortalAccess();
    } catch {
      setError('The access request could not be sent. Check the connection, then try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center text-ink p-6 text-center font-sans">
      <div
        className="w-16 h-16 rounded-[18px] brand-mark-vivid text-white flex items-center justify-center font-display font-bold tracking-tight shadow-lg mb-5"
        style={{ fontSize: monogramSize(64, 8, 0.616, brand.monogram.length) }}
      >
        {brand.monogram}
      </div>

      {mode === 'requested' ? (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-warn/10 text-warn border border-warn/30 text-[11px] font-bold uppercase tracking-[0.14em]">
            <Clock className="w-3.5 h-3.5" />
            Access request pending
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold text-ink tracking-tight">
            {portal === 'dgi' ? 'Waiting for a DGI administrator' : 'Waiting for a DPRNK administrator'}
          </h2>
          <p className="text-sm text-muted max-w-md mt-2 leading-relaxed">
            {portal === 'dgi'
              ? 'Your request to use the DGI portal has been sent. You will have access as soon as a DGI administrator activates your account in Users.'
              : 'Your request to use the DPRNK portal has been sent. You will have access as soon as a DPRNK administrator activates your account in Users.'}
          </p>
        </>
      ) : (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-danger/10 text-danger border border-danger/30 text-[11px] font-bold uppercase tracking-[0.14em]">
            <ShieldAlert className="w-3.5 h-3.5" />
            No access to this portal
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold text-ink tracking-tight">
            {portal === 'dgi' ? 'This account is not registered on the DGI portal' : 'This account is not registered on the DPRNK portal'}
          </h2>
          <p className="text-sm text-muted max-w-md mt-2 leading-relaxed">
            {portal === 'dgi'
              ? 'DGI and DPRNK accounts are separate. A DGI administrator must add you, or you can ask for access below.'
              : 'DPRNK and DGI accounts are separate. A DPRNK administrator must add you, or you can ask for access below.'}
          </p>
        </>
      )}

      {email && <p className="mt-3 text-[12px] text-faint">{email}</p>}
      {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

      <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
        {mode === 'none' && (
          <button
            type="button"
            onClick={ask}
            disabled={sending}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] brand-mark-vivid text-white text-xs font-semibold transition-premium cursor-pointer hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            Request access
          </button>
        )}
        <button
          type="button"
          onClick={() => onSwitchPortal(other)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] border border-line bg-surface hover:bg-surface2 text-ink text-xs font-medium transition-premium cursor-pointer"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          {other === 'dgi' ? 'Go to the DGI portal' : 'Go to the DPRNK portal'}
        </button>
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] bg-navy hover:bg-navy2 text-white text-xs font-medium transition-premium cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </div>
  );
};
