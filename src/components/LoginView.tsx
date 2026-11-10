import React, { useState } from 'react';
import { AlertCircle, WifiOff, Landmark } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BRAND, DGI_BRAND, PortalId, portalBrand } from '../branding';

interface LoginViewProps {
  portal: PortalId;
  onSwitchPortal: (portal: PortalId) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ portal, onSwitchPortal }) => {
  const { signInWithEmail, loading, isOfflineMode } = useAuth();
  const brand = portalBrand(portal);

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await signInWithEmail(email, password);
    } catch (err: any) {
      console.error('[Auth Error]', err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        setErrorMsg('Invalid email or password. Please try again.');
      } else {
        setErrorMsg(err.message || 'Authentication error. Please try again.');
      }
    }
  };

  const portalButtonClass = (target: PortalId) =>
    `px-2 py-1 rounded-full border transition-premium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
      portal === target
        ? 'bg-white/15 border-white/25 text-white'
        : 'border-transparent text-white/40 hover:text-white/75 hover:border-white/15'
    }`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy font-sans text-white flex items-center justify-center px-4 py-12">
      {/* Backdrop layers */}
      <div className="absolute inset-0 bg-navy" aria-hidden="true" />
      <div className="absolute inset-0 login-grid-bg" aria-hidden="true" />
      <div className="login-orb w-[480px] h-[480px] left-[-140px] top-[-140px] bg-accent/30" aria-hidden="true" />
      <div className="login-orb w-[380px] h-[380px] right-[-120px] bottom-[-100px] bg-sage/20" style={{ animationDelay: '-6s' }} aria-hidden="true" />
      <div className="absolute inset-0 login-floor-glow" aria-hidden="true" />

      {/* Centered column */}
      <div className="relative w-full max-w-sm text-center login-stage">
        <div className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-white/50">
          <Landmark className="w-3.5 h-3.5 text-accent-soft" />
          {brand.loginEyebrow}
        </div>

        <div className="login-tilt">
          <h1
            className="dprnk-3d mt-3 text-center"
            style={{ fontSize: 'clamp(3.25rem, 13vw, 6.5rem)' }}
            data-text={brand.shortName}
            aria-label={brand.fullName}
          >
            {brand.shortName}
          </h1>
        </div>

        <div className="mt-1 text-xs font-display font-bold uppercase tracking-[0.3em] text-white/85">
          {brand.tagline}
        </div>

        {/* Sign-in card */}
        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-[20px] border border-white/15 bg-white/10 backdrop-blur-md p-6 text-center shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]"
        >
          {errorMsg && (
            <div className="mb-4 p-3 rounded-[10px] bg-danger/15 border border-danger/40 text-xs text-red-200 flex items-center justify-center gap-2 text-center">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-center text-[12px] font-bold uppercase tracking-[0.12em] text-white/60">
              Official email
            </span>
            <input
              type="email"
              required
              placeholder="officer@tax.gouv.cd"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 rounded-[12px] bg-white/10 border border-white/15 text-sm text-white text-center placeholder:text-white/35 focus:outline-none focus:border-accent focus:bg-white/15 transition-premium"
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-center text-[12px] font-bold uppercase tracking-[0.12em] text-white/60">
              Password
            </span>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 rounded-[12px] bg-white/10 border border-white/15 text-sm text-white text-center placeholder:text-white/35 focus:outline-none focus:border-accent focus:bg-white/15 transition-premium"
            />
          </label>

          <button
            id="auth-submit-btn"
            type="submit"
            disabled={loading}
            className="brand-mark-vivid mt-5 h-11 w-full rounded-[12px] text-sm font-bold text-white transition-premium cursor-pointer hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Authenticating…' : 'Access Official Station'}
          </button>

          {isOfflineMode && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-amber-200/90">
              <WifiOff className="w-3.5 h-3.5" />
              Offline mode — local cache operational
            </p>
          )}
        </form>

        {/* Portal selector — sign-in only; the DGI workspace itself has no tabs. */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]">
          <span className="text-white/30">Portals</span>
          <button
            type="button"
            onClick={() => onSwitchPortal('dprnk')}
            aria-pressed={portal === 'dprnk'}
            disabled={loading}
            className={portalButtonClass('dprnk')}
          >
            {BRAND.shortName}
          </button>
          <span className="text-white/20">•</span>
          <button
            type="button"
            onClick={() => onSwitchPortal('dgi')}
            aria-pressed={portal === 'dgi'}
            disabled={loading}
            className={portalButtonClass('dgi')}
          >
            {DGI_BRAND.shortName}
          </button>
        </div>

        <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-white/35">
          {brand.systemLine}
        </p>
      </div>
    </div>
  );
};
