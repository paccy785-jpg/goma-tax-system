import React, { useEffect, useMemo, useState } from 'react';
import { ScrollText, X, Loader2, Lock, RotateCcw, UserRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  addNotePerception,
  montantEnLettres,
  normalizeNumero,
} from '../../services/notePerceptionService';
import { NomenclatureImpot, subscribeToNomenclatures } from '../../services/nomenclatureService';
import { parseAmount } from '../../utils/taxCalc';
import { Button } from '../ui';
import { TaxpayerSearch } from '../transfer/TaxpayerSearch';
import { NomenclatureSearch } from './NomenclatureSearch';
import { Business } from '../../types';

const fieldClass =
  'w-full px-3 py-2.5 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans';

/** A numbered field, laid out like the Calcul d'impôts card. */
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

const EMPTY = {
  numeroFacture: '',
  articleBudgetaire: '',
  nombreActes: '',
  arreteNumero: '',
  montant: '',
  nomAgent: '',
  qualite: '',
};

export const NotePerceptionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Numbers already used, normalised — a note number is unique. */
  existingNumeros: Set<string>;
  /** The taxpayer register, searched at the top of the card. */
  taxpayers: Business[];
}> = ({ isOpen, onClose, existingNumeros, taxpayers }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const [contribuable, setContribuable] = useState<Business | null>(null);
  /** The tax picked from the Nomenclatures des Impôts — gives the article budgétaire. */
  const [nomenclature, setNomenclature] = useState<NomenclatureImpot | null>(null);
  const [f, setF] = useState(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof EMPTY) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  // The registered Nomenclatures des Impôts, searched under the article budgétaire.
  const [nomenclatures, setNomenclatures] = useState<NomenclatureImpot[]>([]);
  const [nomLoading, setNomLoading] = useState(true);
  useEffect(() => {
    if (!isOpen) return;
    setNomLoading(true);
    return subscribeToNomenclatures(
      (rows) => {
        setNomenclatures(rows || []);
        setNomLoading(false);
      },
      () => setNomLoading(false)
    );
  }, [isOpen]);

  // A picked tax deleted from the nomenclature meanwhile is let go.
  useEffect(() => {
    if (nomLoading || !nomenclature) return;
    if (!nomenclatures.some((n) => n.id === nomenclature.id)) {
      setNomenclature(null);
      setF((prev) => ({ ...prev, articleBudgetaire: '' }));
    }
  }, [nomenclatures, nomLoading, nomenclature]);

  const pickNomenclature = (n: NomenclatureImpot | null) => {
    setNomenclature(n);
    setF((prev) => ({ ...prev, articleBudgetaire: n ? n.articleBudgetaire : '' }));
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  const montantUSD = useMemo(() => {
    const v = parseAmount(f.montant);
    return Number.isFinite(v) ? v : NaN;
  }, [f.montant]);
  const lettres = Number.isFinite(montantUSD) && montantUSD > 0 ? montantEnLettres(montantUSD) : '';
  const actes = /^\d+$/.test(f.nombreActes.trim()) ? Number(f.nombreActes.trim()) : NaN;

  const errors = useMemo(
    () => ({
      contribuable: !contribuable ? 'Sélectionnez le contribuable.' : '',
      numeroFacture: !f.numeroFacture.trim()
        ? 'Saisissez le numéro de la facture ou de la note de taxation.'
        : existingNumeros.has(normalizeNumero(f.numeroFacture))
          ? 'Une note de perception porte déjà ce numéro.'
          : '',
      articleBudgetaire:
        !nomenclature || !f.articleBudgetaire.trim()
          ? "Sélectionnez l'article budgétaire dans la nomenclature des impôts."
          : '',
      nombreActes: !f.nombreActes.trim()
        ? "Saisissez le nombre d'actes."
        : !(actes > 0)
          ? "Le nombre d'actes doit être un nombre entier supérieur à zéro."
          : '',
      arreteNumero: !f.arreteNumero.trim() ? "Saisissez le numéro de l'arrêté." : '',
      montant: !f.montant.trim()
        ? 'Saisissez le montant de la taxe.'
        : !Number.isFinite(montantUSD)
          ? 'Montant invalide.'
          : montantUSD <= 0
            ? 'Le montant de la taxe doit être supérieur à zéro.'
            : '',
      nomAgent: !f.nomAgent.trim() ? "Saisissez le nom de l'agent taxateur." : '',
      qualite: !f.qualite.trim() ? "Saisissez la qualité de l'agent taxateur." : '',
    }),
    [contribuable, nomenclature, f, actes, montantUSD, existingNumeros]
  );
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : '');
  const border = (k: keyof typeof errors) => (err(k) ? 'border-danger' : 'border-line');

  if (!isOpen) return null;

  const reset = () => {
    setContribuable(null);
    setNomenclature(null);
    setF(EMPTY);
    setShowErrors(false);
  };

  const save = async () => {
    setShowErrors(true);
    if (!valid || !contribuable) return;
    if (!userProfile) {
      showToast("Connectez-vous avant d'enregistrer une note de perception.", 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      const note = await addNotePerception(
        {
          contribuableId: contribuable.id,
          contribuableName: contribuable.businessName || '',
          contribuableNif: contribuable.nif || '',
          numeroFacture: f.numeroFacture,
          articleBudgetaire: f.articleBudgetaire,
          nombreActes: actes,
          arreteNumero: f.arreteNumero,
          montantUSD,
          nomAgent: f.nomAgent,
          qualite: f.qualite,
        },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      showToast(
        `Note de perception ${note.taxateur.numeroFacture} enregistrée.`,
        'success',
        'Note de perception enregistrée'
      );
      reset();
      onClose();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Impossible d'enregistrer la note de perception.",
        'error',
        'Échec'
      );
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
        aria-labelledby="np-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <ScrollText className="w-5 h-5" />
            </div>
            <div>
              <h3 id="np-title" className="text-base font-bold font-display">
                Note de perception
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
          {/* Who the note is issued to — picked from the taxpayer register */}
          <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
            <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center">
              <UserRound className="w-3.5 h-3.5" />
            </span>
            <TaxpayerSearch
              id="np-contribuable"
              label="Contribuable"
              hint="Le contribuable à qui la note est adressée — recherché dans le registre des contribuables."
              taxpayers={taxpayers}
              value={contribuable}
              onChange={setContribuable}
              disabled={saving}
              autoFocus
              error={err('contribuable')}
            />
          </div>

          {/* Section header */}
          <div className="flex items-center gap-2 pb-2.5 border-b border-line">
            <span className="w-1.5 h-4 rounded-full bg-accent shrink-0" />
            <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-ink">
              Remplir par le service Taxateur
            </h4>
          </div>

          <Row n={1} label="Numéro de facture ou note de taxation (débit)" htmlFor="np-numero" error={err('numeroFacture')}>
            <input
              id="np-numero"
              type="text"
              value={f.numeroFacture}
              onChange={(e) => set('numeroFacture')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('numeroFacture')} font-mono`}
            />
          </Row>

          <Row n={2} label="Article budgétaire" htmlFor="np-article">
            <NomenclatureSearch
              id="np-article"
              nomenclatures={nomenclatures}
              loading={nomLoading}
              value={nomenclature}
              onChange={pickNomenclature}
              disabled={saving}
              error={err('articleBudgetaire')}
            />
          </Row>

          <Row n={3} label="Nombre d'actes" htmlFor="np-actes" error={err('nombreActes')}>
            <input
              id="np-actes"
              type="text"
              inputMode="numeric"
              value={f.nombreActes}
              onChange={(e) => set('nombreActes')(e.target.value.replace(/[^\d]/g, ''))}
              disabled={saving}
              autoComplete="off"
              placeholder="0"
              className={`${fieldClass} ${border('nombreActes')} tabular-nums`}
            />
          </Row>

          <Row n={4} label="Arrêté numéro" htmlFor="np-arrete" error={err('arreteNumero')}>
            <input
              id="np-arrete"
              type="text"
              value={f.arreteNumero}
              onChange={(e) => set('arreteNumero')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('arreteNumero')} font-mono`}
            />
          </Row>

          <Row n={5} label="Montant taxe en chiffres" htmlFor="np-montant" hint="USD" error={err('montant')}>
            <input
              id="np-montant"
              type="text"
              inputMode="decimal"
              value={f.montant}
              onChange={(e) => set('montant')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              placeholder="0,00"
              className={`${fieldClass} ${border('montant')} tabular-nums`}
            />
          </Row>

          <Row n={6} label="Montant taxe en lettres" hint="(5) en toutes lettres">
            <div
              aria-readonly="true"
              className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink italic min-h-[42px]"
            >
              {lettres || '—'}
            </div>
          </Row>

          <Row n={7} label="Nom de l'agent taxateur" htmlFor="np-agent" error={err('nomAgent')}>
            <input
              id="np-agent"
              type="text"
              value={f.nomAgent}
              onChange={(e) => set('nomAgent')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('nomAgent')}`}
            />
          </Row>

          <Row n={8} label="Qualité" htmlFor="np-qualite" error={err('qualite')}>
            <input
              id="np-qualite"
              type="text"
              value={f.qualite}
              onChange={(e) => set('qualite')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('qualite')}`}
            />
          </Row>

          <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
            <Lock className="w-3 h-3 shrink-0 mt-px" />
            Une fois enregistrée, la partie remplie par le service taxateur est verrouillée et ne peut plus
            être modifiée.
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
