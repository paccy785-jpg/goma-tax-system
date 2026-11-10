import React, { useState, useEffect, useRef } from 'react';
import { AlertOctagon, X, Loader2, AlertTriangle, ShieldCheck, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Assessment, UserRole } from '../../types';
import { submitApprovalRequest } from '../../services/approvalService';
import { formatMoney } from '../../utils/money';

interface CancelAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancelled: () => void;
  assessment: Assessment | null;
  currentUser: { uid: string; displayName: string; role: UserRole };
}

const COMMON_CANCELLATION_REASONS = [
  'Total cessation of business activity established prior to fiscal year',
  'Material clerical error in sector or size classification',
  'Inadvertent double taxation identified for the same taxpayer',
  'Statutory tax exemption or municipal moratorium granted by official decree',
  'Formal closure from the Trade and Commercial Registry (RCCM)',
];

export const CancelAssessmentModal: React.FC<CancelAssessmentModalProps> = ({
  isOpen,
  onClose,
  onCancelled,
  assessment,
  currentUser,
}) => {
  const [reason, setReason] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null);

  // Reset on open. This modal is mounted once by its parent and stays mounted
  // while `isOpen` is false (it renders `null`), so its state survives every
  // closing. Two things went wrong because of that:
  //
  //  1. A justification typed and abandoned carried over to the NEXT
  //     assessment, so a cancellation could be filed with a reason written for
  //     a different notice.
  //  2. After a successful submission the modal reopened still showing the old
  //     "Request Submitted Successfully" panel with the old request number and
  //     a permanently disabled submit button — the new assessment could not be
  //     cancelled at all without a page reload.
  //
  // The reset runs only on the false→true transition so it cannot wipe the
  // success panel while it is being displayed.
  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setError(null);
    setSubmittedRequestId(null);
    setIsProcessing(false);
    // Keyed on the assessment as well: reopening for a different notice while
    // the modal somehow stays open must still start clean.
  }, [isOpen, assessment?.id]);

  if (!isOpen || !assessment) return null;

  const handleConfirmCancellation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide an explicit cancellation reason.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    try {
      const result = await submitApprovalRequest({
        requestType: 'assessment_cancellation',
        entityType: 'Assessment',
        entityId: assessment.id,
        entityTitle: `Notice No. ${assessment.assessmentNumber || assessment.noticeNumber || assessment.id} (${assessment.businessName || assessment.taxpayerName})`,
        beforeValue: {
          status: assessment.status,
          amountDueUSD: assessment.amountDueUSD,
          fiscalYear: assessment.fiscalYear,
        },
        afterValue: {
          status: 'Cancelled',
          cancellationReason: reason.trim(),
        },
        justification: reason.trim(),
        requester: currentUser,
        targetDetails: {
          businessName: assessment.businessName || assessment.taxpayerName,
          assessmentNumber: assessment.assessmentNumber || assessment.noticeNumber,
          commune: assessment.commune,
          quartier: assessment.quartier,
          amountUSD: assessment.amountDueUSD,
          fiscalYear: assessment.fiscalYear,
        },
      });

      setSubmittedRequestId(result.id);
      // Tracked timer: the bare 2.2s timeout fired onCancelled()/onClose() even
      // when the modal had already unmounted (navigate away, parent closes).
      submitTimerRef.current = setTimeout(() => {
        onCancelled();
        onClose();
      }, 2200);
    } catch (err: unknown) {
      console.error('[Cancel Assessment] Error submitting request:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit cancellation request.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-rose-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/20">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Cancel Tax Assessment</h3>
              <p className="text-xs text-rose-100">
                Notice No. {assessment.assessmentNumber || assessment.noticeNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleConfirmCancellation} className="p-6 space-y-4">
          
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Business:</span>
              <span className="font-bold text-slate-900">{assessment.businessName || assessment.taxpayerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Fiscal Year:</span>
              <span className="font-mono font-bold text-slate-900">{assessment.fiscalYear}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Assessed Amount:</span>
              <span className="font-mono font-bold text-rose-700">
                {formatMoney(assessment.amountDueUSD)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Current Status:</span>
              <span className="font-medium text-slate-700 capitalize">{assessment.status}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800">
              Regulatory Cancellation Justification *
            </label>
            <textarea
              id="cancellation-reason-input"
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the administrative justification for the cancellation..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            />
          </div>

          {/* Quick Suggestions */}
          <div className="space-y-1">
            <div className="text-[12px] font-semibold text-slate-500">Common reasons:</div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_CANCELLATION_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className="text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-left transition-colors"
                >
                  + {r}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {submittedRequestId ? (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-emerald-950">Request Submitted Successfully!</div>
                <div className="text-[12px] text-emerald-800 mt-0.5">
                  Request No. <span className="font-mono font-bold">{submittedRequestId}</span> has been routed to the <strong>Pending Approvals</strong> queue. A distinct Supervisor or Administrator must review before the cancellation is applied.
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[12px] leading-relaxed flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              <div>
                <strong>Maker-Checker Control Procedure:</strong> Assessment cancellation is a sensitive fiscal action. Under audit standards, your request will be queued for review and must be approved by a distinct second officer (Supervisor or Administrator).
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              id="confirm-cancel-assessment-btn"
              type="submit"
              disabled={isProcessing || !reason.trim() || !!submittedRequestId}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white shadow-xs"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <AlertOctagon className="w-4 h-4" />
                  Submit for Approval (Maker-Checker)
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
