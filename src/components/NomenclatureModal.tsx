import React, { useEffect, useMemo, useState } from 'react';
import { BookOpenText, X, Loader2, Lock, RotateCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  addNomenclature,
  NomenclatureImpot,
  DEVISES,
  TauxDevise,
  formatTaux,
  findNomenclatureConflict,
  updateNomenclature,
} from '../services/nomenclatureService';
import { Button } from './ui';

const fieldClass =
  'w-full px-3 py-2.5 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans';

/** A numbered field, laid out like the other cards. */
const Row: React.FC<{
  n: number;
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}> = ({ n, label, htmlFor, error, children }) => (
  <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
    <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-surface2 text-ink text-[12px] font-bold flex items-center justify-center font-mono">
      {n}
    </span>
    <div className="space-y-1.5 min-w-0">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink">
        {label}
      </label>
      {children}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  </div>
);

const EMPTY: {
  titre: string;
  articleBudgetaire: string;
  libelle: string;
  faitGenerateur: string;
  periodicite: string;
  taux: string;
  devise: TauxDevise | '';
} = { titre: '', articleBudgetaire: '', libelle: '', faitGenerateur: '', periodicite: '', taux: '', devise: '' };

export const NomenclatureModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** The nomenclature as loaded — checked against the article-sharing rule. */
  existingRows: NomenclatureImpot[];
  /** The entry being corrected; absent when adding a new one. */
  editing?: NomenclatureImpot | null;
}> = ({ isOpen, onClose, existingRows, editing }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const [f, setF] = useState(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof EMPTY) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  // Each opening starts without error messages.
  useEffect(() => {
    if (!isOpen) return;
    setShowErrors(false);
    // Correcting an entry starts from its saved values; adding starts empty.
    setF(
      editing
        ? {
            titre: editing.titre || '',
            articleBudgetaire: editing.articleBudgetaire,
            libelle: editing.libelle || '',
            faitGenerateur: editing.faitGenerateur,
            periodicite: editing.periodicite,
            taux: editing.taux,
            // Entries saved before the choice existed are in US dollars.
            devise: editing.devise || 'USD',
          }
        : EMPTY
    );
  }, [isOpen, editing]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  /** Same title may share an article; another title may not; the exact same tax twice may not. */
  const conflict = useMemo(
    () => findNomenclatureConflict(f, existingRows, editing?.id),
    [f, existingRows, editing]
  );

  const errors = useMemo(
    () => ({
      articleBudgetaire: !f.articleBudgetaire.trim()
        ? "Saisissez l'article budgétaire."
        : conflict?.kind === 'autre-titre'
          ? conflict.message
          : '',
      libelle: !f.libelle.trim() ? 'Saisissez le libellé.' : conflict?.kind === 'doublon' ? conflict.message : '',
      faitGenerateur: !f.faitGenerateur.trim() ? 'Saisissez le fait générateur.' : '',
      periodicite: !f.periodicite.trim() ? 'Saisissez la périodicité.' : '',
      taux: f.devise !== 'GRATUIT' && !f.taux.trim() ? 'Saisissez le taux.' : '',
      devise: !f.devise ? 'Choisissez la devise du taux, ou Gratuit.' : '',
    }),
    [f, conflict]
  );
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : '');
  const border = (k: keyof typeof errors) => (err(k) ? 'border-danger' : 'border-line');

  if (!isOpen) return null;

  const reset = () => {
    setF(
      editing
        ? {
            titre: editing.titre || '',
            articleBudgetaire: editing.articleBudgetaire,
            libelle: editing.libelle || '',
            faitGenerateur: editing.faitGenerateur,
            periodicite: editing.periodicite,
            taux: editing.taux,
            // Entries saved before the choice existed are in US dollars.
            devise: editing.devise || 'USD',
          }
        : EMPTY
    );
    setShowErrors(false);
  };

  const save = async () => {
    setShowErrors(true);
    if (!valid) return;
    if (!userProfile) {
      showToast("Connectez-vous avant d'ajouter une nomenclature.", 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      const actor = { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role };
      if (editing) {
        const row = await updateNomenclature(editing, f, actor, existingRows);
        showToast(`Article budgétaire ${row.articleBudgetaire} modifié.`, 'success', 'Nomenclature modifiée');
      } else {
        const row = await addNomenclature(f, actor, existingRows);
        showToast(`Article budgétaire ${row.articleBudgetaire} ajouté à la nomenclature.`, 'success', 'Nomenclature ajoutée');
      }
      reset();
      onClose();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : editing ? 'Impossible de modifier la nomenclature.' : "Impossible d'ajouter la nomenclature.",
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
        aria-labelledby="nom-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <BookOpenText className="w-5 h-5" />
            </div>
            <div>
              <h3 id="nom-title" className="text-base font-bold font-display">
                {editing ? 'Modifier la nomenclature' : 'Ajouter une nomenclature'}
              </h3>
              <p className="text-xs text-white/70">Nomenclatures des Impôts</p>
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
          <Row n={1} label="Titre (facultatif)" htmlFor="nom-titre">
            <input
              id="nom-titre"
              type="text"
              value={f.titre}
              onChange={(e) => set('titre')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              autoFocus
              className={`${fieldClass} border-line`}
            />
          </Row>

          <Row n={2} label="Art. budgétaire" htmlFor="nom-article" error={err('articleBudgetaire')}>
            <input
              id="nom-article"
              type="text"
              value={f.articleBudgetaire}
              onChange={(e) => set('articleBudgetaire')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('articleBudgetaire')} font-mono`}
            />
          </Row>

          <Row n={3} label="Libellé" htmlFor="nom-libelle" error={err('libelle')}>
            <input
              id="nom-libelle"
              type="text"
              value={f.libelle}
              onChange={(e) => set('libelle')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className={`${fieldClass} ${border('libelle')}`}
            />
          </Row>

          <Row n={4} label="Fait générateur" htmlFor="nom-fait" error={err('faitGenerateur')}>
            <textarea
              id="nom-fait"
              rows={3}
              value={f.faitGenerateur}
              onChange={(e) => set('faitGenerateur')(e.target.value)}
              disabled={saving}
              className={`${fieldClass} ${border('faitGenerateur')} resize-y leading-snug`}
            />
          </Row>

          <Row n={5} label="Périodicité" htmlFor="nom-periodicite" error={err('periodicite')}>
            <input
              id="nom-periodicite"
              type="text"
              value={f.periodicite}
              onChange={(e) => set('periodicite')(e.target.value)}
              disabled={saving}
              autoComplete="off"
              placeholder="Saisir la périodicité (ex. Annuelle, Mensuelle…)"
              className={`${fieldClass} ${border('periodicite')}`}
            />
          </Row>

          <Row n={6} label="Taux" htmlFor="nom-taux" error={err('taux') || err('devise')}>
            <div className="flex items-stretch gap-2">
              <input
                id="nom-taux"
                type="text"
                inputMode="decimal"
                value={f.devise === 'GRATUIT' ? '' : f.taux}
                onChange={(e) => set('taux')(e.target.value)}
                disabled={saving || f.devise === 'GRATUIT'}
                autoComplete="off"
                placeholder={f.devise === 'GRATUIT' ? 'Gratuit — aucun montant' : 'Montant, ex. 300'}
                className={`${fieldClass} ${border('taux')} flex-1 min-w-0 tabular-nums disabled:bg-surface2 disabled:cursor-not-allowed`}
              />
              {/* Devise du taux — the currency the amount is shown in. */}
              <div
                role="radiogroup"
                aria-label="Devise du taux"
                className={`shrink-0 inline-flex items-center gap-1 p-1 rounded-[10px] border bg-surface2 ${
                  err('devise') ? 'border-danger' : 'border-line'
                }`}
              >
                {DEVISES.map((d) => {
                  const on = f.devise === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={d.label}
                      onClick={() => {
                        set('devise')(d.id);
                        // Gratuit has no amount: clear whatever was typed.
                        if (d.id === 'GRATUIT') set('taux')('');
                      }}
                      disabled={saving}
                      className={`h-full px-3 rounded-[8px] text-xs font-semibold whitespace-nowrap transition-premium cursor-pointer ${
                        on
                          ? 'bg-surface text-accent shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)] border border-accent/20'
                          : 'text-muted hover:text-ink border border-transparent'
                      }`}
                    >
                      {d.button}
                    </button>
                  );
                })}
              </div>
            </div>
            {f.devise && (f.devise === 'GRATUIT' || f.taux.trim()) ? (
              <p className="text-[12px] text-muted">
                Affiché : <span className="font-semibold text-ink tabular-nums">{formatTaux(f.taux, f.devise)}</span>
              </p>
            ) : (
              <p className="text-[12px] text-faint">Saisissez le montant et choisissez la devise, ou choisissez Gratuit.</p>
            )}
          </Row>
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
