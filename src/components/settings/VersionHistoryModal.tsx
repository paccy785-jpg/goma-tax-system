import React from 'react';
import { History, X, Calendar, ArrowRight } from 'lucide-react';

/**
 * One entry on a rate's version timeline.
 *
 * Both the patente schedule and the heads of tax are versioned the same way,
 * so the two are mapped into this shape and rendered by one shared view rather
 * than two near-identical timelines that drift apart.
 */
export interface VersionTimelineEntry {
  id: string;
  version: number;
  isActive: boolean;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  legalBasis?: string;
  notes?: string;
  createdByName?: string;
  /** Headline figure — "$300 USD" or "15%". */
  amountPrimary: string;
  /** Supporting figure — the taxable base or a secondary amount. */
  amountSecondary?: string;
}

interface VersionHistoryModalProps {
  /** What the trail belongs to, e.g. "Commerce • Small Business" or "IF — 15%". */
  title: string;
  /** Explains the basis of the figures on this particular trail. */
  subtitle?: string;
  entries: VersionTimelineEntry[];
  loading?: boolean;
  onClose: () => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  title,
  subtitle,
  entries,
  loading = false,
  onClose,
}) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs">
    <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3 bg-surface">
        <div className="min-w-0 flex items-center gap-2.5">
          <History className="w-5 h-5 text-accent shrink-0" />
          <div className="min-w-0">
            <h3 className="font-display text-sm font-bold text-ink tracking-tight">
              Rate Version History
            </h3>
            <p className="text-[12px] text-muted truncate">{title}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          {subtitle ||
            'Complete audit trail of rate changes. Each change closes the previous version with an end date rather than overwriting it, and notices already issued keep the figure they were billed at.'}
        </p>

        {loading ? (
          <div className="py-8 text-center text-xs text-muted">Loading version history…</div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted">No recorded versions.</div>
        ) : (
          <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-line">
            {entries.map((h) => (
              <div
                key={h.id}
                className={`relative pl-8 p-4 rounded-[14px] border transition-premium ${
                  h.isActive
                    ? 'bg-sage/10 border-sage/40 ring-1 ring-sage/30'
                    : 'bg-surface2/50 border-line text-muted'
                }`}
              >
                {/* Timeline dot */}
                <div
                  className={`absolute left-2.5 top-5 -translate-x-1/2 w-3 h-3 rounded-full border-2 bg-surface ${
                    h.isActive ? 'border-sage bg-sage' : 'border-line'
                  }`}
                />

                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-[6px] text-[11px] font-bold font-mono ${
                        h.isActive ? 'bg-sage/20 text-sage' : 'bg-surface2 text-muted'
                      }`}
                    >
                      Version {h.version}
                    </span>
                    {h.isActive ? (
                      <span className="text-[11px] font-bold text-sage uppercase tracking-wide">
                        ● Currently in effect
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-faint uppercase tracking-wide">
                        Archived
                      </span>
                    )}
                  </div>

                  <div className="text-right font-mono shrink-0">
                    <span className="text-base font-bold text-ink tabular-nums">
                      {h.amountPrimary}
                    </span>
                    {h.amountSecondary && (
                      <span className="block text-[11px] text-muted tabular-nums">
                        {h.amountSecondary}
                      </span>
                    )}
                  </div>
                </div>

                {/* Date interval */}
                <div className="mt-2 text-xs flex items-center gap-2 text-muted font-mono">
                  <Calendar className="w-3.5 h-3.5 text-faint shrink-0" />
                  <span>From {h.effectiveStartDate}</span>
                  <ArrowRight className="w-3 h-3 text-faint shrink-0" />
                  <span>{h.effectiveEndDate ? `To ${h.effectiveEndDate}` : 'Current (ongoing)'}</span>
                </div>

                {/* Legal decree & creator */}
                <div className="mt-2 pt-2 border-t border-line text-[12px] text-muted flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="truncate">Ref: {h.legalBasis || 'DPRNK Decree'}</span>
                  <span className="font-mono text-[11px] shrink-0">
                    By: {h.createdByName || 'Admin'}
                  </span>
                </div>

                {h.notes && <p className="mt-1 text-[12px] text-muted italic">« {h.notes} »</p>}
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-line flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-[10px] bg-navy text-white hover:bg-navy2 transition-premium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
);
