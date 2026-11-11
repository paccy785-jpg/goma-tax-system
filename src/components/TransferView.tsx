import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Search, UserMinus, X } from 'lucide-react';
import { Business, natureCode, natureDisplay, UserRole } from '../types';
import { subscribeToBusinesses } from '../services/dbService';
import {
  MUTATION_KIND_LABELS,
  PropertyTransfer,
  subscribeToTransfers,
} from '../services/transferService';
import { Button, EmptyState, Panel, TableSkeleton } from './ui';
import { TransferModal } from './transfer/TransferModal';
import { RemoveTenantModal } from './transfer/RemoveTenantModal';

/** Column widths of the transfer history. */
const COLS = {
  date: 'w-[11%]',
  propriete: 'w-[35%]',
  from: 'w-[20%]',
  to: 'w-[22%]',
  kind: 'w-[12%]',
} as const;

const HEADERS: { key: keyof typeof COLS; label: string; right?: boolean }[] = [
  { key: 'date', label: 'Date' },
  { key: 'propriete', label: 'Propriété' },
  { key: 'from', label: 'Ancien propriétaire' },
  { key: 'to', label: 'Nouveau propriétaire' },
  { key: 'kind', label: 'Mutation' },
];

const pad = (i: number, last: number) => (i === 0 ? 'pl-6 pr-3' : i === last ? 'pl-3 pr-6' : 'px-3');

const address = (t: PropertyTransfer) =>
  [
    t.villeTerritoire,
    t.communeChefferie,
    t.quartierGroupement,
    t.avenueLocalite,
    t.numeroParcelle ? `Parcelle ${t.numeroParcelle}` : '',
  ]
    .filter(Boolean)
    .join(', ');

export const TransferView: React.FC<{ userRole: UserRole }> = ({ userRole }) => {
  const canTransfer = userRole === 'Admin' || userRole === 'Supervisor';

  const [taxpayers, setTaxpayers] = useState<Business[]>([]);
  const [transfers, setTransfers] = useState<PropertyTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [q, setQ] = useState('');
  const close = useCallback(() => setOpen(false), []);
  const closeRemove = useCallback(() => setRemoveOpen(false), []);

  useEffect(
    () =>
      subscribeToBusinesses(
        (d) =>
          setTaxpayers(
            (d || []).slice().sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
          ),
        undefined,
        1000
      ),
    []
  );
  useEffect(
    () =>
      subscribeToTransfers(
        (d) => {
          setTransfers(d || []);
          setLoading(false);
        },
        () => setLoading(false)
      ),
    []
  );

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return transfers;
    const tokens = query.split(/\s+/);
    return transfers.filter((t) => {
      const hay = [
        t.from.name,
        t.from.nif,
        t.to.name,
        t.to.nif,
        t.reference,
        t.numeroParcelle,
        t.quartierGroupement,
        t.communeChefferie,
        t.avenueLocalite,
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tk) => hay.includes(tk));
    });
  }, [transfers, q]);

  const party = (p: { name: string; nif?: string }) => (
    <>
      <div className="text-xs font-semibold text-ink truncate" title={p.name}>
        {p.name}
      </div>
      <div className="text-[11px] text-muted truncate mt-0.5">{p.nif ? `NIF ${p.nif}` : '—'}</div>
    </>
  );

  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="relative w-full max-w-xl">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            aria-label="Rechercher un transfert"
            className="w-full h-11 pl-10 pr-10 rounded-[12px] border border-line bg-surface text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium shadow-xs"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Effacer la recherche"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {canTransfer && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="md"
              icon={<UserMinus className="w-4 h-4" />}
              onClick={() => setRemoveOpen(true)}
            >
              Retirer un locataire
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<ArrowLeftRight className="w-4 h-4" />}
              onClick={() => setOpen(true)}
            >
              Nouveau transfert
            </Button>
          </div>
        )}
      </div>

      <Panel
        title="Transferts de propriété"
        subtitle={
          loading
            ? 'Chargement de l’historique…'
            : q.trim()
              ? `${shown.length} sur ${transfers.length} transfert${transfers.length === 1 ? '' : 's'}`
              : `${transfers.length} transfert${transfers.length === 1 ? '' : 's'} enregistré${transfers.length === 1 ? '' : 's'}`
        }
        padding="none"
      >
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : transfers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ArrowLeftRight className="w-5 h-5" />}
              title="Aucun transfert enregistré"
              description="Quand une propriété déclarée est vendue, donnée ou héritée, transférez-la ici au nouveau propriétaire : sa déclaration passe à son nom et le transfert reste dans cet historique."
              actionLabel={canTransfer ? 'Nouveau transfert' : undefined}
              onAction={canTransfer ? () => setOpen(true) : undefined}
            />
          </div>
        ) : shown.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Search className="w-5 h-5" />}
              title="Aucun transfert ne correspond"
              description={`Aucun transfert pour « ${q.trim()} ».`}
              actionLabel="Effacer la recherche"
              onAction={() => setQ('')}
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="premium-table w-full table-fixed text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-line bg-surface2/50">
                  {HEADERS.map((h, i) => (
                    <th
                      key={h.key}
                      scope="col"
                      className={`${COLS[h.key]} ${pad(i, HEADERS.length - 1)} py-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint ${
                        h.right ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((t) => (
                  <tr key={t.id} className="hover:bg-surface2/30 transition-premium align-middle">
                    <td className={`${pad(0, 4)} py-3.5`}>
                      <span className="text-xs font-mono text-ink tabular-nums whitespace-nowrap">
                        {t.dateMutation.split('-').reverse().join('/')}
                      </span>
                    </td>
                    <td className={`${pad(1, 4)} py-3.5`}>
                      <div className="flex items-center gap-2 min-w-0" title={`${natureDisplay(t.nature)} — ${address(t)}`}>
                        <span className="font-mono text-[12px] font-bold text-accent shrink-0">
                          {t.nature ? natureCode(t.nature) : '—'}
                        </span>
                        <span className="text-xs text-ink truncate">{address(t) || '—'}</span>
                      </div>
                      {t.leasesTransferred > 0 && (
                        <div className="text-[11px] text-muted mt-0.5">
                          {t.leasesTransferred} bail{t.leasesTransferred === 1 ? '' : 'x'} transféré
                          {t.leasesTransferred === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>
                    <td className={`${pad(2, 4)} py-3.5`}>{party(t.from)}</td>
                    <td className={`${pad(3, 4)} py-3.5`}>
                      <div className="flex items-start gap-1.5 min-w-0">
                        <ArrowRight className="w-3 h-3 text-accent shrink-0 mt-0.5" />
                        <div className="min-w-0">{party(t.to)}</div>
                      </div>
                    </td>
                    <td className={`${pad(4, 4)} py-3.5`}>
                      <span className="inline-block px-1.5 py-0.5 rounded-[6px] bg-surface2 text-[12px] font-semibold text-ink">
                        {MUTATION_KIND_LABELS[t.kind] || t.kind}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {!canTransfer && (
        <p className="text-[12px] text-faint mt-4">Votre rôle consulte l’historique des transferts en lecture seule.</p>
      )}

      {canTransfer && <TransferModal isOpen={open} onClose={close} taxpayers={taxpayers} />}
      {canTransfer && <RemoveTenantModal isOpen={removeOpen} onClose={closeRemove} />}
    </>
  );
};
