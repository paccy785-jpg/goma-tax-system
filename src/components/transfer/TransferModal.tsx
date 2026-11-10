import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, X, Loader2, Check, Home, AlertTriangle, ArrowDown } from 'lucide-react';
import { Business, natureCode, natureDisplay, PropertyParcel, RentalLease } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { subscribeToParcelsByOwner } from '../../services/parcelService';
import {
  getLeasesForParcel,
  MUTATION_KINDS,
  MUTATION_KIND_LABELS,
  MutationKind,
  PropertyTransfer,
  transferProperty,
} from '../../services/transferService';
import { todayDateString } from '../../utils/date';
import { Button } from '../ui';
import { TaxpayerSearch } from './TaxpayerSearch';

const parcelRef = (p: PropertyParcel) => p.numeroParcelle?.trim() || p.rang?.trim() || '';
/** Ville/territoire, commune/chefferie, quartier/groupement, avenue/localité, parcelle. */
const parcelAddress = (p: PropertyParcel) =>
  [
    p.villeTerritoire,
    p.communeChefferie,
    p.quartierGroupement,
    p.avenueLocalite,
    parcelRef(p) ? `Parcelle ${parcelRef(p)}` : '',
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(', ');

const fieldClass =
  'w-full h-10 px-3 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium';

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="space-y-3">
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded-[6px] bg-navy text-white text-[11px] font-bold flex items-center justify-center">
        {n}
      </span>
      <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-ink">{title}</h4>
    </div>
    {children}
  </section>
);

export const TransferModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taxpayers: Business[];
  onDone?: (t: PropertyTransfer) => void;
}> = ({ isOpen, onClose, taxpayers, onDone }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();

  const [from, setFrom] = useState<Business | null>(null);
  const [parcels, setParcels] = useState<PropertyParcel[]>([]);
  const [parcelsLoading, setParcelsLoading] = useState(false);
  const [parcel, setParcel] = useState<PropertyParcel | null>(null);
  const [leases, setLeases] = useState<RentalLease[]>([]);
  const [to, setTo] = useState<Business | null>(null);
  const [kind, setKind] = useState<MutationKind>('vente');
  const [dateMutation, setDateMutation] = useState(todayDateString());
  const [moveLeases, setMoveLeases] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // The current owner's declared properties.
  useEffect(() => {
    setParcel(null);
    if (!isOpen || !from) {
      setParcels([]);
      setParcelsLoading(false);
      return;
    }
    setParcelsLoading(true);
    return subscribeToParcelsByOwner(
      from.id,
      (d) => {
        setParcels(d || []);
        setParcelsLoading(false);
      },
      () => setParcelsLoading(false)
    );
  }, [isOpen, from]);

  // Leases on the chosen property — they can move with it.
  useEffect(() => {
    setLeases([]);
    if (!parcel) return;
    let live = true;
    getLeasesForParcel(parcel.id)
      .then((l) => live && setLeases(l))
      .catch(() => live && setLeases([]));
    return () => {
      live = false;
    };
  }, [parcel]);

  // The new owner can never be the current one.
  useEffect(() => {
    if (to && from && to.id === from.id) setTo(null);
  }, [from, to]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  const today = todayDateString();
  const errors = useMemo(
    () => ({
      from: !from ? 'Sélectionnez le propriétaire actuel.' : '',
      parcel: from && !parcel ? 'Sélectionnez la propriété à transférer.' : '',
      to: !to ? 'Sélectionnez le nouveau propriétaire.' : '',
      date: !dateMutation
        ? 'Saisissez la date de la mutation.'
        : dateMutation > today
          ? 'La date de mutation ne peut pas être dans le futur.'
          : '',
    }),
    [from, parcel, to, dateMutation, today]
  );
  const valid = Object.values(errors).every((e) => !e);

  if (!isOpen) return null;

  const reset = () => {
    setFrom(null);
    setParcel(null);
    setTo(null);
    setKind('vente');
    setDateMutation(todayDateString());
    setMoveLeases(true);
    setShowErrors(false);
    setConfirming(false);
  };

  const ask = () => {
    setShowErrors(true);
    if (valid) setConfirming(true);
  };

  const submit = async () => {
    if (!valid || !from || !parcel || !to) return;
    if (!userProfile) {
      showToast('Connectez-vous avant d’enregistrer un transfert.', 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      const t = await transferProperty(
        {
          parcel,
          to,
          kind,
          dateMutation,
          moveLeases,
        },
        from,
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      showToast(
        `Propriété transférée de ${t.from.name} à ${t.to.name}.`,
        'success',
        'Transfert enregistré'
      );
      onDone?.(t);
      reset();
      onClose();
    } catch (err) {
      setConfirming(false);
      showToast(err instanceof Error ? err.message : 'Le transfert a échoué.', 'error', 'Échec du transfert');
    } finally {
      setSaving(false);
    }
  };

  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h3 id="transfer-title" className="text-base font-bold font-display">
                Transfert de propriété
              </h3>
              <p className="text-xs text-white/70">D’un contribuable à un autre — vente, donation, succession</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer"
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* 1. Current owner and the property */}
          <Step n={1} title="Propriétaire actuel et propriété">
            <TaxpayerSearch
              id="transfer-from"
              label="Propriétaire actuel (cédant)"
              hint="Le contribuable au nom duquel la propriété est déclarée aujourd’hui."
              taxpayers={taxpayers}
              value={from}
              onChange={setFrom}
              disabled={saving}
              autoFocus
              error={err('from')}
            />
            {from && (
              <div>
                <span className="block text-xs font-semibold text-ink mb-1.5">Propriété à transférer</span>
                {parcelsLoading ? (
                  <div className="h-10 px-3 flex items-center rounded-[10px] bg-surface2/60 border border-line text-xs text-muted">
                    Chargement des propriétés déclarées…
                  </div>
                ) : parcels.length === 0 ? (
                  <p className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed">
                    Aucune propriété n’est déclarée au nom de <strong>{from.businessName}</strong>.
                  </p>
                ) : (
                  <div
                    role="radiogroup"
                    aria-label="Propriétés déclarées"
                    className={`rounded-[12px] border divide-y divide-line overflow-hidden ${
                      err('parcel') ? 'border-danger' : 'border-line'
                    }`}
                  >
                    {parcels.map((p) => {
                      const on = parcel?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setParcel(p);
                            setConfirming(false);
                          }}
                          disabled={saving}
                          className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 cursor-pointer transition-premium ${
                            on ? 'bg-accent-soft/60' : 'bg-surface hover:bg-surface2/50'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                              on ? 'border-accent' : 'border-line'
                            }`}
                          >
                            {on && <span className="w-2 h-2 rounded-full bg-accent" />}
                          </span>
                          <span className="w-6 h-6 rounded-[7px] bg-surface2 text-accent flex items-center justify-center shrink-0">
                            <Home className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 flex items-center gap-2" title={natureDisplay(p.nature)}>
                            <span className="font-mono text-xs font-bold text-accent shrink-0">{natureCode(p.nature)}</span>
                            <span className="text-xs text-ink truncate">{parcelAddress(p) || '—'}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {err('parcel') && <p className="text-[12px] text-danger mt-1">{err('parcel')}</p>}
              </div>
            )}
          </Step>

          <div className="flex justify-center -my-2" aria-hidden="true">
            <span className="w-7 h-7 rounded-full bg-surface2 border border-line text-muted flex items-center justify-center">
              <ArrowDown className="w-3.5 h-3.5" />
            </span>
          </div>

          {/* 2. New owner */}
          <Step n={2} title="Nouveau propriétaire">
            <TaxpayerSearch
              id="transfer-to"
              label="Nouveau propriétaire (acquéreur)"
              hint="Le contribuable qui devient propriétaire. Il doit être inscrit au registre des contribuables."
              taxpayers={taxpayers}
              value={to}
              onChange={(b) => {
                setTo(b);
                setConfirming(false);
              }}
              excludeId={from?.id}
              disabled={saving}
              error={err('to')}
            />
          </Step>

          {/* 3. The deed */}
          <Step n={3} title="Acte de mutation">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-xs font-semibold text-ink mb-1.5">Nature de la mutation</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as MutationKind)}
                  disabled={saving}
                  className={`${fieldClass} border-line cursor-pointer`}
                >
                  {MUTATION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MUTATION_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-ink mb-1.5">Date de la mutation</span>
                <input
                  type="date"
                  value={dateMutation}
                  max={today}
                  onChange={(e) => setDateMutation(e.target.value)}
                  disabled={saving}
                  className={`${fieldClass} ${err('date') ? 'border-danger' : 'border-line'}`}
                />
                {err('date') && <p className="text-[12px] text-danger mt-1">{err('date')}</p>}
              </label>
            </div>

            {parcel && leases.length > 0 && (
              <label className="flex items-start gap-2.5 p-3 rounded-[10px] bg-surface2/50 border border-line cursor-pointer">
                <input
                  type="checkbox"
                  checked={moveLeases}
                  onChange={(e) => setMoveLeases(e.target.checked)}
                  disabled={saving}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <span className="text-[12px] text-ink leading-relaxed">
                  <strong>
                    Transférer aussi {leases.length === 1 ? 'le bail' : `les ${leases.length} baux`} de cette propriété
                  </strong>{' '}
                  ({leases.flatMap((l) => l.tenantNames || []).join(', ')}) — le nouveau propriétaire en devient le
                  bailleur.
                </span>
              </label>
            )}
          </Step>

          {/* Confirmation */}
          {confirming && from && parcel && to && (
            <div className="p-4 rounded-[12px] bg-warn/10 border border-warn/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-ink">
                <AlertTriangle className="w-4 h-4 text-warn" />
                Confirmer le transfert
              </div>
              <p className="text-[12px] text-ink leading-relaxed">
                La propriété <strong>{natureCode(parcel.nature)} {parcelAddress(parcel)}</strong> passera de{' '}
                <strong>{from.businessName}</strong> à <strong>{to.businessName}</strong> (
                {MUTATION_KIND_LABELS[kind].toLowerCase()}, le{' '}
                {dateMutation.split('-').reverse().join('/')}).
                {moveLeases && leases.length > 0
                  ? ` ${leases.length === 1 ? 'Son bail suivra' : `Ses ${leases.length} baux suivront`}.`
                  : ''}{' '}
                Le transfert est enregistré dans l’historique et ne peut pas être annulé — une erreur se corrige par un
                nouveau transfert.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line bg-surface2/50 flex items-center justify-end gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={confirming ? () => setConfirming(false) : onClose} disabled={saving}>
            {confirming ? 'Retour' : 'Fermer'}
          </Button>
          {confirming ? (
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={saving}
              icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            >
              {saving ? 'Transfert en cours…' : 'Confirmer le transfert'}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={ask} icon={<ArrowLeftRight className="w-3.5 h-3.5" />}>
              Transférer la propriété
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
