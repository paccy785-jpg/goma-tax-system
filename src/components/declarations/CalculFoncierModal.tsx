import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Landmark, X, RotateCcw, Lock, Loader2, Trash2, Wallet, Check, Home, Plus } from 'lucide-react';
import {
  natureCode,
  natureDisplay,
  PropertyMeasureKind,
  PropertyParcel,
  RangEntry,
  UsageEntry,
} from '../../types';
import { subscribeToParcelsByOwner } from '../../services/parcelService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { subscribeToRangs } from '../../services/rangService';
import { subscribeToUsages } from '../../services/usageService';
import {
  addFoncierCalculation,
  FoncierCalculation,
  FoncierPaymentMode,
  FONCIER_PAYMENT_MODES,
  FONCIER_PAYMENT_MODE_LABELS,
  montantFoncier,
} from '../../services/foncierCalculationService';
import { roundMoney } from '../../utils/frenchNumber';
import { fmtUSD, parseAmount } from '../../utils/taxCalc';
import { Button } from '../ui';
import { BailleurPicker, PickedBailleur } from './BailleurPicker';

interface CalculFoncierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (calc: FoncierCalculation) => void;
}

/** One line of the slip: one of the bailleur's declared properties. */
interface DraftLine {
  key: string;
  parcelId: string;
  numeroParcelle?: string;
  nature?: string;
  address?: string;
  villeTerritoire?: string;
  communeChefferie?: string;
  quartierGroupement?: string;
  avenueLocalite?: string;
  /** Set when the declaration fixes superficie vs nombre (NOTEZ 3). */
  kindLocked: boolean;
  rang: string;
  usage: string;
  measureKind: PropertyMeasureKind;
  measure: string;
  taux: string;
}

/** Reference printed for a property: its numéro de parcelle, else its rang. */
const parcelRef = (p: Pick<PropertyParcel, 'numeroParcelle' | 'rang'>) =>
  p.numeroParcelle?.trim() || p.rang?.trim() || '';

/**
 * A property's address in administrative order, largest to smallest:
 * Ville/territoire, Commune/chefferie, Quartier/groupement, Avenue/localité,
 * then the numéro de parcelle.
 */
const parcelAddress = (p: PropertyParcel) => {
  const ref = parcelRef(p);
  return [
    p.villeTerritoire,
    p.communeChefferie,
    p.quartierGroupement,
    p.avenueLocalite,
    ref ? `Parcelle ${ref}` : '',
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(', ');
};

/** The measure basis a declaration fixes: NOTEZ 3, else its recorded kind. */
const declaredKind = (p: PropertyParcel): PropertyMeasureKind | null =>
  p.note3Code === 'SUP' ? 'superficie' : p.note3Code === 'NBR' ? 'nombre' : null;

const numText = (n?: number) =>
  typeof n === 'number' && n > 0 ? String(n).replace('.', ',') : '';

/**
 * A line for one declared property, carrying everything the declaration holds:
 * its identity, its measure basis, and — on older declarations that recorded
 * them — its rang, usage, measure and tariff.
 */
function lineFromParcel(p: PropertyParcel, rangs: RangEntry[], usages: UsageEntry[]): DraftLine {
  const kind = declaredKind(p);
  const usageWanted = (p.usage || '').trim().toLowerCase();
  const usage =
    usages.find((u) => u.id.toLowerCase() === usageWanted || u.designation?.trim().toLowerCase() === usageWanted)
      ?.id || '';
  return {
    key: `${p.id}_${Math.random().toString(36).slice(2, 7)}`,
    parcelId: p.id,
    numeroParcelle: parcelRef(p) || undefined,
    nature: p.nature || undefined,
    address: parcelAddress(p) || undefined,
    villeTerritoire: p.villeTerritoire?.trim() || undefined,
    communeChefferie: p.communeChefferie?.trim() || undefined,
    quartierGroupement: p.quartierGroupement?.trim() || undefined,
    avenueLocalite: p.avenueLocalite?.trim() || undefined,
    // The declared basis is only the starting point: the officer may switch
    // any line between superficie and nombre.
    kindLocked: false,
    rang: rangs.some((r) => r.id === (p.rang || '').trim()) ? p.rang.trim() : '',
    usage,
    measureKind: kind || p.measureKind || 'superficie',
    measure: numText(p.measureValue),
    taux: numText(p.tauxUSD),
  };
}

const fieldClass =
  'w-full h-10 px-3 text-sm rounded-[10px] border border-line bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans tabular-nums';

const FieldLabel: React.FC<{ n: number; label: string; hint?: string }> = ({ n, label, hint }) => (
  <div className="flex items-baseline justify-between gap-2 mb-1.5">
    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
      <span className="w-5 h-5 rounded-[6px] bg-surface2 text-ink text-[11px] font-bold flex items-center justify-center font-mono">
        {n}
      </span>
      {label}
    </span>
    {hint && <span className="text-[11px] font-mono text-faint shrink-0">{hint}</span>}
  </div>
);

/** Parsed figures and the first problem on a line, if any. */
function evaluate(l: DraftLine) {
  const value = parseAmount(l.measure);
  const taux = parseAmount(l.taux);
  const valueOk =
    Number.isFinite(value) && value > 0 && (l.measureKind === 'superficie' || Number.isInteger(value));
  const tauxOk = Number.isFinite(taux) && taux >= 0;
  const montant = valueOk && tauxOk ? montantFoncier(value, taux) : null;
  const errors = {
    measure:
      l.measure.trim() !== '' && !valueOk
        ? l.measureKind === 'nombre'
          ? 'Nombre entier attendu'
          : 'Superficie invalide'
        : '',
    taux: l.taux.trim() !== '' && !tauxOk ? 'Taux invalide' : '',
  };
  const complete = !!l.rang && !!l.usage && montant !== null;
  return { value, taux, montant, errors, complete };
}

export const CalculFoncierModal: React.FC<CalculFoncierModalProps> = ({ isOpen, onClose, onSaved }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();

  const [rangs, setRangs] = useState<RangEntry[]>([]);
  const [usages, setUsages] = useState<UsageEntry[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [modePaiement, setModePaiement] = useState<FoncierPaymentMode | ''>('');
  const [bailleur, setBailleurState] = useState<PickedBailleur | null>(null);
  /** The selected bailleur's declared properties — the pickable set. */
  const [ownerParcels, setOwnerParcels] = useState<PropertyParcel[]>([]);
  const [parcelsLoading, setParcelsLoading] = useState(false);

  /** A different bailleur means a different set of properties: start over. */
  const setBailleur = (b: PickedBailleur | null) => {
    if ((b?.id || null) !== (bailleur?.id || null)) setLines([]);
    setBailleurState(b);
  };

  /**
   * A closed card keeps its React state — it renders `null` rather than being
   * unmounted — so the previous bailleur, their parcels and their calculated
   * lines were still loaded the next time it opened, and could be filed against
   * the wrong owner. Start from an empty slip on every open.
   */
  useEffect(() => {
    if (!isOpen) return;
    setLines([]);
    setBailleurState(null);
    setOwnerParcels([]);
    setParcelsLoading(false);
    setModePaiement('');
    setShowErrors(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !bailleur) {
      setOwnerParcels([]);
      setParcelsLoading(false);
      return;
    }
    setParcelsLoading(true);
    const unsub = subscribeToParcelsByOwner(
      bailleur.id,
      (data) => {
        setOwnerParcels(data || []);
        setParcelsLoading(false);
      },
      () => setParcelsLoading(false)
    );
    return unsub;
  }, [isOpen, bailleur]);

  useEffect(() => {
    if (!isOpen) return;
    const u1 = subscribeToRangs(setRangs);
    const u2 = subscribeToUsages(setUsages);
    return () => {
      u1();
      u2();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  const evaluated = useMemo(() => lines.map(evaluate), [lines]);
  /** (6) = Σ (5) over the lines that are complete. */
  const total = useMemo(
    () => roundMoney(evaluated.reduce((s, e) => s + (e.montant ?? 0), 0)),
    [evaluated]
  );
  const allComplete = evaluated.length > 0 && evaluated.every((e) => e.complete);
  const selectedIds = useMemo(() => new Set(lines.map((l) => l.parcelId)), [lines]);

  /**
   * A bailleur with a single declared property has nothing to choose between:
   * that property — its nature, address and parcel — goes onto the slip as
   * soon as the bailleur is picked. Done once per bailleur, so deselecting it
   * afterwards is respected. With several properties the officer chooses.
   */
  const autoPickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!bailleur || parcelsLoading) return;
    if (autoPickedFor.current === bailleur.id) return;
    if (ownerParcels.length === 0) return;
    // Only parcels that belong to the bailleur now selected.
    if (ownerParcels.some((p) => p.ownerTaxpayerId && p.ownerTaxpayerId !== bailleur.id)) return;
    autoPickedFor.current = bailleur.id;
    if (ownerParcels.length === 1 && lines.length === 0) {
      setLines([lineFromParcel(ownerParcels[0], rangs, usages)]);
    }
  }, [bailleur, ownerParcels, parcelsLoading, lines.length, rangs, usages]);

  /**
   * Registers load after the card opens. A line taken from a declaration that
   * recorded a rang or usage is completed once they arrive, without
   * overwriting anything the officer has already chosen.
   */
  useEffect(() => {
    if (!rangs.length && !usages.length) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (l.rang && l.usage) return l;
        const p = ownerParcels.find((x) => x.id === l.parcelId);
        if (!p) return l;
        const fresh = lineFromParcel(p, rangs, usages);
        const rang = l.rang || fresh.rang;
        const usage = l.usage || fresh.usage;
        if (rang === l.rang && usage === l.usage) return l;
        changed = true;
        return { ...l, rang, usage };
      });
      return changed ? next : prev;
    });
  }, [rangs, usages, ownerParcels]);

  if (!isOpen) return null;

  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  /** Drop a property and every rang / usage line entered for it. */
  const removeParcel = (parcelId: string) => setLines((prev) => prev.filter((l) => l.parcelId !== parcelId));
  /**
   * Another rang or usage on the same property — a building with a shop on
   * the ground floor and housing above is taxed line by line. The new line
   * keeps the property's identity and measure basis; its rang, usage, measure
   * and taux are entered for that part.
   */
  const addSubLine = (parcelId: string) => {
    const parcel = ownerParcels.find((x) => x.id === parcelId);
    if (!parcel) return;
    setLines((prev) => {
      const fresh = { ...lineFromParcel(parcel, rangs, usages), rang: '', usage: '', measure: '', taux: '' };
      let last = -1;
      prev.forEach((l, i) => l.parcelId === parcelId && (last = i));
      const next = [...prev];
      next.splice(last + 1, 0, fresh);
      return next;
    });
  };
  const allParcelsSelected = ownerParcels.length > 0 && ownerParcels.every((p) => selectedIds.has(p.id));
  const toggleAllParcels = () =>
    setLines((prev) =>
      allParcelsSelected
        ? []
        : [
            ...prev,
            ...ownerParcels
              .filter((p) => !prev.some((l) => l.parcelId === p.id))
              .map((p) => lineFromParcel(p, rangs, usages)),
          ]
    );
  /** Lines grouped by property, in the order the properties were picked. */
  const groups: { parcelId: string; items: { line: DraftLine; index: number }[] }[] = [];
  lines.forEach((line, index) => {
    const g = groups.find((x) => x.parcelId === line.parcelId);
    if (g) g.items.push({ line, index });
    else groups.push({ parcelId: line.parcelId, items: [{ line, index }] });
  });
  /** Select or deselect one of the bailleur's properties. */
  const toggleParcel = (p: PropertyParcel) =>
    setLines((prev) =>
      prev.some((l) => l.parcelId === p.id)
        ? prev.filter((l) => l.parcelId !== p.id)
        : [...prev, lineFromParcel(p, rangs, usages)]
    );
  const reset = () => {
    autoPickedFor.current = null;
    setLines([]);
    setModePaiement('');
    setBailleur(null);
    setShowErrors(false);
  };

  const save = async () => {
    if (!bailleur || !allComplete || !modePaiement) {
      setShowErrors(true);
      return;
    }
    if (!userProfile) {
      showToast('Connectez-vous avant d’enregistrer un calcul.', 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      const saved = await addFoncierCalculation(
        bailleur,
        lines.map((l, i) => ({
          parcelId: l.parcelId,
          numeroParcelle: l.numeroParcelle,
          nature: l.nature,
          address: l.address,
          villeTerritoire: l.villeTerritoire,
          communeChefferie: l.communeChefferie,
          quartierGroupement: l.quartierGroupement,
          avenueLocalite: l.avenueLocalite,
          rang: l.rang,
          rangDesignation: rangs.find((r) => r.id === l.rang)?.designation,
          usage: l.usage,
          usageDesignation: usages.find((u) => u.id === l.usage)?.designation,
          measureKind: l.measureKind,
          measureValue: evaluated[i].value,
          tauxUSD: evaluated[i].taux,
        })),
        modePaiement,
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      onSaved?.(saved);
      showToast(
        `Calcul foncier enregistré pour ${bailleur.name} — total impôt dû ${fmtUSD(saved.totalImpotDuUSD)}.`,
        'success',
        'Calcul d’impôts'
      );
      reset();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Impossible d’enregistrer le calcul.', 'error', 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const registersEmpty = rangs.length === 0 || usages.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calcul-foncier-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 id="calcul-foncier-title" className="text-base font-bold font-display">
                Calcul d'impôts
              </h3>
              <p className="text-xs text-white/70">Montants exprimés en dollars américains (USD)</p>
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

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          <BailleurPicker
            active={isOpen}
            value={bailleur}
            onChange={setBailleur}
            disabled={saving}
            error={showErrors && !bailleur ? 'Sélectionnez le bailleur qui paiera l’impôt.' : undefined}
          />

          {/* ---- The bailleur's declared properties ---- */}
          {bailleur && (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold text-ink">Propriétés déclarées</span>
                {!parcelsLoading && ownerParcels.length > 0 && (
                  <span className="flex items-center gap-3 text-[11px]">
                    <span className="text-faint">
                      {selectedIds.size} / {ownerParcels.length} sélectionnée{selectedIds.size === 1 ? '' : 's'}
                    </span>
                    {ownerParcels.length > 1 && (
                      <button
                        type="button"
                        onClick={toggleAllParcels}
                        disabled={saving}
                        className="font-semibold text-accent hover:underline cursor-pointer"
                      >
                        {allParcelsSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {parcelsLoading ? (
                <div className="h-10 px-3 flex items-center rounded-[10px] bg-surface2/60 border border-line text-xs text-muted">
                  Chargement des propriétés déclarées…
                </div>
              ) : ownerParcels.length === 0 ? (
                <p className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed">
                  Aucune propriété n’est déclarée au nom de <strong>{bailleur.name}</strong>. Déclarez-la dans{' '}
                  <strong>Registration → Identification des Propriétés</strong> en le désignant comme
                  propriétaire, puis revenez ici.
                </p>
              ) : (
                <div
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label="Propriétés déclarées du bailleur"
                  className={`rounded-[12px] border divide-y divide-line overflow-hidden ${
                    showErrors && lines.length === 0 ? 'border-danger' : 'border-line'
                  }`}
                >
                  {ownerParcels.map((p) => {
                    const on = selectedIds.has(p.id);
                    const kind = declaredKind(p) || p.measureKind;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggleParcel(p)}
                        disabled={saving}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 cursor-pointer transition-premium ${
                          on ? 'bg-accent-soft/60' : 'bg-surface hover:bg-surface2/50'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 ${
                            on ? 'bg-accent border-accent text-white' : 'border-line bg-surface'
                          }`}
                        >
                          {on && <Check className="w-3 h-3" />}
                        </span>
                        <span className="w-6 h-6 rounded-[7px] bg-surface2 text-accent flex items-center justify-center shrink-0">
                          <Home className="w-3.5 h-3.5" />
                        </span>
                        {/* Nature first, then the address from ville down to the parcel. */}
                        <span className="min-w-0 flex-1 flex items-center gap-2" title={`${natureDisplay(p.nature)} — ${parcelAddress(p)}`}>
                          <span className="font-mono text-xs font-bold text-accent shrink-0">
                            {natureCode(p.nature)}
                          </span>
                          <span className="text-xs text-ink truncate">{parcelAddress(p) || '—'}</span>
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold text-muted px-1.5 py-0.5 rounded-[6px] bg-surface2">
                          {kind === 'nombre' ? 'Nombre' : 'Superficie'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {showErrors && ownerParcels.length > 0 && lines.length === 0 && (
                <p className="text-[12px] text-danger mt-1">Sélectionnez au moins une propriété.</p>
              )}
            </div>
          )}
          {registersEmpty && (
            <p className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed">
              {rangs.length === 0 && usages.length === 0
                ? 'Les registres des rangs et des usages sont vides.'
                : rangs.length === 0
                  ? 'Le registre des rangs est vide.'
                  : 'Le registre des usages est vide.'}{' '}
              Ajoutez-les dans <strong>Settings</strong> pour pouvoir les sélectionner ici.
            </p>
          )}

          {ownerParcels.length > 1 && lines.length > 0 && lines.length < 2 && groups.length < ownerParcels.length && (
            <p className="text-[11px] text-muted -mt-2">
              Le bailleur déclare plusieurs propriétés : cochez chacune d’elles ci-dessus — chaque propriété reçoit son
              propre rang, usage, superficie et taux.
            </p>
          )}

          {groups.map((g, gi) => {
            const head = g.items[0].line;
            const subtotal =
              Math.round(g.items.reduce((sum, it) => sum + (evaluated[it.index]?.montant ?? 0), 0) * 100) / 100;
            return (
              <div key={g.parcelId} className="rounded-[14px] border border-line bg-surface2/30 overflow-hidden">
                {/* Property header: which property, its subtotal, remove it. */}
                <div className="px-4 py-3 bg-surface2/60 border-b border-line flex items-center justify-between gap-3">
                  <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.12em] text-muted truncate">
                    Propriété {gi + 1}
                    <span className="normal-case tracking-normal font-semibold text-ink ml-1.5">
                      — {head.nature ? <span className="font-mono text-accent">{natureCode(head.nature)}</span> : null}
                      {head.nature && head.address ? ' ' : ''}
                      {head.address || (head.numeroParcelle ? `Parcelle ${head.numeroParcelle}` : '')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-[12px] text-muted">
                      Sous-total{' '}
                      <strong className="text-ink tabular-nums">{subtotal > 0 ? fmtUSD(subtotal) : '—'}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeParcel(g.parcelId)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-danger cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Retirer
                    </button>
                  </span>
                </div>

                <div className="divide-y divide-line">
                  {g.items.map(({ line: l, index: i }, si) => {
                    const ev = evaluated[i];
                    const unit = l.measureKind === 'superficie' ? 'm²' : 'unités';
                    const tauxUnit = l.measureKind === 'superficie' ? 'USD / m²' : 'USD / unité';
                    return (
                      <div key={l.key} className="p-4">
                        {g.items.length > 1 && (
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                              Rang / usage {si + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => remove(l.key)}
                              disabled={saving}
                              className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-danger cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              Retirer cette ligne
                            </button>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                          {/* 1. Rang */}
                          <div>
                            <FieldLabel n={1} label="Rang" />
                            <select
                              value={l.rang}
                              onChange={(e) => update(l.key, { rang: e.target.value })}
                              className={`${fieldClass} cursor-pointer ${showErrors && !l.rang ? 'border-danger' : ''}`}
                            >
                              <option value="">Sélectionner le rang…</option>
                              {rangs.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.id}
                                  {r.designation ? ` — ${r.designation}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* 2. Usage */}
                          <div>
                            <FieldLabel n={2} label="Usage" />
                            <select
                              value={l.usage}
                              onChange={(e) => update(l.key, { usage: e.target.value })}
                              className={`${fieldClass} cursor-pointer ${showErrors && !l.usage ? 'border-danger' : ''}`}
                            >
                              <option value="">Sélectionner l’usage…</option>
                              {usages.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.id}
                                  {u.designation ? ` — ${u.designation}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* 3. Superficie ou nombre */}
                          <div>
                            <FieldLabel n={3} label="Superficie ou nombre" hint={unit} />
                            <div className="flex gap-2">
                              <div className="inline-flex p-0.5 rounded-[10px] bg-surface2 border border-line shrink-0">
                                {(['superficie', 'nombre'] as PropertyMeasureKind[]).map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    disabled={l.kindLocked}
                                    title={l.kindLocked ? 'Défini par la déclaration de la propriété (NOTEZ 3)' : undefined}
                                    onClick={() => update(l.key, { measureKind: k })}
                                    className={`px-2.5 h-[34px] rounded-[8px] text-[12px] font-semibold ${
                                      l.kindLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                                    } ${
                                      l.measureKind === k
                                        ? 'bg-surface text-accent shadow-xs'
                                        : l.kindLocked
                                          ? 'text-faint/60'
                                          : 'text-muted hover:text-ink'
                                    }`}
                                  >
                                    {k === 'superficie' ? 'm²' : 'Nombre'}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={l.measure}
                                onChange={(e) => update(l.key, { measure: e.target.value })}
                                placeholder={l.measureKind === 'superficie' ? '0,00' : '0'}
                                className={`${fieldClass} ${
                                  ev.errors.measure || (showErrors && l.measure.trim() === '') ? 'border-danger' : ''
                                }`}
                              />
                            </div>
                            {ev.errors.measure && <p className="text-[12px] text-danger mt-1">{ev.errors.measure}</p>}
                          </div>

                          {/* 4. Taux */}
                          <div>
                            <FieldLabel n={4} label="Taux" hint={tauxUnit} />
                            <input
                              type="text"
                              inputMode="decimal"
                              value={l.taux}
                              onChange={(e) => update(l.key, { taux: e.target.value })}
                              placeholder="0,00"
                              className={`${fieldClass} ${
                                ev.errors.taux || (showErrors && l.taux.trim() === '') ? 'border-danger' : ''
                              }`}
                            />
                            {ev.errors.taux && <p className="text-[12px] text-danger mt-1">{ev.errors.taux}</p>}
                          </div>

                          {/* 5. Montant impôt */}
                          <div className="sm:col-span-2">
                            <FieldLabel n={5} label="Montant impôt" hint="(3) × (4)" />
                            <div className="h-10 px-3 flex items-center rounded-[10px] bg-surface2 border border-line text-sm font-semibold text-ink tabular-nums">
                              {ev.montant === null ? '—' : fmtUSD(ev.montant)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => addSubLine(g.parcelId)}
                  disabled={saving}
                  className="w-full h-9 border-t border-dashed border-line text-[12px] font-semibold text-muted hover:text-accent hover:bg-surface inline-flex items-center justify-center gap-1.5 cursor-pointer transition-premium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter un autre rang ou usage pour cette propriété
                </button>
              </div>
            );
          })}

          {/* Recap: every line and its montant, so the total can be checked at a glance. */}
          {lines.length > 1 && (
            <div className="rounded-[12px] border border-line overflow-hidden">
              <div className="px-3.5 py-2 bg-surface2/60 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                Récapitulatif
              </div>
              <table className="w-full table-fixed text-left">
                <tbody className="divide-y divide-line">
                  {lines.map((l, i) => {
                    const rang = rangs.find((r) => r.id === l.rang);
                    const usage = usages.find((u) => u.id === l.usage);
                    return (
                      <tr key={l.key} className="text-[12px]">
                        <td className="pl-3.5 pr-2 py-2 w-[34%] truncate">
                          <span className="font-mono font-bold text-accent mr-1.5">
                            {l.nature ? natureCode(l.nature) : ''}
                          </span>
                          {l.numeroParcelle ? `Parcelle ${l.numeroParcelle}` : '—'}
                        </td>
                        <td className="px-2 py-2 w-[22%] truncate text-ink">
                          {l.rang ? `Rang ${l.rang}${rang?.designation ? ` — ${rang.designation}` : ''}` : '—'}
                        </td>
                        <td className="px-2 py-2 w-[24%] truncate text-ink">{usage?.designation || l.usage || '—'}</td>
                        <td className="pl-2 pr-3.5 py-2 w-[20%] text-right font-semibold tabular-nums text-ink">
                          {evaluated[i]?.montant == null ? '—' : fmtUSD(evaluated[i].montant as number)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 6. Total impôt dû */}
          <div>
            <FieldLabel n={6} label="Total impôt dû" hint="Σ (5)" />
            <div
              className={`px-3 py-2.5 rounded-[10px] border text-base font-bold tabular-nums ${
                total > 0 ? 'bg-accent-soft border-accent/30 text-accent-dark' : 'bg-surface2 border-line text-faint'
              }`}
            >
              {total > 0 || allComplete ? fmtUSD(total) : '—'}
            </div>
          </div>

          {/* 7. Mode de paiement */}
          <div>
            <FieldLabel n={7} label="Mode de paiement" />
            <div className="relative">
              <Wallet className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <select
                value={modePaiement}
                onChange={(e) => setModePaiement(e.target.value as FoncierPaymentMode | '')}
                className={`${fieldClass} pl-9 cursor-pointer ${showErrors && !modePaiement ? 'border-danger' : ''}`}
              >
                <option value="">Sélectionner le mode de paiement…</option>
                {FONCIER_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {FONCIER_PAYMENT_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showErrors && (!bailleur || !allComplete || !modePaiement) && (
            <p className="text-[12px] text-danger">
              {!bailleur
                ? 'Sélectionnez le bailleur.'
                : lines.length === 0
                  ? 'Sélectionnez au moins une propriété du bailleur.'
                  : !allComplete
                ? 'Complétez chaque ligne : rang, usage, superficie ou nombre, et taux.'
                : 'Sélectionnez le mode de paiement.'}
            </p>
          )}

          <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
            <Lock className="w-3 h-3 shrink-0 mt-px" />
            Un calcul enregistré est ajouté au registre des calculs d'impôts fonciers et ne peut plus être
            modifié ni supprimé.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line bg-surface2/50 flex items-center justify-between gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={reset}
            disabled={saving}
          >
            Réinitialiser
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Fermer
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={saving}
              icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
