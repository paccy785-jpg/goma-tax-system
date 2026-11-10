import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Plus,
  Percent,
  Save,
  AlertTriangle,
  ShieldCheck,
  ArrowLeft,
  Pencil,
  Ban,
  Lock,
  History,
} from 'lucide-react';
import {
  TaxType,
  TaxBaseKind,
  TaxTypeRateVersion,
  TAX_BASE_KIND_LABELS,
  isPercentageTaxType,
} from '../../types';
import { saveTaxType, getTaxTypeRateHistory } from '../../services/taxTypeService';
import { Badge, Button } from '../ui';
import {
  VersionHistoryModal,
  type VersionTimelineEntry,
} from './VersionHistoryModal';

interface TaxTypesModalProps {
  /** Current registry, as loaded by the settings screen. */
  taxTypes: TaxType[];
  /** Display name of the officer making the change, for the audit trail. */
  updatedBy: string;
  onClose: () => void;
  /** Called with the saved entry so the parent can refresh its copy. */
  onSaved: (taxType: TaxType) => void;
  /** Called after a successful write, for audit logging by the parent. */
  onAudit: (taxType: TaxType, isNew: boolean) => void;
  /** Hand off to the shared "Add a Rate Version" flow for this head of tax. */
  onAddRateVersion?: (taxType: TaxType) => void;
}

/** The editable shape of a tax type. `id` is absent while creating. */
type Draft = Omit<TaxType, 'updatedAt' | 'updatedBy'> & { isNew?: boolean };

const emptyDraft = (): Draft => ({
  id: '',
  code: '',
  label: '',
  labelEn: '',
  ratePercent: 15,
  baseKind: 'declared_property_value',
  baseDescription: '',
  numberPrefix: '',
  isActive: true,
  legalBasis: '',
  notes: '',
  isNew: true,
});

const draftFrom = (taxType: TaxType): Draft => ({ ...taxType, isNew: false });

/**
 * Tax types — the heads of tax levied as a percentage of a declared base.
 *
 * This is deliberately separate from the patente tariff schedule: a percentage
 * of a declared value cannot be expressed as a flat annual fee, so the two are
 * managed apart and never mixed into one grid.
 */
export const TaxTypesModal: React.FC<TaxTypesModalProps> = ({
  taxTypes,
  updatedBy,
  onClose,
  onSaved,
  onAudit,
  onAddRateVersion,
}) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Version timeline, shown above this modal so the list stays in context.
  const [historyTaxType, setHistoryTaxType] = useState<TaxType | null>(null);
  const [historyVersions, setHistoryVersions] = useState<TaxTypeRateVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!historyTaxType) return;
    let cancelled = false;
    setHistoryLoading(true);
    getTaxTypeRateHistory(historyTaxType)
      .then((versions) => {
        if (!cancelled) setHistoryVersions(versions);
      })
      .catch((err) => console.warn('[TaxTypes] History load failed:', err))
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [historyTaxType]);

  const historyEntries: VersionTimelineEntry[] = useMemo(
    () =>
      historyVersions.map((v) => ({
        id: v.id,
        version: v.version || 1,
        isActive: v.isActive !== false,
        effectiveStartDate: v.effectiveStartDate,
        effectiveEndDate: v.effectiveEndDate,
        legalBasis: v.legalBasis,
        notes: v.notes,
        createdByName: v.createdByName,
        amountPrimary: `${v.ratePercent}%`,
        amountSecondary: TAX_BASE_KIND_LABELS[v.baseKind],
      })),
    [historyVersions]
  );

  const percentageTypes = useMemo(
    () => taxTypes.filter((t) => isPercentageTaxType(t)),
    [taxTypes]
  );

  const patch = (next: Partial<Draft>) => setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const validate = (d: Draft): string | null => {
    const code = d.code.trim().toUpperCase();
    if (!code) return 'A short code is required — it is printed on notices and receipts.';
    if (!/^[A-Z0-9]{2,6}$/.test(code)) {
      return 'The code must be 2–6 characters, letters and digits only (e.g. IF, IRL).';
    }
    const clash = taxTypes.find((t) => t.code === code && t.id !== d.id);
    if (clash) return `Code ${code} is already used by "${clash.label}".`;

    if (!d.label.trim()) return 'The official French declaration wording is required.';
    if (!d.labelEn.trim()) return 'An English working label is required.';
    if (d.baseKind === 'flat_tariff') {
      return 'A tax type managed here must be percentage-based. Tariff-based heads of tax belong to the patente schedule.';
    }
    if (!(d.ratePercent > 0) || d.ratePercent > 100) {
      return 'The rate must be greater than 0 and no more than 100 percent.';
    }
    if (!d.baseDescription.trim()) return 'Describe the taxable base so a notice can explain itself.';
    if (!/^[A-Z0-9]{1,4}$/.test(d.numberPrefix.trim().toUpperCase())) {
      return 'The number prefix must be 1–4 characters, letters and digits only (e.g. IF).';
    }
    return null;
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }

    const code = draft.code.trim().toUpperCase();
    const isNew = !!draft.isNew;
    const record: TaxType = {
      id: draft.id || `taxtype_${code.toLowerCase()}`,
      code,
      label: draft.label.trim(),
      labelEn: draft.labelEn.trim(),
      ratePercent: draft.ratePercent,
      baseKind: draft.baseKind,
      baseDescription: draft.baseDescription.trim(),
      numberPrefix: draft.numberPrefix.trim().toUpperCase(),
      isActive: draft.isActive,
      legalBasis: draft.legalBasis?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };

    setSaving(true);
    setError(null);
    try {
      await saveTaxType(record);
      onSaved(record);
      onAudit(record, isNew);
      setDraft(null);
    } catch (err) {
      console.error('[TaxTypes] Save failed:', err);
      setError('Could not save the tax type. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-surface2 border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';
  const labelClass = 'block text-[12px] font-bold uppercase tracking-wider text-muted mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs">
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0 flex items-center gap-3">
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                aria-label="Back to the list of tax types"
                className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
                {draft ? (draft.isNew ? 'New head of tax' : `Editing ${draft.code}`) : 'Tariff governance'}
              </span>
              <h2 className="font-display text-lg font-bold text-ink tracking-tight truncate">
                {draft ? (draft.isNew ? 'Add a Tax Type' : 'Edit Tax Type') : 'Tax Types'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tax types"
            className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-[12px] bg-danger/10 border border-danger/25 text-danger text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!draft && (
            <>
              <div className="p-4 rounded-[14px] bg-accent-soft/50 border border-line flex items-start gap-3">
                <Percent className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <p className="text-xs text-muted leading-relaxed">
                  A <strong className="text-ink">tax type</strong> is a head of tax levied as a
                  percentage of a figure the taxpayer declares — the value of an asset, or the rent
                  it earns. It is kept apart from the patente tariff schedule, which is a flat
                  annual fee: a percentage of a declared base must never be run through the
                  pro-rata maths that applies to an annual tariff.
                </p>
              </div>

              {percentageTypes.length === 0 ? (
                <p className="text-xs text-muted py-6 text-center">
                  No percentage-based head of tax is configured.
                </p>
              ) : (
                <div className="space-y-3">
                  {percentageTypes.map((taxType) => (
                    <div
                      key={taxType.id}
                      className={`p-4 rounded-[14px] border transition-premium ${
                        taxType.isActive
                          ? 'bg-surface border-line'
                          : 'bg-surface2/40 border-line opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-display text-sm font-bold text-ink tracking-tight">
                              {taxType.code}
                            </span>
                            <Badge variant="accent" size="sm">
                              {taxType.ratePercent}% {TAX_BASE_KIND_LABELS[taxType.baseKind]}
                            </Badge>
                            {!taxType.isActive && (
                              <Badge variant="neutral" size="sm" dot>
                                Inactive
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-semibold text-ink mt-1.5">{taxType.label}</div>
                          <div className="text-[12px] text-muted mt-0.5">{taxType.labelEn}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<History className="w-3.5 h-3.5" />}
                            onClick={() => setHistoryTaxType(taxType)}
                          >
                            History
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Pencil className="w-3.5 h-3.5" />}
                            onClick={() => {
                              setError(null);
                              setDraft(draftFrom(taxType));
                            }}
                          >
                            Edit
                          </Button>
                          {onAddRateVersion && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Plus className="w-3.5 h-3.5" />}
                              onClick={() => onAddRateVersion(taxType)}
                            >
                              New version
                            </Button>
                          )}
                        </div>
                      </div>

                      <dl className="mt-3 pt-3 border-t border-line grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
                        <div>
                          <dt className="text-muted">Taxable base</dt>
                          <dd className="text-ink font-medium">{taxType.baseDescription}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">Notice prefix</dt>
                          <dd className="text-ink font-mono">
                            {taxType.numberPrefix}-{new Date().getFullYear()}-00001
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Legal basis</dt>
                          <dd className="text-ink">{taxType.legalBasis || '—'}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted">
                  Changes take effect immediately on new notices. Notices already issued keep the
                  rate they were assessed at.
                </p>
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus className="w-4 h-4" />}
                  onClick={() => {
                    setError(null);
                    setDraft(emptyDraft());
                  }}
                >
                  Add a Tax Type
                </Button>
              </div>
            </>
          )}

          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Code *</label>
                  <input
                    type="text"
                    value={draft.code}
                    disabled={!draft.isNew}
                    onChange={(e) => patch({ code: e.target.value.toUpperCase() })}
                    placeholder="e.g. IF"
                    className={`${inputClass} font-mono uppercase disabled:opacity-60 disabled:cursor-not-allowed`}
                  />
                  <p className="text-[11px] text-muted mt-1">
                    {draft.isNew
                      ? 'Printed on notices and receipts. Cannot be changed later.'
                      : 'Codes are referenced by issued notices and cannot be changed.'}
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Rate (%) *</label>
                  {draft.isNew ? (
                    <>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={draft.ratePercent}
                        onChange={(e) => patch({ ratePercent: Number(e.target.value) })}
                        className={`${inputClass} font-mono font-bold`}
                      />
                      <p className="text-[11px] text-muted mt-1">
                        Opening rate — recorded as version 1.
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Locked on purpose: a rate change must go through the
                          versioning flow so the previous figure is closed out
                          rather than silently overwritten. */}
                      <div className="w-full px-3 py-2 bg-surface2 border border-line rounded-[10px] text-xs font-mono font-bold text-ink flex items-center justify-between">
                        <span>{draft.ratePercent}%</span>
                        <Lock className="w-3.5 h-3.5 text-muted" />
                      </div>
                      <p className="text-[11px] text-muted mt-1 leading-relaxed">
                        Rate changes are versioned — use{' '}
                        <strong className="text-ink">Add a Rate Version</strong> so the current
                        figure is closed out with an end date.
                      </p>
                    </>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Notice prefix *</label>
                  <input
                    type="text"
                    value={draft.numberPrefix}
                    onChange={(e) => patch({ numberPrefix: e.target.value.toUpperCase() })}
                    placeholder="e.g. IF"
                    className={`${inputClass} font-mono uppercase`}
                  />
                  <p className="text-[11px] text-muted mt-1">
                    Gives each head of tax its own numbering sequence.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Official French wording *</label>
                  <input
                    type="text"
                    value={draft.label}
                    onChange={(e) => patch({ label: e.target.value })}
                    placeholder="Déclaration de l'impôt foncier"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>English working label *</label>
                  <input
                    type="text"
                    value={draft.labelEn}
                    onChange={(e) => patch({ labelEn: e.target.value })}
                    placeholder="Property Tax Declaration"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Taxable base *</label>
                  <select
                    value={draft.baseKind}
                    onChange={(e) => patch({ baseKind: e.target.value as TaxBaseKind })}
                    className={inputClass}
                  >
                    <option value="declared_property_value">
                      {TAX_BASE_KIND_LABELS.declared_property_value}
                    </option>
                    <option value="annual_rental_income">
                      {TAX_BASE_KIND_LABELS.annual_rental_income}
                    </option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Base description *</label>
                  <input
                    type="text"
                    value={draft.baseDescription}
                    onChange={(e) => patch({ baseDescription: e.target.value })}
                    placeholder="Valeur déclarée du bien immobilier"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Legal basis / official decree</label>
                <input
                  type="text"
                  value={draft.legalBasis || ''}
                  onChange={(e) => patch({ legalBasis: e.target.value })}
                  placeholder="e.g. Code des impôts — Impôt foncier (IF)"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={2}
                  value={draft.notes || ''}
                  onChange={(e) => patch({ notes: e.target.value })}
                  placeholder="e.g. 15% de la valeur déclarée du bien immobilier."
                  className={inputClass}
                />
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-[12px] bg-surface2/50 border border-line cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => patch({ isActive: e.target.checked })}
                  className="w-4 h-4 accent-[oklch(57%_0.16_36)]"
                />
                <span className="text-xs text-ink font-medium">
                  Active — available when raising new notices
                </span>
                {!draft.isActive && <Ban className="w-3.5 h-3.5 text-muted ml-auto" />}
              </label>

              <div className="p-3 rounded-[12px] bg-surface2/50 border border-line text-[12px] text-muted leading-relaxed flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <span>
                  Changing a rate does not re-open notices already issued: each notice stores the
                  code and rate it was assessed at, so a reprint always shows the original liability.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {draft && (
          <div className="px-6 py-3.5 border-t border-line bg-surface2/40 flex items-center justify-end gap-2.5">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Save className="w-4 h-4" />}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Tax Type'}
            </Button>
          </div>
        )}
      </div>

      {/* Rate version timeline — same shared view the patente schedule uses */}
      {historyTaxType && (
        <VersionHistoryModal
          title={`${historyTaxType.code} — ${historyTaxType.label}`}
          subtitle={`Complete audit trail of the ${historyTaxType.code} rate, assessed on the ${historyTaxType.baseDescription.toLowerCase()}. Each change closes the previous version with an end date, and notices already issued keep the rate they were billed at.`}
          entries={historyEntries}
          loading={historyLoading}
          onClose={() => setHistoryTaxType(null)}
        />
      )}
    </div>
  );
};
