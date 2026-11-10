import React, { useState, useMemo, useEffect } from 'react';
import { 
  Sparkles, 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Building2, 
  Loader2, 
  FileCheck2,
  DollarSign
} from 'lucide-react';
import { Business, Assessment, TaxRate, UserRole, SECTOR_LABELS, SIZE_CLASS_LABELS } from '../../types';
import { 
  generateBulkAnnualAssessments, 
  BulkAssessmentResult, 
  calculateProratedAssessment,
  DEFAULT_PATENTE_RATES 
} from '../../services/dbService';
import { formatMoney } from '../../utils/money';

interface BulkAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
  businesses: Business[];
  existingAssessments: Assessment[];
  activeRates: TaxRate[];
  currentUser: { uid: string; displayName: string; role: UserRole };
}

export const BulkAssessmentModal: React.FC<BulkAssessmentModalProps> = ({
  isOpen,
  onClose,
  onCompleted,
  businesses,
  existingAssessments,
  activeRates,
  currentUser,
}) => {
  const currentYear = new Date().getFullYear();
  const [targetYear, setTargetYear] = useState<number>(currentYear + 1); // Defaults to next year, e.g. 2027
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<BulkAssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset on open. Like the cancel modal, this one stays mounted while closed
  // (it renders `null`), so its state outlives every closing. Without this the
  // modal reopened after a run still showed the PREVIOUS run's result panel —
  // its created/skipped counts and its fiscal year — which reads as the outcome
  // of the run the operator is about to launch, and a stale error from an
  // earlier failed attempt stayed on screen next to a form that had not been
  // submitted yet.
  //
  // `targetYear` is deliberately NOT reset: it is an input the operator chose,
  // and keeping their last choice is the friendly default, not stale state.
  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    setIsProcessing(false);
  }, [isOpen]);

  // Filter only active businesses
  const activeBusinesses = useMemo(() => {
    return businesses.filter((b) => b.status === 'Active' || (b.status as string) === 'actif');
  }, [businesses]);

  // Determine which businesses already have an assessment for the target year
  const { alreadyAssessed, toAssess } = useMemo(() => {
    const assessedIds = new Set<string>();
    existingAssessments
      .filter((a) => a.fiscalYear === targetYear && a.status !== 'Cancelled' && (a.status as string)?.toLowerCase() !== 'annul\u00E9e')
      .forEach((a) => {
        if (a.businessId) assessedIds.add(a.businessId);
        if (a.taxpayerId) assessedIds.add(a.taxpayerId);
      });

    const already: Business[] = [];
    const eligible: Business[] = [];

    activeBusinesses.forEach((b) => {
      if (assessedIds.has(b.id)) {
        already.push(b);
      } else {
        eligible.push(b);
      }
    });

    return { alreadyAssessed: already, toAssess: eligible };
  }, [activeBusinesses, existingAssessments, targetYear]);

  // Projected billing calculation
  const { totalEstimatedUSD } = useMemo(() => {
    let usd = 0;
    for (const b of toAssess) {
      const rate = activeRates.find(
        (r) => r.activitySector === b.activitySector && r.sizeClass === b.sizeClass
      ) || DEFAULT_PATENTE_RATES.find(
        (r) => r.activitySector === b.activitySector && r.sizeClass === b.sizeClass
      ) || activeRates.find(
        (r) => r.activitySector === 'Other' && r.sizeClass === b.sizeClass
      ) || DEFAULT_PATENTE_RATES.find(
        (r) => r.activitySector === 'Other' && r.sizeClass === b.sizeClass
      );
      const baseFee = rate ? rate.annualFeeUSD : 100;
      const proration = calculateProratedAssessment(
        baseFee,
        b.registrationDate,
        targetYear
      );
      usd += proration.amountDueUSD;
    }
    return {
      totalEstimatedUSD: usd,
    };
  }, [toAssess, activeRates, targetYear]);

  if (!isOpen) return null;

  const handleLaunchBulkGeneration = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const res = await generateBulkAnnualAssessments(targetYear, currentUser);
      setResult(res);
      onCompleted();
    } catch (err: unknown) {
      console.error('[Bulk Assessment] Error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during bulk generation.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl my-8 overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-5 bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Generate Annual Assessments</h3>
              <p className="text-xs text-slate-300">
                Bulk issuance of business license tax notices for all active businesses
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">

          {/* Success state */}
          {result ? (
            <div className="space-y-5 text-center py-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">
                  Annual Assessments Successfully Generated!
                </h4>
                <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
                  Tax assessment notices for fiscal year <strong className="font-bold text-slate-900">{result.targetYear}</strong> have been created and recorded in the official revenue registry.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 text-left">
                <div>
                  <div className="text-[12px] text-slate-500 uppercase font-semibold">Assessments Created</div>
                  <div className="text-xl font-mono font-bold text-emerald-700">{result.createdCount}</div>
                  <div className="text-[11px] text-slate-400">Active businesses billed</div>
                </div>
                <div>
                  <div className="text-[12px] text-slate-500 uppercase font-semibold">Skipped (Already Issued)</div>
                  <div className="text-xl font-mono font-bold text-slate-600">{result.skippedAlreadyAssessed}</div>
                  <div className="text-[11px] text-slate-400">No duplicates generated</div>
                </div>
                <div>
                  <div className="text-[12px] text-slate-500 uppercase font-semibold">Total Amount Billed</div>
                  <div className="text-xl font-mono font-bold text-slate-900">{formatMoney(result.totalBilledUSD)}</div>
                </div>
              </div>

              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs"
                >
                  Close and View Assessments List
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Form & Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    Target Fiscal Year *
                  </label>
                  <select
                    id="bulk-target-year-select"
                    value={targetYear}
                    onChange={(e) => setTargetYear(Number(e.target.value))}
                    disabled={isProcessing}
                    className="w-full px-3 py-2 text-xs font-bold font-mono rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-hidden focus:border-slate-800"
                  >
                    <option value={currentYear + 1}>Fiscal Year {currentYear + 1} (Upcoming Year)</option>
                    <option value={currentYear}>Fiscal Year {currentYear} (Current Year)</option>
                    <option value={currentYear - 1}>Fiscal Year {currentYear - 1} (Prior Year)</option>
                  </select>
                </div>

                <div className="sm:col-span-2 flex flex-col justify-center">
                  <div className="text-xs text-slate-600">
                    Statutory payment deadline: <strong className="text-slate-900 font-mono">March 31, {targetYear}</strong>.
                  </div>
                  <div className="text-[12px] text-slate-500 mt-0.5">
                    Each notice will be assigned a unique sequential number (<span className="font-mono text-slate-700">PAT-{targetYear}-XXXXX</span>) and the active rate corresponding to the business sector and category.
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
                  <div className="text-[12px] font-semibold text-slate-500 uppercase">Active Businesses</div>
                  <div className="text-2xl font-mono font-bold text-slate-900 mt-1">{activeBusinesses.length}</div>
                  <div className="text-[12px] text-slate-500 mt-0.5">Registered in Goma database</div>
                </div>

                <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 shadow-xs">
                  <div className="text-[12px] font-semibold text-amber-800 uppercase">Already Assessed (Skipped)</div>
                  <div className="text-2xl font-mono font-bold text-amber-900 mt-1">{alreadyAssessed.length}</div>
                  <div className="text-[12px] text-amber-700 mt-0.5">Existing notice for {targetYear}</div>
                </div>

                <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 shadow-xs">
                  <div className="text-[12px] font-semibold text-emerald-800 uppercase">To Generate Now</div>
                  <div className="text-2xl font-mono font-bold text-emerald-900 mt-1">{toAssess.length}</div>
                  <div className="text-[12px] text-emerald-700 mt-0.5">New invoices</div>
                </div>
              </div>

              {/* Financial Projection */}
              <div className="p-4 rounded-xl bg-linear-to-r from-slate-900 to-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-300">Total Projected Revenue ({targetYear}):</div>
                  <div className="text-2xl font-mono font-bold text-emerald-400">
                    {formatMoney(totalEstimatedUSD)}
                  </div>
                </div>
              </div>

              {/* Eligible Businesses Preview Table */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
                  <span>Preview of businesses to assess ({toAssess.length}):</span>
                  <span className="text-[12px] font-normal text-slate-500">
                    Applicable active rate schedule
                  </span>
                </div>

                {toAssess.length === 0 ? (
                  <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
                    All active businesses already have an assessment notice for fiscal year {targetYear}. No new assessments required.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                    {toAssess.map((b) => {
                      const rate = activeRates.find(
                        (r) => r.activitySector === b.activitySector && r.sizeClass === b.sizeClass
                      ) || DEFAULT_PATENTE_RATES.find(
                        (r) => r.activitySector === b.activitySector && r.sizeClass === b.sizeClass
                      ) || activeRates.find(
                        (r) => r.activitySector === 'Other' && r.sizeClass === b.sizeClass
                      ) || DEFAULT_PATENTE_RATES.find(
                        (r) => r.activitySector === 'Other' && r.sizeClass === b.sizeClass
                      );
                      const baseFee = rate ? rate.annualFeeUSD : 100;
                      // Render the PRORATED amount the officer will actually be
                      // billed, so the rows add up to the projected total
                      // printed directly above them.
                      const proration = calculateProratedAssessment(
                        baseFee,
                        b.registrationDate,
                        targetYear
                      );
                      return (
                        <div key={b.id} className="p-2.5 px-3 flex items-center justify-between hover:bg-slate-50">
                          <div>
                            <div className="font-semibold text-slate-900">{b.businessName}</div>
                            <div className="text-[12px] text-slate-500">
                              {b.commune} • {SECTOR_LABELS[b.activitySector] || b.activitySector} ({SIZE_CLASS_LABELS[b.sizeClass]?.label || b.sizeClass})
                              {proration.isProrated && ` • prorated ${proration.proratedMonths}/12`}
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="font-bold text-slate-900">{formatMoney(proration.amountDueUSD)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Rule note */}
              <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-blue-900 text-[12px] leading-relaxed">
                <strong>Fiscal Security Rule:</strong> The operation is idempotent and maintains full traceability. Businesses that already have an assessment notice for {targetYear} are not duplicated. Every issuance is recorded in the official audit log.
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isProcessing}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  id="confirm-bulk-assessment-btn"
                  type="button"
                  onClick={handleLaunchBulkGeneration}
                  disabled={isProcessing || toAssess.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition-colors"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating ({toAssess.length} businesses)...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate {toAssess.length} Assessment(s) ({targetYear})
                    </>
                  )}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};
