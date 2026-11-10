import React, { useState } from 'react';
import { 
  AlertOctagon, 
  X, 
  Loader2, 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  CheckCircle2, 
  Building2 
} from 'lucide-react';
import { BusinessLicenseCertificate, UserRole, ApprovalRequest } from '../types';
import { submitApprovalRequest } from '../services/approvalService';

interface RequestRevocationModalProps {
  certificate: BusinessLicenseCertificate | null;
  onClose: () => void;
  onSubmitted: (newRequest: ApprovalRequest) => void;
  currentUser: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
}

export const RequestRevocationModal: React.FC<RequestRevocationModalProps> = ({
  certificate,
  onClose,
  onSubmitted,
  currentUser,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('fraude');
  const [justification, setJustification] = useState<string>('');
  const [inspectionRef, setInspectionRef] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!certificate) return null;

  const CATEGORY_PRESETS: { [key: string]: string } = {
    fraude: 'Verified fraud or deliberate misrepresentation of assessment basis (surface area, business category, hidden turnover)',
    fermeture: 'Definitive cessation of commercial operations or clandestine closure verified on-site by field inspectors',
    usage_illicite: 'Unlawful transfer or unauthorized usage of business license certificate by an unregistered third party',
    defaut_fiscal: 'Severe reiterated non-compliance with municipal orders or engagement in prohibited commercial activities',
    autre: 'Other statutory public order grounds or major fiscal dispute',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!justification.trim() || justification.trim().length < 15) {
      setError('Please provide a detailed justification (minimum 15 characters).');
      return;
    }

    setSubmitting(true);
    setError(null);

    const fullJustification = `[Category: ${CATEGORY_PRESETS[selectedCategory] || selectedCategory}] ${justification.trim()}${inspectionRef ? ` (Inspection Report Ref: ${inspectionRef.trim()})` : ''}`;

    try {
      const request = await submitApprovalRequest({
        requestType: 'certificate_revocation',
        entityType: 'Certificate',
        entityId: certificate.id,
        entityTitle: `License Cert #${certificate.certificateNumber} (${certificate.businessName})`,
        requester: currentUser,
        justification: fullJustification,
        beforeValue: {
          status: certificate.status,
          certificateNumber: certificate.certificateNumber,
          taxYearCovered: certificate.taxYearCovered,
          businessName: certificate.businessName,
          ownerName: certificate.ownerName,
        },
        afterValue: {
          status: 'Revoked',
          revocationReason: fullJustification,
          inspectionRef: inspectionRef.trim() || undefined,
        },
        targetDetails: {
          certificateNumber: certificate.certificateNumber,
          businessName: certificate.businessName,
          ownerName: certificate.ownerName,
          businessRegistrationNumber: certificate.businessRegistrationNumber,
          commune: certificate.commune,
          quartier: certificate.quartier,
          activitySector: certificate.activitySector,
          sizeClass: certificate.sizeClass,
          taxYearCovered: certificate.taxYearCovered,
          amountPaidUSD: certificate.amountPaidUSD,
        },
      });

      onSubmitted(request);
    } catch (err: any) {
      setError(err?.message || 'Error submitting revocation request.');
      setSubmitting(false);
    }
  };

  return (
    <div 
      id="revocation-modal-backdrop"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div 
        id="revocation-modal-card"
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-rose-50 border-b border-rose-200">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-700 border border-rose-200">
              <AlertOctagon className="w-5 h-5 text-rose-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-950">
                Business License Revocation Request
              </h3>
              <p className="text-xs text-rose-700">
                Maker-Checker Internal Control (Dual Authorization)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Certificate Summary */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div className="flex items-center justify-between text-slate-500 font-mono text-[12px] mb-1">
              <span>TARGET CERTIFICATE</span>
              <span className="font-bold text-slate-900">{certificate.certificateNumber}</span>
            </div>
            <div className="font-bold text-slate-900 text-sm">{certificate.businessName}</div>
            <div className="text-slate-600 mt-0.5">
              Owner / Taxpayer: {certificate.ownerName} • Fiscal Year: {certificate.taxYearCovered}
            </div>
          </div>

          {/* Maker-Checker Safeguard Banner */}
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">Mandatory Maker-Checker Governance</p>
              <p className="text-[12px] text-amber-800 leading-relaxed">
                Revoking an official business license is a sensitive legal act. Your submission will enter the Maker-Checker queue and require sign-off by a <strong>distinct Supervisor or Administrator</strong> before taking legal effect.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Reason Category Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Revocation Grounds Category *
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 bg-white"
            >
              <option value="fraude">Tax basis fraud or deliberate tariff category under-declaration</option>
              <option value="fermeture">Cessation of operations / Abandoned premises</option>
              <option value="usage_illicite">Unlawful license transfer or assignment to third party</option>
              <option value="defaut_fiscal">Prohibited commercial activity or severe regulatory breach</option>
              <option value="autre">Other regulatory or administrative grounds</option>
            </select>
          </div>

          {/* PV / Inspection Reference */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Inspection Report / Field Violation Notice Ref (Optional)
            </label>
            <input
              type="text"
              value={inspectionRef}
              onChange={(e) => setInspectionRef(e.target.value)}
              placeholder="e.g. RPT-INSPECTION-2026-041"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 bg-white"
            />
          </div>

          {/* Justification Textarea */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Detailed Regulatory Justification *
            </label>
            <textarea
              rows={3}
              required
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Describe observed field findings, dates of inspections, and statutory basis for revocation..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 bg-white"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              This justification will be immutably recorded in the audit trail and examined by the authorizing Checker.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !justification.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>Submit to Maker-Checker Queue</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
