import React, { useEffect, useState } from 'react';
import { Calculator, Plus, X } from 'lucide-react';
import { Button, EmptyState, Panel } from '../ui';

/**
 * Catégorie salariale — the choices of the DGI "Nouveau calcul" card, in the
 * order given.
 */
export const CATEGORIES_SALARIALES = [
  'Nationaux non imposables',
  'Nationaux imposables',
  'Expatriés non imposables',
  'Expatrié imposable',
  'Associés actifs',
  'Exploitant individuel',
  'Personnel occasionnel',
] as const;

export type CategorieSalariale = (typeof CATEGORIES_SALARIALES)[number];

/**
 * The figures of the card, below Catégorie salariale, in the order given:
 * Nombre, Rémunérations brutes, Rémunérations imposables, Montant I.P.R,
 * Montant I.E.R, Impôt total dû.
 */
type FigureKey = 'nombre' | 'remunerationsBrutes' | 'remunerationsImposables' | 'montantIpr' | 'montantIer' | 'impotTotalDu';

const FIGURES: { key: FigureKey; label: string; whole?: boolean }[] = [
  { key: 'nombre', label: 'Nombre', whole: true },
  { key: 'remunerationsBrutes', label: 'Rémunérations brutes' },
  { key: 'remunerationsImposables', label: 'Rémunérations imposables' },
  { key: 'montantIpr', label: 'Montant I.P.R' },
  { key: 'montantIer', label: 'Montant I.E.R' },
  { key: 'impotTotalDu', label: 'Impôt total dû' },
];

const EMPTY_FIGURES: Record<FigureKey, string> = {
  nombre: '',
  remunerationsBrutes: '',
  remunerationsImposables: '',
  montantIpr: '',
  montantIer: '',
  impotTotalDu: '',
};

const inputClass =
  'w-full px-3.5 py-2 bg-surface2 border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';

/**
 * The Calcul d'impôt subtab of the DGI portal's Registration: the calculations
 * list and the "Nouveau calcul" button that opens the calculation card.
 */
export const DgiCalculImpotView: React.FC<{ canModify: boolean }> = ({ canModify }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Panel
        title="Calcul d’impôt"
        padding="none"
        actions={
          canModify ? (
            <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setOpen(true)}>
              Nouveau calcul
            </Button>
          ) : undefined
        }
      >
        <div className="p-6">
          <EmptyState
            icon={<Calculator className="w-6 h-6" />}
            title="Aucun calcul d’impôt"
            description="Aucun calcul d’impôt n’est encore enregistré."
          />
        </div>
      </Panel>

      {open && <NouveauCalculCard onClose={() => setOpen(false)} />}
    </>
  );
};

/** The "Nouveau calcul" card. */
const NouveauCalculCard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [categorie, setCategorie] = useState<CategorieSalariale | ''>('');
  const [figures, setFigures] = useState<Record<FigureKey, string>>(EMPTY_FIGURES);
  /** Keep only what the field accepts: digits, and for an amount one decimal separator. */
  const setFigure = (key: FigureKey, raw: string, whole?: boolean) => {
    let v = raw.replace(',', '.');
    v = whole ? v.replace(/\D/g, '') : v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    setFigures((f) => ({ ...f, [key]: v }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
              Calcul d’impôt
            </span>
            <h2 className="font-display text-lg font-bold text-ink tracking-tight">Nouveau calcul</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
          <div>
            <label htmlFor="dgi-calc-categorie" className="block text-xs font-semibold text-ink mb-1">
              Catégorie salariale
            </label>
            <select
              id="dgi-calc-categorie"
              value={categorie}
              onChange={(e) => setCategorie(e.target.value as CategorieSalariale | '')}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">— Sélectionner —</option>
              {CATEGORIES_SALARIALES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {FIGURES.map(({ key, label, whole }) => (
            <div key={key}>
              <label htmlFor={`dgi-calc-${key}`} className="block text-xs font-semibold text-ink mb-1">
                {label}
              </label>
              <input
                id={`dgi-calc-${key}`}
                type="text"
                inputMode={whole ? 'numeric' : 'decimal'}
                autoComplete="off"
                value={figures[key]}
                onChange={(e) => setFigure(key, e.target.value, whole)}
                placeholder={whole ? '0' : '0.00'}
                className={`${inputClass} tabular-nums`}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface2/40 flex items-center justify-end gap-2.5">
          <Button variant="ghost" size="md" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </div>
  );
};
