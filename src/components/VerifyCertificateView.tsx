import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Landmark, 
  QrCode, 
  FileText, 
  Building2, 
  Calendar, 
  UserCheck, 
  AlertOctagon, 
  ShieldAlert,
  ExternalLink, 
  ArrowRight, 
  RefreshCw, 
  History, 
  Clock, 
  BadgeCheck 
} from 'lucide-react';
import { verifyCertificate } from '../services/certificateService';
import { BusinessLicenseCertificate, CertificateVerificationResult } from '../types';
import { OfficialCertificateModal } from './OfficialCertificateModal';
import { formatMoney } from '../utils/money';

interface VerifyCertificateViewProps {
  initialCertNumber?: string;
  initialBusinessName?: string;
  onViewCertificate?: (certificate: BusinessLicenseCertificate) => void;
}

interface VerificationHistoryItem {
  certificateNumber: string;
  businessName?: string;
  timestamp: string;
  isValid: boolean;
  status: string;
}

export const VerifyCertificateView: React.FC<VerifyCertificateViewProps> = ({
  initialCertNumber = '',
  initialBusinessName = '',
  onViewCertificate,
}) => {
  const [certNumber, setCertNumber] = useState<string>(initialCertNumber);
  const [businessName, setBusinessName] = useState<string>(initialBusinessName);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<CertificateVerificationResult | null>(null);
  const [activeModalCert, setActiveModalCert] = useState<BusinessLicenseCertificate | null>(null);
  const [history, setHistory] = useState<VerificationHistoryItem[]>([]);

  // Resync when navigating here with a different certificate/business pre-fill.
  useEffect(() => {
    setCertNumber(initialCertNumber || '');
    setBusinessName(initialBusinessName || '');
    setResult(null);
  }, [initialCertNumber, initialBusinessName]);

  const handleVerify = async (certQuery?: string, bizQuery?: string) => {
    const qCert = (certQuery !== undefined ? certQuery : certNumber).trim();
    const qBiz = (bizQuery !== undefined ? bizQuery : businessName).trim();

    if (!qCert) return;
    // Re-entrancy guard: the disabled verify button does not stop implicit
    // form submission via the Enter key.
    if (loading) return;

    setLoading(true);
    try {
      const res = await verifyCertificate(qCert, qBiz || undefined);
      setResult(res);

      // Add to verification history
      const historyEntry: VerificationHistoryItem = {
        certificateNumber: qCert.toUpperCase(),
        businessName: res.certificate?.businessName || qBiz || 'N/A',
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        isValid: res.isValid,
        status: res.status,
      };
      setHistory((prev) => [historyEntry, ...prev.slice(0, 7)]);
    } catch (err) {
      console.error('[VerifyCertificate error]', err);
      // Never leave a previous (possibly VALID) result on screen after a failed
      // lookup — an operator could clear a fraudulent checkpoint on stale data.
      setResult({
        isValid: false,
        status: 'NotFound',
        verificationMessage:
          'Verification service unavailable (network or database error). Retry, or contact the Urban Finance Directorate before accepting this certificate.',
        verifiedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLookup = (sampleCert: string, sampleBiz?: string) => {
    setCertNumber(sampleCert);
    if (sampleBiz) setBusinessName(sampleBiz);
    handleVerify(sampleCert, sampleBiz);
  };

  return (
    <div id="verify-certificate-view-root" className="space-y-6">
      {/* Header Banner */}
      <div 
        id="verify-cert-header"
        className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white shadow-lg border border-slate-700 relative overflow-hidden"
      >
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[12px] font-bold tracking-wide uppercase border border-emerald-500/30">
              <BadgeCheck className="w-3.5 h-3.5" />
              <span>Authenticity & Security Verification</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Business License Certificate Verification
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Verify the legal validity, issuance authenticity, and real-time status of commercial operation license certificates issued by the DPRNK.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="px-4 py-2 rounded-xl bg-white/10 backdrop-blur-xs border border-white/10 text-right">
              <div className="text-[11px] uppercase font-bold text-slate-400">Active Registry</div>
              <div className="text-xs font-mono font-bold text-emerald-400">FISCAL YEAR 2026 / DPRNK</div>
            </div>
          </div>
        </div>
      </div>

      {/* Lookup Form Card */}
      <div 
        id="verify-cert-form-card"
        className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs"
      >
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleVerify();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            {/* Certificate Number Input */}
            <div className="sm:col-span-6">
              <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-700" />
                <span>License Certificate Number *</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={certNumber}
                  onChange={(e) => setCertNumber(e.target.value)}
                  placeholder="e.g. CERT-PAT-2026-00001"
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm font-mono font-bold text-slate-900 uppercase bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:bg-white transition-all shadow-inner"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <QrCode className="w-4 h-4" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Enter the reference printed on the document or scanned from the official security QR code.
              </p>
            </div>

            {/* Optional Business Name Confirmation */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-600" />
                <span>Business Name (Optional)</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Kin-Mart Supermarket"
                className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:bg-white transition-all shadow-inner"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Cross-verification to eliminate identity substitution risk.
              </p>
            </div>

            {/* Submit Button */}
            <div className="sm:col-span-2 flex items-end">
              <button
                type="submit"
                disabled={loading || !certNumber.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Verify</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Verification Result Display */}
      {result && (
        <div 
          id="verification-result-card"
          className="rounded-2xl bg-white border border-slate-200 shadow-md overflow-hidden animate-fade-in"
        >
          {/* Status Header Strip */}
          <div className={`px-6 py-4 flex items-center justify-between gap-4 ${
            result.isValid ? 'bg-emerald-50 border-b border-emerald-200 text-emerald-950' :
            result.status === 'Expired' ? 'bg-amber-50 border-b border-amber-200 text-amber-950' :
            result.status === 'Revoked' ? 'bg-rose-50 border-b border-rose-200 text-rose-950' :
            result.status === 'Tampered' ? 'bg-red-100 border-b-2 border-red-600 text-red-950' :
            'bg-slate-100 border-b border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${
                result.isValid ? 'bg-emerald-100 text-emerald-800' :
                result.status === 'Expired' ? 'bg-amber-100 text-amber-800' :
                result.status === 'Revoked' ? 'bg-rose-100 text-rose-800' :
                result.status === 'Tampered' ? 'bg-red-600 text-white' :
                'bg-slate-200 text-slate-700'
              }`}>
                {result.isValid ? <CheckCircle2 className="w-6 h-6" /> :
                 result.status === 'Expired' ? <Clock className="w-6 h-6" /> :
                 result.status === 'Revoked' ? <AlertOctagon className="w-6 h-6" /> :
                 result.status === 'Tampered' ? <ShieldAlert className="w-6 h-6" /> :
                 <AlertTriangle className="w-6 h-6" />}
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider">
                  {result.isValid ? 'Official Certified & Valid License' :
                   result.status === 'Expired' ? 'Expired License (Not Renewed)' :
                   result.status === 'Revoked' ? 'Revoked License / Invalid' :
                   result.status === 'Tampered' ? 'Document Altered After Issuance' :
                   'License Not Found or Counterfeit'}
                </div>
                <div className="text-base font-black">
                  {/* Key the headline on isValid FIRST: a business-name
                      cross-check failure returns isValid=false with
                      status='Valid', and the old code printed
                      "VALID & AUTHENTIC" for a mismatched holder on an
                      anti-fraud screen. */}
                  {result.isValid ? 'VALID & AUTHENTIC' :
                   result.status === 'Expired' ? 'EXPIRED' :
                   result.status === 'Revoked' ? 'REVOKED' :
                   result.status === 'Tampered' ? 'DO NOT ACCEPT' : 'VERIFICATION FAILED'}
                </div>
              </div>
            </div>

            <div className="text-right text-xs font-mono text-slate-500 hidden sm:block">
              Verified on: {new Date(result.verifiedAt).toLocaleString('en-US')}
            </div>
          </div>

          {/* Result Body */}
          <div className="p-6 space-y-6">
            {/* Verification explanation message */}
            <div className={`p-4 rounded-xl text-xs leading-relaxed font-medium ${
              result.isValid ? 'bg-emerald-50/60 border border-emerald-200 text-emerald-900' :
              result.status === 'Expired' ? 'bg-amber-50/60 border border-amber-200 text-amber-900' :
              result.status === 'Revoked' ? 'bg-rose-50/60 border border-rose-200 text-rose-900' :
              result.status === 'Tampered' ? 'bg-red-50 border-2 border-red-400 text-red-950' :
              'bg-slate-50 border border-slate-200 text-slate-700'
            }`}>
              {result.verificationMessage}
            </div>

            {/* If Certificate Object Found: Full Details Breakdown */}
            {result.certificate && (
              <div className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Landmark className="w-4 h-4 text-slate-700" />
                  <span>Official Statutory Registration Details</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Business Name</span>
                    <p className="text-sm font-bold text-slate-950 mt-0.5">{result.certificate.businessName}</p>
                    {result.certificate.tradeName && result.certificate.tradeName !== result.certificate.businessName && (
                      <p className="text-[12px] text-slate-600">Trade name: {result.certificate.tradeName}</p>
                    )}
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Owner & Registry</span>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{result.certificate.ownerName}</p>
                    <p className="text-[12px] font-mono text-slate-600">Nat ID : {result.certificate.businessRegistrationNumber}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Fiscal Year & Expiry</span>
                    <p className="text-sm font-bold text-emerald-950 mt-0.5">Fiscal Year {result.certificate.taxYearCovered}</p>
                    <p className="text-[12px] text-slate-600">Expires: <strong>{result.certificate.expiryDate}</strong></p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Sector & Tax Class</span>
                    <p className="text-xs font-bold text-slate-900 capitalize mt-0.5">
                      {result.certificate.activitySector} (Class {result.certificate.sizeClass})
                    </p>
                    <p className="text-[12px] text-slate-600">
                      Commune of {result.certificate.commune}, Q. {result.certificate.quartier}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Settled License Tax</span>
                    <p className="text-xs font-bold text-emerald-900 mt-0.5">
                      {formatMoney(result.certificate.amountPaidUSD)}
                    </p>
                    <p className="text-[12px] text-slate-500 font-mono">Receipt: {result.certificate.receiptNumber || 'Settled'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Issuing Office</span>
                    <p className="text-xs font-semibold text-slate-900 mt-0.5">{result.certificate.issuingOffice}</p>
                    <p className="text-[12px] text-slate-500">Issued by {result.certificate.issuedByName}</p>
                  </div>
                </div>

                {/* Revocation Details Block (if Revoked) */}
                {result.certificate.status === 'Revoked' && (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-950 space-y-1.5">
                    <div className="font-bold flex items-center gap-2 text-rose-900">
                      <AlertOctagon className="w-4 h-4 text-rose-700" />
                      <span>Revocation ordered by Municipal Tax Administration</span>
                    </div>
                    <p className="italic">
                      Reason: "{result.certificate.revocationReason || 'Non-compliance with municipal tax obligations'}"
                    </p>
                    <div className="text-[12px] text-rose-800 flex items-center gap-3 pt-1">
                      <span>Revocation Date: {result.certificate.revokedAt ? new Date(result.certificate.revokedAt).toLocaleDateString('en-US') : 'N/A'}</span>
                      <span>Authority: {result.certificate.revokedByName || 'URD Supervisor'}</span>
                      {result.certificate.revocationRequestId && (
                        <span className="font-mono">Approval Ref: {result.certificate.revocationRequestId}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveModalCert(result.certificate!)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>View & Print Official Certificate</span>
                  </button>

                  {onViewCertificate && (
                    <button
                      type="button"
                      onClick={() => onViewCertificate(result.certificate!)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs border border-slate-300 transition-colors cursor-pointer"
                    >
                      <span>View in License Registry</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verification History Section */}
      {history.length > 0 && (
        <div 
          id="verification-history-card"
          className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Recent Verification Activity
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-[12px] text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {history.map((h) => (
              <div
                key={`${h.certificateNumber}-${h.timestamp}`} 
                className="py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 px-2 rounded-lg transition-colors cursor-pointer"
                onClick={() => handleQuickLookup(h.certificateNumber, h.businessName !== 'N/A' ? h.businessName : undefined)}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${
                    h.isValid ? 'bg-emerald-500' :
                    h.status === 'Expired' ? 'bg-amber-500' : 'bg-rose-500'
                  }`} />
                  <div>
                    <span className="font-mono font-bold text-slate-900">{h.certificateNumber}</span>
                    <span className="text-slate-500 ml-2">— {h.businessName}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    h.isValid ? 'bg-emerald-100 text-emerald-800' :
                    h.status === 'Expired' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {h.isValid ? 'VALID' : h.status === 'Expired' ? 'EXPIRED' : 'REVOKED / ANOMALY'}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">{h.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Official Certificate Modal */}
      {activeModalCert && (
        <OfficialCertificateModal
          certificate={activeModalCert}
          onClose={() => setActiveModalCert(null)}
          onVerify={(certNo, biz) => handleVerify(certNo, biz)}
        />
      )}
    </div>
  );
};
