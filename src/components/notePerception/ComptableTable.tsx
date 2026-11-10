import React from 'react';
import { Landmark } from 'lucide-react';
import { NotePerception } from '../../services/notePerceptionService';
import { EmptyState, Panel } from '../ui';
import { ComptableSectionTable } from './NpSectionTables';

/**
 * The bureau comptable's part of each note de perception — the payment.
 *
 * A note appears here once that part has been recorded; the taxateur's part
 * stays on the Note de Perception tab.
 */
export const ComptableTable: React.FC<{
  notes: NotePerception[];
  loading: boolean;
  /** Opens the payment card — absent for read-only roles. */
  onAdd?: () => void;
  /** Opens the payment card on one note awaiting payment. */
  onFill?: (n: NotePerception) => void;
}> = ({ notes, loading, onAdd, onFill }) => {
  const count = notes.filter((n) => !!n.comptable).length;
  const awaiting = notes.filter((n) => !!n.taxateur && !!n.ordonnateur && !n.comptable).length;

  return (
    <Panel
      title="Liste des notes de perception"
      subtitle={
        loading
          ? 'Chargement…'
          : `${awaiting} en attente de paiement • ${count} paiement${count === 1 ? '' : 's'} enregistré${count === 1 ? '' : 's'}`
      }
      padding="none"
    >
      <ComptableSectionTable
        notes={loading ? [] : notes}
        onFill={onFill}
        placeholder={
          loading ? (
            <div className="px-6 py-10 text-center text-xs text-muted">Chargement…</div>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={<Landmark className="w-5 h-5" />}
                title="Aucune note de perception à payer"
                description="Une note de perception apparaît ici dès que le taxateur et l'ordonnateur ont rempli leurs parties."
                actionLabel={onAdd ? 'Remplir la note de perception' : undefined}
                onAction={onAdd}
              />
            </div>
          )
        }
      />
    </Panel>
  );
};
