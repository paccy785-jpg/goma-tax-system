import React, { useEffect, useMemo, useState } from 'react';
import { UserMinus, X, Loader2, Check, Search, Home, AlertTriangle } from 'lucide-react';
import { natureCode, natureDisplay, RentalLease } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { endLease, subscribeToLeases } from '../../services/leaseService';
import { shortDate } from '../../services/rentalService';
import { todayDateString } from '../../utils/date';
import { Button } from '../ui';

/** Ville, commune, quartier, avenue, parcelle of the rented property. */
const leaseAddress = (l: RentalLease) =>
  [
    l.villeTerritoire,
    l.communeChefferie,
    l.quartierGroupement,
    l.address,
    (l.numeroParcelle || l.rang) ? `Parcelle ${l.numeroParcelle || l.rang}` : '',
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(', ');

const fieldClass =
  'w-full h-10 px-3 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium';

/**
 * Remove a locataire from a property — end the tenancy.
 *
 * The lease is kept on the register as IRL evidence and only marked ended, so
 * nothing already declared is erased. The locataire is then free: a new lease,
 * under a new bailleur, is filed later from the rental register whenever it
 * happens — nothing has to be reassigned here and now.
 */
export const RemoveTenantModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();

  const [leases, setLeases] = useState<RentalLease[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<RentalLease | null>(null);
  const [moveOutDate, setMoveOutDate] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // Live lease register — only active tenancies can be removed.
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const unsub = subscribeToLeases(
      (d) => {
        setLeases(d || []);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  const active = useMemo(() => leases.filter((l) => !l.vacatedAt), [leases]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = active;
    if (!query) return base.slice(0, 40);
    const tokens = query.split(/\s+/);
    return base
      .filter((l) => {
        const hay = [
          ...l.tenantNames,
          l.bailleurName || '',
          l.nature,
          natureDisplay(l.nature),
          leaseAddress(l),
          l.numeroParcelle || '',
          l.rang || '',
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 40);
  }, [active, q]);

  if (!isOpen) return null;

  const today = todayDateString();

  const reset = () => {
    setQ('');
    setSelected(null);
    setMoveOutDate('');
    setReason('');
    setConfirming(false);
  };

  const close = () => {
    if (saving) return;
    onClose();
  };

  const dateError =
    moveOutDate && selected?.startDate && moveOutDate < selected.startDate
      ? 'La date de départ précède le début du bail.'
      : moveOutDate && moveOutDate > today
        ? 'La date de départ ne peut pas être dans le futur.'
        : '';

  const submit = async () => {
    if (!selected) return;
    if (!userProfile) {
      showToast('Connectez-vous avant de retirer un locataire.', 'error', 'Non connecté');
      return;
    }
    if (dateError) return;
    setSaving(true);
    try {
      await endLease(
        selected,
        { moveOutDate, reason },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      showToast(
        `${selected.tenantNames.join(', ')} retiré de la propriété. Le bail reste au registre, marqué clôturé.`,
        'success',
        'Locataire retiré'
      );
      reset();
      onClose();
    } catch (err) {
      setConfirming(false);
      showToast(
        err instanceof Error ? err.message : 'Le retrait a échoué.',
        'error',
        'Échec du retrait'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-tenant-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <UserMinus className="w-5 h-5" />
            </div>
            <div>
              <h3 id="remove-tenant-title" className="text-base font-bold font-display">
                Retirer un locataire
              </h3>
              <p className="text-xs text-white/70">
                Un locataire quitte un bien — la location prend fin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Fermer"
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <p className="text-[12px] text-muted leading-relaxed">
            Choisissez le locataire et le bien qu’il quitte. La location est clôturée mais reste au
            registre comme pièce de la déclaration. Vous n’avez rien à réaffecter maintenant : si le
            locataire loue ailleurs, enregistrez plus tard un nouveau bail chez son nouveau bailleur
            depuis le registre locatif.
          </p>

          {/* Search + pick the lease */}
          <section className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSelected(null);
                  setConfirming(false);
                }}
                disabled={saving}
                autoFocus
                aria-label="Rechercher un locataire à retirer"
                className={`${fieldClass} pl-9 border-line`}
              />
            </div>

            {loading ? (
              <div className="h-10 px-3 flex items-center rounded-[10px] bg-surface2/60 border border-line text-xs text-muted">
                Chargement des locations…
              </div>
            ) : active.length === 0 ? (
              <p className="p-3 rounded-[10px] bg-surface2/60 border border-line text-[12px] text-muted leading-relaxed">
                Aucune location active n’est enregistrée.
              </p>
            ) : shown.length === 0 ? (
              <p className="p-3 rounded-[10px] bg-surface2/60 border border-line text-[12px] text-muted leading-relaxed">
                Aucune location ne correspond à « {q.trim()} ».
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Locations actives"
                className="rounded-[12px] border border-line divide-y divide-line overflow-hidden max-h-64 overflow-y-auto"
              >
                {shown.map((l) => {
                  const on = selected?.id === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setSelected(l);
                        setConfirming(false);
                      }}
                      disabled={saving}
                      className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 cursor-pointer transition-premium ${
                        on ? 'bg-accent-soft/60' : 'bg-surface hover:bg-surface2/50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          on ? 'border-accent' : 'border-line'
                        }`}
                      >
                        {on && <span className="w-2 h-2 rounded-full bg-accent" />}
                      </span>
                      <span className="w-6 h-6 rounded-[7px] bg-surface2 text-accent flex items-center justify-center shrink-0 mt-0.5">
                        <Home className="w-3.5 h-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-ink truncate">
                          {l.tenantNames.join(', ')}
                        </span>
                        <span className="flex items-center gap-1.5 min-w-0 mt-0.5" title={natureDisplay(l.nature)}>
                          <span className="font-mono text-[11px] font-bold text-accent shrink-0">
                            {natureCode(l.nature)}
                          </span>
                          <span className="text-[12px] text-muted truncate">{leaseAddress(l) || '—'}</span>
                        </span>
                        <span className="block text-[11px] text-faint truncate mt-0.5">
                          {l.bailleurName ? `Bailleur ${l.bailleurName}` : 'Bailleur non renseigné'}
                          {l.startDate
                            ? ` · ${shortDate(l.startDate)} → ${l.endDate ? shortDate(l.endDate) : 'en cours'}`
                            : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Optional move-out details */}
          {selected && (
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-xs font-semibold text-ink mb-1.5">
                  Date de départ <span className="font-normal text-faint">(facultatif)</span>
                </span>
                <input
                  type="date"
                  value={moveOutDate}
                  max={today}
                  onChange={(e) => {
                    setMoveOutDate(e.target.value);
                    setConfirming(false);
                  }}
                  disabled={saving}
                  className={`${fieldClass} ${dateError ? 'border-danger' : 'border-line'}`}
                />
                {dateError && <p className="text-[12px] text-danger mt-1">{dateError}</p>}
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-ink mb-1.5">
                  Motif <span className="font-normal text-faint">(facultatif)</span>
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setConfirming(false);
                  }}
                  disabled={saving}
                  maxLength={160}
                  placeholder="ex. a changé de bailleur"
                  className={`${fieldClass} border-line`}
                />
              </label>
            </section>
          )}

          {/* Confirmation */}
          {confirming && selected && (
            <div className="p-4 rounded-[12px] bg-danger/10 border border-danger/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-ink">
                <AlertTriangle className="w-4 h-4 text-danger" />
                Confirmer le retrait
              </div>
              <p className="text-[12px] text-ink leading-relaxed">
                <strong>{selected.tenantNames.join(', ')}</strong>{' '}
                {selected.tenantNames.length > 1 ? 'seront retirés' : 'sera retiré'} du bien{' '}
                <strong>
                  {natureCode(selected.nature)} {leaseAddress(selected)}
                </strong>
                {moveOutDate ? ` (départ le ${moveOutDate.split('-').reverse().join('/')})` : ''}. La
                location est clôturée et reste au registre comme pièce de la déclaration — rien de ce
                qui a été déclaré n’est effacé. Vous pourrez enregistrer plus tard une nouvelle
                location pour ce locataire chez un autre bailleur.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line bg-surface2/50 flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={confirming ? () => setConfirming(false) : close}
            disabled={saving}
          >
            {confirming ? 'Retour' : 'Fermer'}
          </Button>
          {confirming ? (
            <Button
              variant="danger"
              size="sm"
              onClick={submit}
              disabled={saving}
              icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            >
              {saving ? 'Retrait en cours…' : 'Confirmer le retrait'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => selected && !dateError && setConfirming(true)}
              disabled={!selected || !!dateError}
              icon={<UserMinus className="w-3.5 h-3.5" />}
            >
              Retirer le locataire
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
