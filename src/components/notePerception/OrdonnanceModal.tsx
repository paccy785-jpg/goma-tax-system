import React, { useEffect, useMemo, useState } from 'react';
import { Stamp, X, Loader2, Lock, RotateCcw, ScrollText, UserRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  addOrdonnance,
  dateTaxationOf,
  montantEnLettres,
  NotePerception,
} from '../../services/notePerceptionService';
import { parseAmount } from '../../utils/taxCalc';
import { formatMoney } from '../../utils/money';
import { todayDateString } from '../../utils/date';
import { Button } from '../ui';
import { TaxpayerSearch } from '../transfer/TaxpayerSearch';
import { Business } from '../../types';

const fieldClass =
  'w-full px-3 py-2.5 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans';

/** YYYY-MM-DD → DD/MM/YYYY, read as a calendar date. */
const frDay = (d: string) => (d ? d.split('-').reverse().join('/') : '—');

/** A numbered field, laid out like the other cards. */
const Row: React.FC<{
  n: number;
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}> = ({ n, label, htmlFor, hint, error, children }) => (
  <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
    <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-surface2 text-ink text-[12px] font-bold flex items-center justify-center font-mono">
      {n}
    </span>
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-semibold text-ink">
          {label}
        </label>
        {hint && <span className="text-[11px] font-mono text-faint shrink-0">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  </div>
);

/**
 * A date input that also reports when it holds a date the browser cannot read
 * (e.g. 31/04): the field keeps showing it while its value silently becomes "".
 */
const DateField: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> & {
    value: string;
    onDateChange: (value: string, bad: boolean) => void;
  }
> = ({ value, onDateChange, ...rest }) => {
  const report = (el: HTMLInputElement) => onDateChange(el.value, el.validity.badInput);
  return (
    <input
      {...rest}
      type="date"
      value={value}
      onChange={(e) => report(e.currentTarget)}
      onInput={(e) => report(e.currentTarget)}
      onKeyUp={(e) => report(e.currentTarget)}
      onBlur={(e) => report(e.currentTarget)}
    />
  );
};

const BAD_DATE = "Date invalide — ce jour n'existe pas dans le calendrier (ex. 31/04).";

export const OrdonnanceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Every note de perception; only those not yet ordonnancées can be picked. */
  notes: NotePerception[];
  /** The taxpayer register, searched at the top of the card. */
  taxpayers: Business[];
}> = ({ isOpen, onClose, notes, taxpayers }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const today = todayDateString();

  const awaiting = useMemo(() => notes.filter((n) => !n.ordonnateur), [notes]);

  const [contribuable, setContribuable] = useState<Business | null>(null);
  const [noteId, setNoteId] = useState('');
  const [avis, setAvis] = useState('');
  const [montant, setMontant] = useState('');
  const [auPlusTard, setAuPlusTard] = useState('');
  const [auPlusTardBad, setAuPlusTardBad] = useState(false);
  const [dateOrd, setDateOrd] = useState(today);
  const [dateOrdBad, setDateOrdBad] = useState(false);
  const [nom, setNom] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  // A note that was ordonnancée meanwhile (by someone else) drops out of the pick.
  useEffect(() => {
    if (noteId && !awaiting.some((n) => n.id === noteId)) setNoteId('');
  }, [awaiting, noteId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  /**
   * The notes offered once a taxpayer is chosen: theirs, then any older note
   * saved before notes recorded a taxpayer (it cannot be matched, so it is
   * listed apart rather than hidden).
   */
  const forTaxpayer = useMemo(
    () => (contribuable ? awaiting.filter((n) => n.taxateur.contribuableId === contribuable.id) : awaiting),
    [awaiting, contribuable]
  );
  const unattributed = useMemo(
    () => (contribuable ? awaiting.filter((n) => !n.taxateur.contribuableId) : []),
    [awaiting, contribuable]
  );

  // A different taxpayer drops a note that belongs to someone else.
  useEffect(() => {
    if (!contribuable || !noteId) return;
    const n = awaiting.find((x) => x.id === noteId);
    if (n?.taxateur.contribuableId && n.taxateur.contribuableId !== contribuable.id) setNoteId('');
  }, [contribuable, noteId, awaiting]);

  const note = awaiting.find((n) => n.id === noteId) || null;
  const dateTaxation = note ? dateTaxationOf(note) : '';

  const montantUSD = useMemo(() => {
    const v = parseAmount(montant);
    return Number.isFinite(v) ? v : NaN;
  }, [montant]);
  const lettres = Number.isFinite(montantUSD) && montantUSD > 0 ? montantEnLettres(montantUSD) : '';

  const errors = useMemo(
    () => ({
      contribuable: !contribuable ? 'Sélectionnez le contribuable.' : '',
      note: !note ? "Sélectionnez la note de perception à ordonnancer." : '',
      avis: !avis.trim() ? "Saisissez l'avis de l'ordonnateur." : '',
      montant: !montant.trim()
        ? 'Saisissez le montant ordonné.'
        : !Number.isFinite(montantUSD)
          ? 'Montant invalide.'
          : montantUSD <= 0
            ? 'Le montant ordonné doit être supérieur à zéro.'
            : '',
      auPlusTard: auPlusTardBad
        ? BAD_DATE
        : !auPlusTard
          ? 'Saisissez la date limite de paiement.'
          : dateOrd && auPlusTard < dateOrd
            ? "La date limite de paiement ne peut pas précéder la date d'ordonnancement."
            : '',
      dateOrd: dateOrdBad
        ? BAD_DATE
        : !dateOrd
          ? "Saisissez la date d'ordonnancement."
          : dateOrd > today
            ? "La date d'ordonnancement ne peut pas être dans le futur."
            : dateTaxation && dateOrd < dateTaxation
              ? "La date d'ordonnancement ne peut pas précéder la date de taxation."
              : '',
      nom: !nom.trim() ? "Saisissez le nom de l'ordonnateur." : '',
    }),
    [contribuable, note, avis, montant, montantUSD, auPlusTard, auPlusTardBad, dateOrd, dateOrdBad, today, dateTaxation, nom]
  );
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : '');
  const border = (k: keyof typeof errors) => (err(k) ? 'border-danger' : 'border-line');

  if (!isOpen) return null;

  const reset = () => {
    setContribuable(null);
    setNoteId('');
    setAvis('');
    setMontant('');
    setAuPlusTard('');
    setAuPlusTardBad(false);
    setDateOrd(todayDateString());
    setDateOrdBad(false);
    setNom('');
    setShowErrors(false);
  };

  const save = async () => {
    setShowErrors(true);
    if (!valid || !note || !contribuable) return;
    if (!userProfile) {
      showToast("Connectez-vous avant d'enregistrer une ordonnance.", 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      await addOrdonnance(
        note,
        {
          contribuableId: contribuable.id,
          contribuableName: contribuable.businessName || '',
          contribuableNif: contribuable.nif || '',
          avis,
          montantOrdonneUSD: montantUSD,
          paiementAuPlusTardLe: auPlusTard,
          dateOrdonnancement: dateOrd,
          nomOrdonnateur: nom,
        },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      showToast(
        `Ordonnance enregistrée pour la note de perception ${note.taxateur.numeroFacture}.`,
        'success',
        'Ordonnance enregistrée'
      );
      reset();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Impossible d'enregistrer l'ordonnance.", 'error', 'Échec');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ord-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <Stamp className="w-5 h-5" />
            </div>
            <div>
              <h3 id="ord-title" className="text-base font-bold font-display">
                Enregistrer l'ordonnance
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
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* ---- Who the ordonnance is for ---- */}
          <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
            <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center">
              <UserRound className="w-3.5 h-3.5" />
            </span>
            <TaxpayerSearch
              id="ord-contribuable"
              label="Contribuable"
              hint="Le contribuable concerné par l'ordonnance — recherché dans le registre des contribuables."
              taxpayers={taxpayers}
              value={contribuable}
              onChange={setContribuable}
              disabled={saving}
              autoFocus
              error={err('contribuable')}
            />
          </div>

          {/* ---- Which note is being ordered ---- */}
          <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
            <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center">
              <ScrollText className="w-3.5 h-3.5" />
            </span>
            <div className="space-y-1.5 min-w-0">
              <label htmlFor="ord-note" className="text-xs font-semibold text-ink">
                Note de perception
              </label>
              {awaiting.length === 0 ? (
                <p className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed">
                  Aucune note de perception n'attend d'ordonnancement. Ajoutez d'abord une note dans l'onglet
                  Note de Perception.
                </p>
              ) : (
                <select
                  id="ord-note"
                  value={noteId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setNoteId(id);
                    // Picking a note first fills in the taxpayer it was issued to.
                    const picked = awaiting.find((x) => x.id === id);
                    const tpId = picked?.taxateur.contribuableId;
                    if (!contribuable && tpId) {
                      const tp = taxpayers.find((t) => t.id === tpId);
                      if (tp) setContribuable(tp);
                    }
                  }}
                  disabled={saving}
                  className={`${fieldClass} ${border('note')} cursor-pointer`}
                >
                  <option value="">Sélectionner la note de perception…</option>
                  {!contribuable
                    ? awaiting.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.taxateur.numeroFacture} — {formatMoney(n.taxateur.montantUSD)} — {n.taxateur.nomAgent}
                        </option>
                      ))
                    : (
                      <>
                        {forTaxpayer.length > 0 && (
                          <optgroup label={`Contribuable : ${contribuable.businessName}`}>
                            {forTaxpayer.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.taxateur.numeroFacture} — {formatMoney(n.taxateur.montantUSD)} — {n.taxateur.nomAgent}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {unattributed.length > 0 && (
                          <optgroup label="Notes sans contribuable enregistré">
                            {unattributed.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.taxateur.numeroFacture} — {formatMoney(n.taxateur.montantUSD)} — {n.taxateur.nomAgent}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    )}
                </select>
              )}
              {contribuable && awaiting.length > 0 && forTaxpayer.length === 0 && unattributed.length === 0 && (
                <p className="text-[12px] text-muted">
                  Aucune note de perception de {contribuable.businessName} n'attend d'ordonnancement.
                </p>
              )}
              {err('note') && awaiting.length > 0 && <p className="text-[12px] text-danger">{err('note')}</p>}
              {note && (
                <div className="rounded-[10px] bg-surface2/60 border border-line px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                  <span className="text-muted">Article budgétaire</span>
                  <span className="text-ink font-mono text-right truncate">{note.taxateur.articleBudgetaire}</span>
                  <span className="text-muted">Arrêté numéro</span>
                  <span className="text-ink font-mono text-right truncate">{note.taxateur.arreteNumero}</span>
                  <span className="text-muted">Montant taxé</span>
                  <span className="text-ink font-bold text-right tabular-nums">{formatMoney(note.taxateur.montantUSD)}</span>
                  <span className="text-muted">Date de taxation</span>
                  <span className="text-ink font-mono text-right tabular-nums">{frDay(dateTaxation)}</span>
                </div>
              )}
            </div>
          </div>

          <Row n={1} label="Avis de l'ordonnateur" htmlFor="ord-avis" error={err('avis')}>
            <textarea
              id="ord-avis"
              value={avis}
              onChange={(e) => setAvis(e.target.value)}
              disabled={saving}
              rows={3}
              className={`${fieldClass} ${border('avis')} resize-y min-h-[76px]`}
            />
          </Row>

          <Row n={2} label="Montant ordonné en chiffres" htmlFor="ord-montant" hint="USD" error={err('montant')}>
            <input
              id="ord-montant"
              type="text"
              inputMode="decimal"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              disabled={saving}
              autoComplete="off"
              placeholder="0,00"
              className={`${fieldClass} ${border('montant')} tabular-nums`}
            />
            {note && (
              <button
                type="button"
                onClick={() => setMontant(String(note.taxateur.montantUSD))}
                disabled={saving}
                className="text-[12px] text-accent hover:underline cursor-pointer disabled:opacity-50"
              >
                Reprendre le montant taxé : {formatMoney(note.taxateur.montantUSD)}
              </button>
            )}
          </Row>

          <Row n={3} label="Montant ordonné en lettres" hint="(2) en toutes lettres">
            <div
              aria-readonly="true"
              className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink italic min-h-[42px]"
            >
              {lettres || '—'}
            </div>
          </Row>

          <Row n={4} label="Le paiement doit intervenir au plus tard le" htmlFor="ord-auplustard" error={err('auPlusTard')}>
            <DateField
              id="ord-auplustard"
              value={auPlusTard}
              min={dateOrd || undefined}
              onDateChange={(v, bad) => {
                setAuPlusTard(v);
                setAuPlusTardBad(bad);
              }}
              disabled={saving}
              className={`${fieldClass} ${border('auPlusTard')} tabular-nums`}
            />
          </Row>

          <Row n={5} label="Date d'ordonnancement" htmlFor="ord-date" error={err('dateOrd')}>
            <DateField
              id="ord-date"
              value={dateOrd}
              min={dateTaxation || undefined}
              max={today}
              onDateChange={(v, bad) => {
                setDateOrd(v);
                setDateOrdBad(bad);
              }}
              disabled={saving}
              className={`${fieldClass} ${border('dateOrd')} tabular-nums`}
            />
          </Row>

          <Row n={6} label="Nom de l'ordonnateur" htmlFor="ord-nom">
            <input
              id="ord-nom"
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              disabled={saving}
              autoComplete="off"
              placeholder="Nom de l'ordonnateur"
              className={`${fieldClass} ${border('nom')}`}
            />
            {err('nom') && <p className="text-[12px] text-danger">{err('nom')}</p>}
          </Row>

          <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
            <Lock className="w-3 h-3 shrink-0 mt-px" />
            Une fois enregistrée, l'ordonnance est verrouillée et ne peut plus être modifiée.
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
              disabled={saving || awaiting.length === 0}
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
