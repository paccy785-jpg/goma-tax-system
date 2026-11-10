import React from 'react';
import { Stamp } from 'lucide-react';
import { NotePerception } from '../../services/notePerceptionService';
import { EmptyState, Panel } from '../ui';
import { OrdonnateurSectionTable } from './NpSectionTables';

/**
 * The ordonnateur's part of each note de perception.
 *
 * A note appears here once its ordonnateur section has been filled in; the
 * taxateur's part stays on its own subtab.
 */
export const OrdonnateurTable: React.FC<{
  notes: NotePerception[];
  loading: boolean;
  /** Opens the ordonnance card — absent for read-only roles. */
  onAdd?: () => void;
}> = ({ notes, loading, onAdd }) => {
  const count = notes.filter((n) => !!n.ordonnateur).length;

  return (
    <Panel
      title="Ordonnateur"
      subtitle={
        loading
          ? 'Chargement…'
          : `${count} ordonnancement${count === 1 ? '' : 's'} enregistré${count === 1 ? '' : 's'}`
      }
      padding="none"
    >
      <OrdonnateurSectionTable
        notes={loading ? [] : notes}
        placeholder={
          loading ? (
            <div className="px-6 py-10 text-center text-xs text-muted">Chargement…</div>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={<Stamp className="w-5 h-5" />}
                title="Aucun ordonnancement enregistré"
                description="La partie de l'ordonnateur de chaque note de perception apparaîtra ici une fois remplie."
                actionLabel={onAdd ? "Enregistrer l'ordonnance" : undefined}
                onAction={onAdd}
              />
            </div>
          )
        }
      />
    </Panel>
  );
};
