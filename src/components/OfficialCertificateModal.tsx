import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  Printer, 
  X, 
  ShieldCheck, 
  Landmark, 
  AlertTriangle, 
  QrCode, 
  Download, 
  Copy, 
  CheckCircle2, 
  AlertOctagon, 
  Calendar, 
  Building2, 
  User, 
  FileText, 
  ExternalLink 
} from 'lucide-react';
import { BusinessLicenseCertificate, UserRole } from '../types';
import { BRAND } from '../branding';
import { getEffectiveCertificateStatus } from '../services/certificateService';
import { formatMoney } from '../utils/money';

interface OfficialCertificateModalProps {
  certificate: BusinessLicenseCertificate | null;
  onClose: () => void;
  onVerify?: (certificateNumber: string, businessName?: string) => void;
  onRequestRevocation?: (certificate: BusinessLicenseCertificate) => void;
  currentUserRole?: UserRole;
}

export const OfficialCertificateModal: React.FC<OfficialCertificateModalProps> = ({
  certificate,
  onClose,
  onVerify,
  onRequestRevocation,
  currentUserRole,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const effectiveStatus = certificate ? getEffectiveCertificateStatus(certificate) : 'Valid';

  useEffect(() => {
    if (!certificate) return;
    let mounted = true;

    // Distinct QR code payload encoding certificate verification data.
    //
    // `hash` is omitted when the certificate carries no security token, rather
    // than substituted with a placeholder: printing "SEC-VALID-GOMA" on an
    // official document asserts a token that was never issued, and a verifier
    // comparing it against the register would be comparing against a fiction.
    // The token is also what `verifyCertificate` cross-checks against the
    // stored record, so a fabricated value here is actively misleading.
    const qrPayload = JSON.stringify({
      app: 'GOMA-PATENTE-LICENSE-CERT',
      certNo: certificate.certificateNumber,
      biz: certificate.businessName,
      rccm: certificate.businessRegistrationNumber,
      sector: certificate.activitySector,
      size: certificate.sizeClass,
      year: certificate.taxYearCovered,
      expiry: certificate.expiryDate,
      status: effectiveStatus,
      ...(certificate.securityHash ? { hash: certificate.securityHash } : {}),
      authUrl: `https://goma.gouv.cd/verify-cert/${certificate.certificateNumber}`,
    });

    QRCode.toDataURL(
      qrPayload,
      {
        width: 190,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      },
      (err, url) => {
        if (mounted && !err && url) {
          setQrDataUrl(url);
        }
      }
    );
    // QRCode.toDataURL callback below checks mounted flag via cleanup.
    return () => { mounted = false; };
  }, [certificate, effectiveStatus]);

  if (!certificate) return null;

  const handleCopyNumber = () => {
    navigator.clipboard.writeText(certificate.certificateNumber).then(() => {
      setCopied(true);
      // Tracked timer — a bare setTimeout fired setCopied after unmount.
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopied(false);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const isRevoked = effectiveStatus === 'Revoked';
  const isExpired = effectiveStatus === 'Expired';
  const isValid = effectiveStatus === 'Valid';

  const canRequestRevocation = isValid && onRequestRevocation && (currentUserRole === 'Admin' || currentUserRole === 'Supervisor' || currentUserRole === 'Cashier');

  return (
    <div 
      id="certificate-modal-backdrop"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
    >
      <div 
        id="certificate-modal-container"
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col my-auto max-h-[92vh]"
      >
        {/* Top Control Bar (Hidden during print) */}
        <div 
          id="certificate-top-bar"
          className="print:hidden flex items-center justify-between px-6 py-3.5 bg-slate-900 text-white border-b border-slate-800 shrink-0"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Landmark className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Official Secure Document
              </div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Business License Certificate (Patente)</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  isValid ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                  isExpired ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                  'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}>
                  {effectiveStatus === 'Valid' ? 'VALID' : effectiveStatus === 'Expired' ? 'EXPIRED' : 'REVOKED'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print</span>
            </button>

            {onVerify && (
              <button
                type="button"
                onClick={() => onVerify(certificate.certificateNumber, certificate.businessName)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-sky-400" />
                <span>Verify</span>
              </button>
            )}

            {canRequestRevocation && (
              <button
                type="button"
                onClick={() => onRequestRevocation(certificate)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800 transition-colors cursor-pointer"
                title="Initiate revocation request via Maker-Checker"
              >
                <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">Revocation</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Canvas */}
        <div className="overflow-y-auto p-4 sm:p-8 bg-slate-100 flex justify-center">
          {/* THE CERTIFICATE SHEET */}
          <div 
            id="printable-license-certificate"
            className="relative w-full max-w-[820px] bg-white text-slate-900 p-8 sm:p-12 shadow-md border-8 border-double border-slate-800 rounded-sm print:shadow-none print:m-0 print:p-8 print:border-8 print:w-full"
          >
            {/* Guilloche / Ornamental Decorative Corner Accents */}
            <div className="absolute top-2 left-2 w-10 h-10 border-t-2 border-l-2 border-slate-800 pointer-events-none" />
            <div className="absolute top-2 right-2 w-10 h-10 border-t-2 border-r-2 border-slate-800 pointer-events-none" />
            <div className="absolute bottom-2 left-2 w-10 h-10 border-b-2 border-l-2 border-slate-800 pointer-events-none" />
            <div className="absolute bottom-2 right-2 w-10 h-10 border-b-2 border-r-2 border-slate-800 pointer-events-none" />

            {/* WATERMARK OVERLAY */}
            {isRevoked && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 select-none">
                <div className="rotate-[-25deg] text-6xl sm:text-7xl font-extrabold text-rose-600/20 border-8 border-dashed border-rose-600/30 px-8 py-4 rounded-xl tracking-widest uppercase">
                  REVOKED / VOID
                </div>
              </div>
            )}

            {isExpired && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 select-none">
                <div className="rotate-[-25deg] text-6xl sm:text-7xl font-extrabold text-amber-600/15 border-8 border-dashed border-amber-600/25 px-8 py-4 rounded-xl tracking-widest uppercase">
                  EXPIRED DOCUMENT
                </div>
              </div>
            )}

            {/* OFFICIAL HEADER */}
            <div className="text-center border-b-2 border-slate-800 pb-5 mb-6 relative">
              <div className="text-xs sm:text-sm font-black tracking-[0.25em] uppercase text-slate-900">
                DEMOCRATIC REPUBLIC OF THE CONGO
              </div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-700 mt-0.5">
                NORTH KIVU PROVINCE • CITY OF GOMA
              </div>
              <div className="text-xs font-semibold text-slate-600 italic">
                {BRAND.docAuthority}
              </div>

              {/* DRC Emblem / Coat of arms placeholder badge */}
              <div className="flex items-center justify-center gap-3 my-3">
                <div className="h-[1px] w-16 bg-slate-400" />
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-slate-800 bg-slate-50 text-slate-800 shadow-xs">
                  <Landmark className="w-5 h-5 text-slate-800" />
                </div>
                <div className="h-[1px] w-16 bg-slate-400" />
              </div>

              {/* DOCUMENT TITLE */}
              <h1 className="text-xl sm:text-2xl font-serif font-black tracking-tight text-slate-950 uppercase mt-2">
                Official Business License Certificate
              </h1>
              <div className="text-xs sm:text-sm font-bold tracking-widest uppercase text-emerald-800 mt-1">
                Business License Tax (Patente) — Fiscal Year {certificate.taxYearCovered}
              </div>

              {/* Certificate Number Display */}
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded bg-slate-100 border border-slate-300 text-xs font-mono font-bold text-slate-900">
                <span>N° D'ENREGISTREMENT OFFICIEL :</span>
                <span className="text-emerald-900 font-extrabold text-sm tracking-wider">{certificate.certificateNumber}</span>
                <button
                  type="button"
                  onClick={handleCopyNumber}
                  className="print:hidden p-0.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                  title="Copy certificate number"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* PREAMBLE & LEGAL BASIS */}
            <div className="text-[12px] leading-relaxed text-slate-600 text-justify italic mb-6 border-l-2 border-slate-300 pl-3">
              Pursuant to Law No. 08/012 of July 31, 2008 on fundamental principles concerning the free administration of provinces;
              Pursuant to the regulations governing the Business License Tax (Patente) for commercial and industrial operations under {BRAND.shortName} jurisdiction;
              It is hereby officially certified that the enterprise designated below has complied with all statutory tax assessments for fiscal year {certificate.taxYearCovered}.
            </div>

            {/* CERTIFICATE BODY GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 text-xs bg-slate-50/70 p-5 rounded-lg border border-slate-200 mb-6">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Registered Business Name</div>
                <div className="text-sm font-black text-slate-950 mt-0.5">{certificate.businessName}</div>
                {certificate.tradeName && certificate.tradeName !== certificate.businessName && (
                  <div className="text-xs text-slate-600 italic">Trade name: {certificate.tradeName}</div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Taxpayer / Legal Representative</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">{certificate.ownerName}</div>
                <div className="text-xs font-mono text-slate-600">Nat ID: {certificate.businessRegistrationNumber}</div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Activity Sector & Size Class</div>
                <div className="text-xs font-bold text-slate-900 capitalize mt-0.5">
                  {certificate.activitySector} • Class {certificate.sizeClass}
                </div>
                <div className="text-[12px] text-slate-600 mt-0.5">
                  Location: Commune of {certificate.commune}, Quartier {certificate.quartier}
                  {certificate.avenue && `, ${certificate.avenue}`}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Financial References</div>
                <div className="text-xs font-bold text-emerald-900 mt-0.5">
                  Tax Paid: {formatMoney(certificate.amountPaidUSD)}
                </div>
                <div className="text-[12px] text-slate-600 font-mono mt-0.5">
                  Notice: {certificate.assessmentNumber} | Receipt: {certificate.receiptNumber || 'Regularized'}
                </div>
              </div>
            </div>

            {/* DATES & VALIDITY STRIP */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 bg-emerald-950 text-white rounded-lg mb-6">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-300 shrink-0" />
                <span className="text-xs">
                  Issued on: <strong className="font-bold">{certificate.issueDate}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-200">
                  Fiscal Expiration Date:
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-900 text-white text-xs font-mono font-bold border border-emerald-700">
                  {certificate.expiryDate} (Fiscal Year {certificate.taxYearCovered} Close)
                </span>
              </div>
            </div>

            {/* REVOCATION WARNING BLOCK (IF REVOKED) */}
            {isRevoked && (
              <div className="mb-6 p-4 rounded-lg bg-rose-50 border-2 border-rose-400 text-rose-950 text-xs">
                <div className="flex items-center gap-2 font-bold text-rose-900 mb-1">
                  <AlertOctagon className="w-4 h-4 text-rose-700" />
                  <span>OFFICIAL ADMINISTRATIVE REVOCATION NOTICE</span>
                </div>
                <p>
                  This certificate was revoked on {certificate.revokedAt ? new Date(certificate.revokedAt).toLocaleDateString('en-US') : 'recently'} by {certificate.revokedByName || 'Tax Administration'}.
                </p>
                <p className="mt-1 font-semibold text-rose-900 italic">
                  Grounds: "{certificate.revocationReason || 'Fraud or violation of municipal regulations'}"
                </p>
                {certificate.revocationRequestId && (
                  <p className="mt-0.5 text-[11px] text-rose-700 font-mono">
                    Maker-Checker Audit Ref: {certificate.revocationRequestId}
                  </p>
                )}
              </div>
            )}

            {/* FOOTER & SECURITY VERIFICATION BLOCK */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 pt-4 border-t-2 border-slate-800 items-end">
              {/* QR Code & Digital Hash */}
              <div className="sm:col-span-4 flex flex-col items-center sm:items-start text-center sm:text-left">
                <div className="p-1.5 bg-white border border-slate-300 rounded shadow-xs mb-1.5">
                  {qrDataUrl ? (
                    <img 
                      src={qrDataUrl} 
                      alt={`QR Code Verification ${certificate.certificateNumber}`}
                      className="w-28 h-28"
                    />
                  ) : (
                    <div className="w-28 h-28 bg-slate-100 flex items-center justify-center">
                      <QrCode className="w-8 h-8 text-slate-400 animate-pulse" />
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  Secured Digital Seal
                </div>
                <div className="text-[9px] text-slate-400 font-mono">
                  {certificate.securityHash ? `HASH: ${certificate.securityHash}` : 'HASH: not issued (legacy record)'}
                </div>
              </div>

              {/* Instructions & Issuing Office */}
              <div className="sm:col-span-4 text-center text-[11px] text-slate-600 px-2">
                <p className="font-semibold text-slate-800">
                  {certificate.issuingOffice}
                </p>
                <p className="mt-1 text-[10px] text-slate-500 italic">
                  Official tamper-evident certificate. This document must be visibly and permanently displayed on the business premises under penalty of law.
                </p>
              </div>

              {/* Signatures & Stamps */}
              <div className="sm:col-span-4 text-center sm:text-right flex flex-col items-center sm:items-end">
                <div className="text-[11px] font-bold text-slate-700 uppercase">
                  For {BRAND.docAuthority},
                </div>
                <div className="text-xs font-serif font-black text-slate-900 mt-0.5">
                  Le Receveur Urbain Principal
                </div>
                
                {/* Official stylized digital stamp */}
                <div className="my-2 px-3 py-1 border-2 border-emerald-900 text-emerald-950 text-[11px] font-black uppercase rounded rotate-[-4deg] tracking-wider bg-emerald-50/50">
                  <span className="text-[10px] font-mono">★ {BRAND.fullName.toUpperCase()} ★</span>
                </div>
                
                <div className="text-[10px] text-slate-500 italic">
                  Digitally signed by {certificate.issuedByName}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Modal Actions (Hidden during print) */}
        <div 
          id="certificate-modal-footer"
          className="print:hidden px-6 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0"
        >
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Certificate issued in full accordance with the {BRAND.shortName} Business License Tax (Patente) provisions.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyNumber}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-slate-500" />
              <span>{copied ? 'Copied!' : 'Copy No.'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print Certificate</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
