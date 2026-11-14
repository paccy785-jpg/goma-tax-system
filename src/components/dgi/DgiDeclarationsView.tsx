import React, { useEffect, useState } from 'react';
import { PageHeader } from '../ui';
import { subscribeToBusinesses } from '../../services/dbService';
import { DgiCalculImpotView } from './DgiCalculImpotView';
import type { Business, UserRole } from '../../types';

type Actor = { uid: string; displayName: string; role: UserRole };

/** The subtabs of the Declarations tab. */
type DeclarationsSubTab = 'calcul';
const SUBTABS: { id: DeclarationsSubTab; label: string; hint: string }[] = [
  { id: 'calcul', label: 'IMPÔTS PROFESSIONNEL ET EXCEPTIONNEL SUR LES RÉMUNÉRATIONS', hint: 'Tax calculation' },
];

/**
 * The Declarations tab of the DGI portal: its subtab bar — Calcul d'impôt,
 * moved here from Registration — and the active subtab.
 */
export const DgiDeclarationsView: React.FC<{ userRole: UserRole; actor: Actor }> = ({ userRole, actor }) => {
  const [subTab, setSubTab] = useState<DeclarationsSubTab>('calcul');
  const [taxpayers, setTaxpayers] = useState<Business[]>([]);

  // The registered taxpayers, live, for the Nouveau calcul card's search field.
  useEffect(() => subscribeToBusinesses((b) => setTaxpayers(b || [])), []);

  // Same rule as on Registration: Admin and Cashier may record a calcul.
  const canModify = userRole === 'Admin' || userRole === 'Cashier';

  return (
    <div className="space-y-8 font-sans">
      <PageHeader title="Declarations" titleSizeClassName="text-xl sm:text-[26px]" />

      {/* Segmented subtab control — the same look as Registration's. */}
      <div
        role="tablist"
        aria-label="Declarations sections"
        className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-surface2 border border-line"
      >
        {SUBTABS.map((tab) => {
          const isActive = tab.id === subTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={tab.hint}
              onClick={() => setSubTab(tab.id)}
              className={`px-4 py-2 rounded-[9px] text-xs font-semibold transition-premium cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-surface text-accent shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)] border border-accent/20'
                  : 'text-muted hover:text-ink border border-transparent'
              }`}
            >
              {/* The official title, kept in French in both languages. */}
              <span data-no-i18n>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {subTab === 'calcul' && <DgiCalculImpotView canModify={canModify} taxpayers={taxpayers} actor={actor} />}
    </div>
  );
};
