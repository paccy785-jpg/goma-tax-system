import React, { useEffect, useMemo, useState } from 'react';
import { Landmark, X, Loader2, Lock, RotateCcw, ScrollText, UserRound, Wallet, CalendarDays } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  addPaiementComptable,
  dateTaxationOf,
  montantEnLettres,
  normalizeQuittance,
  NotePerception,
  NOTE_PERCEPTION_PAYMENT_MODES,
  NotePerceptionPaymentModeId,
  notePerceptionPaymentMode,
  numeroModeError,
} from '../../services/notePerceptionService';
import { formatMoney } from '../../utils/money';
import { todayDateString } from '../../utils/date';
import { Business } from '../../types';
import { Button } from '../ui';
import { TaxpayerSearch } from '../transfer/TaxpayerSearch';

const fieldClass =
  'w-full px-3 py-2.5 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans';

/** YYYY-MM-DD → DD/MM/YYYY, read as a calendar date. */
const frDay = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

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

const noteLabel = (n: NotePerception) =>
  `${n.taxateur.numeroFacture} — ${formatMoney(n.taxateur.montantUSD ?? 0)} — taxée le ${frDay(dateTaxationOf(n))}`;

/**
 * The bureau comptable's card: record the payment of a note de perception.
 */
export const PaiementComptableModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Every note de perception; only those not yet paid can be picked. */
  notes: NotePerception[];
  /** The taxpayer register, searched at the top of the card. */
  taxpayers: Business[];
  /** Open the card on this note (its row's "Remplir" button in the list). */
  initialNoteId?: string | null;
}> = ({ isOpen, onClose, notes, taxpayers, initialNoteId }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const today = todayDateString();

  /** Filled in by the service taxateur and by the ordonnateur, not yet paid. */
  const payable = useMemo(() => notes.filter((n) => !!n.taxateur && !!n.ordonnateur && !n.comptable), [notes]);
  const usedQuittances = useMemo(
    () => new Set(notes.filter((n) => n.comptable).map((n) => normalizeQuittance(n.comptable!.quittanceNumero))),
    [notes]
  );

  const [contribuable, setContribuable] = useState<Business | null>(null);
  const [noteId, setNoteId] = useState('');
  const [bureau, setBureau] = useState('');
  const [mode, setMode] = useState<NotePerceptionPaymentModeId | ''>('');
  const [modeNumero, setModeNumero] = useState('');
  const [modeBanque, setModeBanque] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chequeDateBad, setChequeDateBad] = useState(false);
  const [quittance, setQuittance] = useState('');
  const [nom, setNom] = useState('');
  const [date, setDate] = useState(today);
  const [dateBad, setDateBad] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  // Opened from a row of the list: that note, and its taxpayer, are picked.
  useEffect(() => {
    if (!isOpen || !initialNoteId) return;
    const n = notes.find((x) => x.id === initialNoteId);
    if (!n) return;
    const tp = taxpayers.find((t) => t.id === n.taxateur?.contribuableId) || null;
    setContribuable(tp);
    setNoteId(n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialNoteId]);

  // A note paid meanwhile (by someone else) drops out of the pick.
  useEffect(() => {
    if (noteId && !payable.some((n) => n.id === noteId)) setNoteId('');
  }, [payable, noteId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  /** Once a taxpayer is chosen: their notes, and apart, older notes saved without one. */
  const forTaxpayer = useMemo(
    () => (contribuable ? payable.filter((n) => n.taxateur.contribuableId === contribuable.id) : payable),
    [payable, contribuable]
  );
  const unattributed = useMemo(
    () => (contribuable ? payable.filter((n) => !n.taxateur.contribuableId) : []),
    [payable, contribuable]
  );

  // A different taxpayer drops a note that belongs to someone else.
  useEffect(() => {
    if (!contribuable || !noteId) return;
    const n = payable.find((x) => x.id === noteId);
    if (n?.taxateur.contribuableId && n.taxateur.contribuableId !== contribuable.id) setNoteId('');
  }, [contribuable, noteId, payable]);

  const note = payable.find((n) => n.id === noteId) || null;
  const modeInfo = mode ? notePerceptionPaymentMode(mode) : undefined;
  const numbered = !!modeInfo?.numbered;
  const needsBank = mode === 'cheque_bancaire';
  const dateTaxation = note ? dateTaxationOf(note) : '';
  const montant = note ? note.taxateur.montantUSD : null;
  const lettres = montant !== null ? montantEnLettres(montant) : '';

  const errors = useMemo(
    () => ({
      contribuable: !contribuable ? 'Sélectionnez le contribuable.' : '',
      note: !note ? 'Sélectionnez la note de perception à payer.' : '',
      bureau: !bureau.trim() ? 'Saisissez le code ou la désignation du bureau comptable.' : '',
      mode: !mode
        ? 'Sélectionnez le mode de paiement.'
        : numbered && !modeNumero.trim()
          ? numeroModeError(mode)
          : needsBank && !modeBanque.trim()
            ? 'Saisissez la banque du chèque.'
            : needsBank && chequeDateBad
              ? BAD_DATE
              : needsBank && !chequeDate
                ? 'Saisissez la date du chèque.'
                : needsBank && chequeDate > today
                  ? 'La date du chèque ne peut pas être dans le futur.'
                  : needsBank && date && chequeDate > date
                    ? 'La date du chèque ne peut pas être postérieure à la date du paiement.'
                    : '',
      quittance: !quittance.trim()
        ? 'Saisissez le numéro de la quittance.'
        : usedQuittances.has(normalizeQuittance(quittance))
          ? 'Ce numéro de quittance a déjà été utilisé pour une autre note de perception.'
          : '',
      nom: !nom.trim() ? 'Saisissez le nom du comptable.' : '',
      date: dateBad
        ? BAD_DATE
        : !date
          ? 'Saisissez la date du paiement.'
          : date > today
            ? 'La date du paiement ne peut pas être dans le futur.'
            : dateTaxation && date < dateTaxation
              ? 'La date du paiement ne peut pas précéder la date de taxation.'
              : '',
    }),
    [contribuable, note, bureau, mode, numbered, modeNumero, needsBank, modeBanque, chequeDate, chequeDateBad, quittance, usedQuittances, nom, date, dateBad, today, dateTaxation]
  );
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : '');
  const border = (k: keyof typeof errors) => (err(k) ? 'border-danger' : 'border-line');

  if (!isOpen) return null;

  const reset = () => {
    setContribuable(null);
    setNoteId('');
    setBureau('');
    setMode('');
    setModeNumero('');
    setModeBanque('');
    setChequeDate('');
    setChequeDateBad(false);
    setQuittance('');
    setNom('');
    setDate(todayDateString());
    setDateBad(false);
    setShowErrors(false);
  };

  const save = async () => {
    setShowErrors(true);
    if (!valid || !note) return;
    if (!userProfile) {
      showToast("Connectez-vous avant d'enregistrer un paiement.", 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      const c = await addPaiementComptable(
        note,
        {
          bureauComptable: bureau,
          modePaiementId: mode,
          modePaiementNumero: numbered ? modeNumero : undefined,
          modePaiementBanque: needsBank ? modeBanque : undefined,
          modePaiementDateCheque: needsBank ? chequeDate : undefined,
          quittanceNumero: quittance,
          nomComptable: nom,
          date,
        },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role },
        usedQuittances
      );
      showToast(
        `Paiement de ${formatMoney(c.montantUSD)} enregistré pour la note de perception ${note.taxateur.numeroFacture} — quittance n° ${c.quittanceNumero}.`,
        'success',
        'Paiement enregistré'
      );
      reset();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Impossible d'enregistrer le paiement.", 'error', 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const options = (list: NotePerception[]) =>
    list.map((n) => (
      <option key={n.id} value={n.id}>
        {noteLabel(n)}
      </option>
    ));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 id="pc-title" className="text-base font-bold font-display">
                Remplir la note de perception
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
          {/* ---- Taxpayer ---- */}
          <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
            <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center">
              <UserRound className="w-3.5 h-3.5" />
            </span>
            <TaxpayerSearch
              id="pc-contribuable"
              label="Contribuable"
              hint="Le contribuable qui paie — recherché dans le registre des contribuables."
              taxpayers={taxpayers}
              value={contribuable}
              onChange={setContribuable}
              disabled={saving}
              autoFocus
              error={err('contribuable')}
            />
          </div>

          {/* ---- The note being paid ---- */}
          <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
            <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center">
              <ScrollText className="w-3.5 h-3.5" />
            </span>
            <div className="space-y-1.5 min-w-0">
              <label htmlFor="pc-note" className="text-xs font-semibold text-ink">
                Note de perception
              </label>
              {payable.length === 0 ? (
                <p className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed">
                  Aucune note de perception n'attend de paiement. Une note doit d'abord être remplie par le
                  taxateur puis ordonnancée par l'ordonnateur, dans l'onglet Note de Perception.
                </p>
              ) : (
                <select
                  id="pc-note"
                  value={noteId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setNoteId(id);
                    // Picking a note first fills in the taxpayer it was issued to.
                    const tpId = payable.find((x) => x.id === id)?.taxateur.contribuableId;
                    if (!contribuable && tpId) {
                      const tp = taxpayers.find((t) => t.id === tpId);
                      if (tp) setContribuable(tp);
                    }
                  }}
                  disabled={saving}
                  className={`${fieldClass} ${border('note')} cursor-pointer`}
                >
                  <option value="">Sélectionner la note de perception…</option>
                  {!contribuable ? (
                    options(payable)
                  ) : (
                    <>
                      {forTaxpayer.length > 0 && (
                        <optgroup label={`Contribuable : ${contribuable.businessName}`}>{options(forTaxpayer)}</optgroup>
                      )}
                      {unattributed.length > 0 && (
                        <optgroup label="Notes sans contribuable enregistré">{options(unattributed)}</optgroup>
                      )}
                    </>
                  )}
                </select>
              )}
              {contribuable && payable.length > 0 && forTaxpayer.length === 0 && unattributed.length === 0 && (
                <p className="text-[12px] text-muted">
                  Aucune note de perception de {contribuable.businessName} n'attend de paiement.
                </p>
              )}
              {err('note') && payable.length > 0 && <p className="text-[12px] text-danger">{err('note')}</p>}
              {note && (
                <div className="rounded-[10px] bg-surface2/60 border border-line px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                  <span className="text-muted">Article budgétaire</span>
                  <span className="text-ink font-mono text-right truncate">{note.taxateur.articleBudgetaire}</span>
                  <span className="text-muted">Montant taxé</span>
                  <span className="text-ink font-bold text-right tabular-nums">{formatMoney(note.taxateur.montantUSD)}</span>
                  <span className="text-muted">Date de taxation</span>
                  <span className="text-ink font-mono text-right tabular-nums">{frDay(dateTaxation)}</span>
                </div>
              )}
            </div>
          </div>

          <Row n={1} label="Code ou désignation du bureau comptable" htmlFor="pc-bureau" error={err('bureau')}>
            <input
              id="pc-bureau"
              type="text"
              value={bureau}
              onChange={(e) => setBureau(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('bureau')}`}
            />
          </Row>

          <Row n={2} label="Mode de paiement" htmlFor="pc-mode" error={err('mode')}>
            <div className="relative">
              <Wallet className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <select
                id="pc-mode"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as NotePerceptionPaymentModeId | '');
                  setModeNumero('');
                  setModeBanque('');
                  setChequeDate('');
                  setChequeDateBad(false);
                }}
                disabled={saving}
                className={`${fieldClass} ${border('mode')} pl-9 cursor-pointer`}
              >
                <option value="">Sélectionner le mode de paiement…</option>
                {NOTE_PERCEPTION_PAYMENT_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {numbered && (
              <div className="relative mt-2">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted pointer-events-none">
                  N°
                </span>
                <input
                  id="pc-mode-numero"
                  type="text"
                  value={modeNumero}
                  onChange={(e) => setModeNumero(e.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  autoFocus
                  aria-label={modeInfo!.label}
                  placeholder={
                    mode === 'cheque_bancaire'
                      ? 'Numéro du chèque bancaire'
                      : mode === 'cheque_postal'
                        ? 'Numéro du chèque postal'
                        : "Numéro de l'avis de crédit"
                  }
                  className={`${fieldClass} ${showErrors && !modeNumero.trim() ? 'border-danger' : 'border-line'} pl-10`}
                />
              </div>
            )}
            {needsBank && (
              <div className="relative mt-2">
                <Landmark className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                <input
                  id="pc-mode-banque"
                  type="text"
                  value={modeBanque}
                  onChange={(e) => setModeBanque(e.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  aria-label="Banque"
                  placeholder="Banque"
                  className={`${fieldClass} ${showErrors && !modeBanque.trim() ? 'border-danger' : 'border-line'} pl-9`}
                />
              </div>
            )}
            {needsBank && (
              <div className="mt-2 flex items-center gap-3">
                <label
                  htmlFor="pc-cheque-date"
                  className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-muted"
                >
                  <CalendarDays className="w-4 h-4 text-faint" />
                  Date du chèque
                </label>
                <DateField
                  id="pc-cheque-date"
                  value={chequeDate}
                  max={date && date < today ? date : today}
                  onDateChange={(v, bad) => {
                    setChequeDate(v);
                    setChequeDateBad(bad);
                  }}
                  disabled={saving}
                  className={`${fieldClass} ${
                    showErrors && (chequeDateBad || !chequeDate || chequeDate > today || (!!date && chequeDate > date))
                      ? 'border-danger'
                      : 'border-line'
                  } tabular-nums`}
                />
              </div>
            )}
          </Row>

          <Row n={3} label="Quittance numéro" htmlFor="pc-quittance" error={err('quittance')}>
            <input
              id="pc-quittance"
              type="text"
              value={quittance}
              onChange={(e) => setQuittance(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('quittance')} font-mono`}
            />
          </Row>

          <Row n={4} label="Montant en chiffres" hint="repris de la note de perception">
            <div
              aria-readonly="true"
              title="Montant de la note de perception — non modifiable"
              className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm font-semibold text-ink tabular-nums flex items-center justify-between gap-2 cursor-not-allowed select-none min-h-[42px]"
            >
              <span>{montant !== null ? formatMoney(montant) : '—'}</span>
              {montant !== null && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted">
                  <Lock className="w-3 h-3" />
                  Verrouillé
                </span>
              )}
            </div>
          </Row>

          <Row n={5} label="Montant en lettres" hint="(4) en toutes lettres">
            <div
              aria-readonly="true"
              className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink italic min-h-[42px]"
            >
              {lettres || '—'}
            </div>
          </Row>

          <Row n={6} label="Nom du comptable" htmlFor="pc-nom" error={err('nom')}>
            <input
              id="pc-nom"
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('nom')}`}
            />
          </Row>

          <Row n={7} label="Date" htmlFor="pc-date" error={err('date')}>
            <DateField
              id="pc-date"
              value={date}
              min={dateTaxation || undefined}
              max={today}
              onDateChange={(v, bad) => {
                setDate(v);
                setDateBad(bad);
              }}
              disabled={saving}
              className={`${fieldClass} ${border('date')} tabular-nums`}
            />
          </Row>

          <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
            <Lock className="w-3 h-3 shrink-0 mt-px" />
            Une fois enregistré, le paiement est verrouillé et ne peut plus être modifié.
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
              disabled={saving || payable.length === 0}
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
