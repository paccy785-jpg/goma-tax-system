import React from 'react';
import { 
  FileText, 
  X, 
  Printer, 
  Building2, 
  Calendar, 
  QrCode, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { Assessment, SECTOR_LABELS, SIZE_CLASS_LABELS } from '../../types';
import { assessmentTaxLabel } from '../../services/taxTypeService';
import { BRAND } from '../../branding';
import { localDateFromIsoTimestamp } from '../../utils/date';
import { formatMoney } from '../../utils/money';

interface AssessmentNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  assessment: Assessment | null;
}

export const AssessmentNoticeModal: React.FC<AssessmentNoticeModalProps> = ({
  isOpen,
  onClose,
  assessment,
}) => {
  if (!isOpen || !assessment) return null;

  /**
   * A percentage head of tax (IF, IRL) is computed as rate × declared base, so
   * the notice prints that arithmetic instead of the sector/size tariff and
   * the pro-rata rule, which only apply to the flat annual Business License
   * Tax. `taxTypeCode` is absent on legacy records — those are patente.
   */
  const isPercentageTax = !!assessment.taxTypeCode && assessment.taxTypeCode !== 'PATENTE';
  const taxServiceLine = isPercentageTax
    ? `${assessment.taxTypeCode} — Declaration & Property Tax Service`
    : 'Business License Tax Service';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl my-8 overflow-hidden print:m-0 print:border-none print:shadow-none">
        
        {/* Top Control Bar (hidden during print) */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-sm">
              Official Assessment Notice — {assessment.assessmentNumber || assessment.noticeNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print Notice
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Notice Paper */}
        <div className="p-8 space-y-6 text-slate-900 font-sans">
          
          {/* Header */}
          <div className="border-b-2 border-slate-900 pb-5 text-center relative">
            <div className="text-[12px] font-bold uppercase tracking-wider text-slate-600">
              Democratic Republic of the Congo • North Kivu Province
            </div>
            <div className="text-xs font-semibold text-amber-800 mt-1">
              {BRAND.docAuthority} • {taxServiceLine}
            </div>

            <div className="mt-4 p-2 bg-slate-100 rounded-lg inline-block border border-slate-300">
              <div className="text-base font-black tracking-tight text-slate-900">
                {isPercentageTax
                  ? `COLLECTION NOTICE / ${assessment.taxTypeCode} DECLARATION`
                  : 'COLLECTION NOTICE / BUSINESS LICENSE TAX ASSESSMENT'}
              </div>
              <div className="text-xs font-mono font-bold text-slate-700">
                REFERENCE NO.: {assessment.assessmentNumber || assessment.noticeNumber}
              </div>
            </div>
          </div>

          {/* Business & Taxpayer Information */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div>
              <div className="text-[11px] uppercase font-bold text-slate-400">Taxpayer / Business:</div>
              <div className="text-sm font-black text-slate-900 mt-0.5">
                {assessment.businessName || assessment.taxpayerName}
              </div>
              {assessment.ownerFullName && (
                <div className="text-slate-600 mt-0.5">
                  Owner / Manager: <span className="font-semibold text-slate-800">{assessment.ownerFullName}</span>
                </div>
              )}
              <div className="text-slate-600 mt-0.5 font-mono">
                Nat ID: <span className="font-semibold text-slate-800">{assessment.nationalIdOrRccm || 'Not specified'}</span>
              </div>
            </div>

            <div className="border-l border-slate-200 pl-4">
              <div className="text-[11px] uppercase font-bold text-slate-400">Location & Establishment:</div>
              <div className="text-slate-800 mt-0.5">
                Municipality: <span className="font-bold text-slate-900">{assessment.commune || 'Goma'}</span>
              </div>
              {assessment.quartier && (
                <div className="text-slate-600 mt-0.5">
                  Quartier: <span className="font-medium text-slate-800">{assessment.quartier}</span>
                </div>
              )}
              <div className="text-slate-600 mt-0.5">
                Registration Date: <span className="font-mono font-bold text-slate-800">{assessment.registrationDate || 'Prior Year'}</span>
              </div>
            </div>
          </div>

          {/* Tariff Schedule & Proration Details */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase text-slate-700 border-b border-slate-200 pb-1">
              Tax Base Elements & Assessment Computation
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <div className="text-[11px] text-slate-500 uppercase font-semibold">
                  {isPercentageTax ? 'Head of Tax' : 'Activity Sector'}
                </div>
                <div className="font-bold text-slate-900 mt-0.5 capitalize">
                  {isPercentageTax
                    ? assessmentTaxLabel(assessment)
                    : assessment.activitySector
                      ? SECTOR_LABELS[assessment.activitySector]
                      : 'General Retail'}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <div className="text-[11px] text-slate-500 uppercase font-semibold">
                  {isPercentageTax ? 'Rate Applied' : 'Size Category'}
                </div>
                <div className="font-bold text-slate-900 mt-0.5 capitalize">
                  {isPercentageTax
                    ? `${assessment.taxRatePercent}%`
                    : assessment.sizeClass
                      ? SIZE_CLASS_LABELS[assessment.sizeClass]?.label || assessment.sizeClass
                      : 'Small'}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <div className="text-[11px] text-slate-500 uppercase font-semibold">
                  {isPercentageTax ? 'Declared Base' : 'Fiscal Year'}
                </div>
                <div className="font-bold font-mono text-slate-900 mt-0.5">
                  {isPercentageTax
                    ? `${formatMoney((assessment.taxableBaseUSD || 0))}`
                    : `Year ${assessment.fiscalYear}`}
                </div>
              </div>
            </div>

            {/* Percentage computation, for the declared-base heads of tax */}
            {isPercentageTax ? (
              <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  Percentage Tax on Declared Base
                </div>
                <p className="text-[12px] text-amber-900 leading-relaxed">
                  Assessed on the {assessment.taxableBaseLabel || 'declared base'} at the rate in
                  force for fiscal year {assessment.fiscalYear}
                  {assessment.parcelRang ? `, parcel rang ${assessment.parcelRang}` : ''}.
                </p>
                <div className="text-[12px] font-mono text-amber-950 pt-1">
                  Formula: {assessment.taxRatePercent}% ×{' '}
                  {formatMoney((assessment.taxableBaseUSD || 0))} ={' '}
                  <strong>{formatMoney(assessment.amountDueUSD)}</strong>
                </div>
              </div>
            ) : assessment.isProrated ? (
              <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <Clock className="w-4 h-4 text-amber-700" />
                  Legal Prorata Temporis Rule Applied ({assessment.proratedMonths}/12 months)
                </div>
                <p className="text-[12px] text-amber-900 leading-relaxed">
                  {assessment.proratedNotes || `Registration during fiscal year. Billed proportionally to ${assessment.proratedMonths} active months through December 31.`}
                </p>
                <div className="text-[12px] font-mono text-amber-950 pt-1">
                  Formula: ({formatMoney(assessment.baseAnnualFeeUSD)} × {assessment.proratedMonths}) ÷ 12 = <strong>{formatMoney(assessment.amountDueUSD)}</strong>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
                <span>Full Annual Rate (12 full months of operations):</span>
                <span className="font-mono font-bold text-slate-900">{formatMoney(assessment.baseAnnualFeeUSD || assessment.amountDueUSD)}</span>
              </div>
            )}
          </div>

          {/* Amount Due Big Banner */}
          <div className="p-5 rounded-2xl bg-linear-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-300 uppercase tracking-wider font-semibold">
                Net Payable Amount
              </div>
              <div className="text-3xl font-mono font-black text-amber-400 mt-1">
                {formatMoney(assessment.amountDueUSD)}
              </div>
            </div>

            <div className="text-right">
              <div className="text-[12px] text-slate-400 uppercase font-semibold">Payment Due Date</div>
              <div className="text-base font-mono font-bold text-rose-300 mt-0.5">
                {assessment.dueDate}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Late penalties apply after due date.
              </div>
            </div>
          </div>

          {/* Status & Validation Signatures */}
          <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-200 text-xs">
            <div>
              <div className="text-[11px] uppercase font-bold text-slate-400">Assessment Status:</div>
              <div className="mt-1 font-bold text-slate-900 capitalize">
                Status: {assessment.status}
              </div>
              <div className="text-[12px] text-slate-500 mt-1">
                Issued by: {assessment.assessedByName || 'License Tax Service'} on {assessment.issueDate || localDateFromIsoTimestamp(assessment.createdAt)}
              </div>
              {assessment.cancelledByName && (
                <div className="mt-2 p-2 rounded bg-rose-50 border border-rose-200 text-rose-900 text-[11px]">
                  <strong>Cancelled by:</strong> {assessment.cancelledByName}<br />
                  <strong>Reason:</strong> {assessment.cancellationReason}
                </div>
              )}
            </div>

            <div className="text-right">
              <div className="text-[11px] uppercase font-bold text-slate-400">Seal & Authorizing Officer Visa:</div>
              <div className="h-16 flex items-center justify-end">
                <div className="w-24 h-12 border border-dashed border-slate-300 rounded flex items-center justify-center text-[10px] text-slate-400 uppercase font-mono">
                  Official Seal
                </div>
              </div>
              <div className="text-[11px] text-slate-400">{BRAND.docAuthority}</div>
            </div>
          </div>

          {/* Payment Notice Footer */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[12px] text-slate-500 leading-relaxed">
            <strong>Payment Instructions:</strong> Payment must be settled exclusively at {BRAND.shortName} counters, via Mobile Money (Airtel Money, Orange Money), or by bank transfer (Rawbank RDC, Equity BCDC). An official sealed receipt is issued immediately upon receipt of payment.
          </div>

        </div>

      </div>
    </div>
  );
};
