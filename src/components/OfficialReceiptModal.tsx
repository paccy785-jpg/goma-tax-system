import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  Printer, 
  X, 
  ShieldCheck, 
  Landmark, 
  CheckCircle2, 
  AlertTriangle,
  QrCode,
  Download,
  Copy,
  ExternalLink,
  Ban,
  AlertOctagon
} from 'lucide-react';
import { Payment } from '../types';
import { BRAND } from '../branding';
import { localDateFromIsoTimestamp, todayDateString } from '../utils/date';
import { formatMoney } from '../utils/money';
import { printOnePage } from '../utils/printOnePage';

interface OfficialReceiptModalProps {
  payment: Payment | null;
  onClose: () => void;
  onVerify?: (receiptNumber: string) => void;
}

export const OfficialReceiptModal: React.FC<OfficialReceiptModalProps> = ({
  payment,
  onClose,
  onVerify,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  /** The printable receipt, printed on its own portrait page (one page, like the note de perception). */
  const sheetRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!payment) return;
    let alive = true;

    // Encode verified security payload into QR code
    const qrPayload = JSON.stringify({
      app: BRAND.qrAppTag,
      rec: payment.receiptNumber || payment.id,
      biz: payment.businessName || payment.taxpayerName || 'N/A',
      amtUSD: payment.amountPaidUSD ?? 0,
      year: payment.fiscalYear || 2026,
      // paidAt is a UTC instant; slice it into the local day the officer served
      // the taxpayer so the printed receipt is not dated a day early.
      date: payment.paymentDate || (typeof payment.paidAt === 'string' ? localDateFromIsoTimestamp(payment.paidAt) : todayDateString()),
      cashier: payment.cashierName || payment.receivedByName || 'Cashier',
      seq: payment.sequenceNumber || 1,
      type: payment.paymentType || 'full',
      voided: Boolean(payment.isVoided),
    });

    QRCode.toDataURL(
      qrPayload,
      {
        width: 140,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      },
      (err, url) => {
        if (alive && !err && url) {
          setQrDataUrl(url);
        }
      }
    );
    return () => { alive = false; };
  }, [payment]);

  if (!payment) return null;

  const handleCopyNumber = () => {
    navigator.clipboard.writeText(payment.receiptNumber || '').then(() => {
      setCopied(true);
      // Tracked timer — a bare setTimeout fired setCopied after unmount.
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopied(false);
    });
  };

  const handlePrint = () =>
    printOnePage(sheetRef.current, { layoutWidth: 600, title: payment.receiptNumber || 'Reçu' });

  const isPartial = payment.paymentType === 'partial' || payment.isPartial;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs print:p-0 print:bg-white print:static"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden relative print:border-none print:shadow-none print:max-w-none print:max-h-none print:my-0">
        
        {/* Top Control Bar (Hidden on print) - Fixed header, does not scroll */}
        <div className="shrink-0 px-4 py-2.5 sm:px-5 bg-slate-900 text-white flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wide">
              Secure Official Tax Receipt
            </span>
            {payment.offlineCreated && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold border border-amber-400/30">
                Recorded Offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              id="print-receipt-modal-btn"
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Official Document Container - Internal Scroll Region */}
        <div ref={sheetRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4 bg-white text-slate-900 relative print:p-0 print:overflow-visible">
          
          {/* Watermark in background */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
            <Landmark className="w-72 h-72 text-slate-900" />
          </div>

          {/* Official Seal and Header */}
          <div className="text-center pb-2.5 border-b-2 border-slate-900 space-y-0.5 relative">
            <div className="flex justify-center mb-0.5">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-slate-950 shadow-xs ring-1 ring-amber-400/40">
                <Landmark className="w-5 h-5 text-slate-950" />
              </div>
            </div>
            <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest leading-tight">
              DEMOCRATIC REPUBLIC OF THE CONGO
            </div>
            <div className="text-[12px] font-bold text-slate-800 uppercase tracking-wide leading-tight">
              PROVINCE OF NORTH KIVU • CITY OF GOMA
            </div>
            <div className="text-[11px] font-semibold text-slate-600 leading-tight">
              {BRAND.docAuthority}
            </div>
            <div className="inline-block mt-1.5 px-2.5 py-0.5 bg-slate-900 text-amber-400 text-[11px] sm:text-[12px] font-bold uppercase tracking-wider rounded-md">
              OFFICIAL PAYMENT RECEIPT — BUSINESS LICENSE TAX (PATENTE)
            </div>
          </div>

          {/* Voided Warning Notice if Voided */}
          {payment.isVoided && (
            <div className="my-2 p-2.5 bg-rose-50 border-2 border-rose-600 rounded-xl text-rose-950 flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Ban className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <div className="font-black uppercase tracking-wider text-rose-800 text-[11px] flex items-center gap-1.5">
                  <span>OFFICIALLY VOIDED DOCUMENT (VOIDED RECEIPT)</span>
                </div>
                <p className="mt-0.5 text-slate-700 text-[12px] leading-snug">
                  This receipt has been formally invalidated in the fiscal system of the {BRAND.shortName}. It constitutes no proof of payment.
                </p>
                {payment.voidReason && (
                  <div className="mt-1 font-semibold text-rose-900 bg-rose-100/70 px-2 py-0.5 rounded-sm inline-block text-[11px]">
                    Reason: {payment.voidReason} {payment.voidedByName ? `• Voided by: ${payment.voidedByName}` : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Receipt Number & Date Banner */}
          <div className="my-2 px-3 py-1.5 bg-amber-50/70 border border-amber-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900 leading-tight">
                Official Sequential Receipt Number (Tamper-Evident)
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-sm sm:text-base font-bold text-slate-950 tracking-tight">
                  {payment.receiptNumber}
                </span>
                <button
                  type="button"
                  onClick={handleCopyNumber}
                  className="p-0.5 rounded text-amber-800 hover:bg-amber-200/50 print:hidden transition-colors"
                  title="Copy receipt number"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copied && (
                  <span className="text-[10px] font-semibold text-emerald-700">Copied!</span>
                )}
              </div>
            </div>
            <div className="sm:text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
                Payment Collection Date
              </div>
              <div className="text-[12px] sm:text-xs font-bold text-slate-900">
                {payment.paymentDate || (payment.paidAt ? localDateFromIsoTimestamp(payment.paidAt) : '-')} • {payment.paidAt ? new Date(payment.paidAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-'}
              </div>
            </div>
          </div>

          {/* Core Taxpayer & Payment Information Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs py-1">
            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
                Taxpayer / Business Name
              </div>
              <div className="font-bold text-xs sm:text-[14px] text-slate-950 mt-0.5 leading-tight truncate">
                {payment.businessName || payment.taxpayerName}
              </div>
              <div className="text-[11px] sm:text-[12px] text-slate-600 mt-0.5">
                Assessment Notice Ref: <span className="font-mono font-semibold">{payment.assessmentNumber || payment.assessmentId}</span>
              </div>
              <div className="text-[11px] sm:text-[12px] text-slate-600 mt-0.5">
                Tax Settled:{' '}
                <span className="font-semibold">
                  {payment.taxTypeCode && payment.taxTypeCode !== 'PATENTE'
                    ? `${payment.taxTypeCode} Declaration${payment.taxRatePercent ? ` (${payment.taxRatePercent}%)` : ''}`
                    : 'Business License Tax (Patente)'}
                </span>
              </div>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
                Fiscal Year
              </div>
              <div className="font-bold text-xs sm:text-[14px] text-slate-950 mt-0.5 leading-tight">
                Year {payment.fiscalYear || 2026}
              </div>
              <div className="text-[11px] sm:text-[12px] text-slate-600 mt-0.5">
                Payment Channel: <span className="font-semibold">{payment.paymentMethod === 'Cash_Guichet' ? 'Cash at Counter' : payment.paymentMethod}</span>
              </div>
            </div>
          </div>

          {/* Financial Breakdown Card */}
          <div className="my-2 px-3.5 py-2 sm:py-2.5 rounded-xl border-2 border-emerald-600 bg-emerald-50/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3 pb-1.5 sm:pb-2 border-b border-emerald-200/80">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 leading-tight">
                  Amount Collected in Cash (USD)
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-950 leading-tight">
                  {formatMoney((payment.amountPaidUSD ?? 0))}
                </div>
              </div>
            </div>

            {/* Payment Nature: Full vs Partial with Balance */}
            <div className="pt-1.5 sm:pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-600 font-medium text-[12px]">Settlement Type:</span>
                {isPartial ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold border border-amber-300 text-[11px]">
                    <AlertTriangle className="w-3 h-3 text-amber-700" />
                    Partial Payment
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold border border-emerald-300 text-[11px]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                    Full Payment (Settled)
                  </span>
                )}
              </div>

              {/* Remaining balance display if partial */}
              {isPartial && typeof payment.remainingBalanceUSD === 'number' && (
                <div className="sm:text-right text-[12px]">
                  <span className="text-slate-600 font-medium">Remaining Balance Due: </span>
                  <span className="font-bold text-amber-900 font-mono text-[12px]">
                    {formatMoney(payment.remainingBalanceUSD)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Cashier & Verification QR Code Section */}
          <div className="my-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex flex-row items-center justify-between gap-3">
            
            {/* Cashier Details */}
            <div className="space-y-0.5 text-left flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
                Cashier / Collecting Officer
              </div>
              <div className="text-xs font-bold text-slate-900 truncate">
                {payment.cashierName || payment.receivedByName}
              </div>
              <div className="text-[10px] text-slate-500 font-mono truncate">
                Station / Cashier ID: {payment.cashierId || payment.receivedBy}
              </div>
              {payment.notes && (
                <div className="text-[11px] text-slate-600 italic mt-0.5 max-w-xs truncate">
                  "{payment.notes}"
                </div>
              )}
            </div>

            {/* Certified QR Code */}
            <div className="flex flex-col items-center shrink-0">
              <div className="p-1 bg-white rounded-lg border border-slate-900 shadow-2xs">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR Code Receipt ${payment.receiptNumber}`}
                    className="w-16 h-16 sm:w-18 sm:h-18"
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-18 sm:h-18 flex items-center justify-center bg-slate-100 text-slate-400">
                    <QrCode className="w-8 h-8" />
                  </div>
                )}
              </div>
              <span className="text-[9px] font-semibold text-slate-600 mt-0.5 uppercase tracking-wider text-center">
                Scan to verify
              </span>
            </div>
          </div>

          {/* Legal Stamp Simulation & Signatures */}
          <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2.5 text-center">
            <div className="px-2 py-1 border border-dashed border-slate-300 rounded-lg">
              <div className="text-[10px] font-bold uppercase text-slate-500 leading-tight">
                Collecting Cashier
              </div>
              <div className="h-7 sm:h-8 flex items-center justify-center text-[10px] font-serif text-slate-400 italic">
                [Signature & Cashier Stamp]
              </div>
              <div className="text-[11px] font-semibold text-slate-700 truncate leading-tight">
                {payment.cashierName || payment.receivedByName}
              </div>
            </div>

            <div className="px-2 py-1 border border-dashed border-slate-300 rounded-lg">
              <div className="text-[10px] font-bold uppercase text-slate-500 leading-tight">
                For {BRAND.docAuthority}
              </div>
              <div className="h-7 sm:h-8 flex items-center justify-center text-[10px] font-serif text-slate-400 italic">
                {BRAND.docStamp}
              </div>
              <div className="text-[11px] font-semibold text-slate-700 leading-tight">
                {BRAND.docIssuingOffice}
              </div>
            </div>
          </div>

          {/* Security Notice Footer */}
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-center">
            <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase tracking-widest font-mono leading-tight">
              OFFICIAL SECURE TAX RECEIPT • QR VERIFICATION AT ROAD & MUNICIPAL CHECKPOINTS • LAW N° 08/012 OF JULY 31, 2008
            </p>
          </div>

        </div>

        {/* Footer Actions (Hidden on print) - Fixed bottom bar */}
        <div className="shrink-0 px-4 py-2.5 sm:px-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2.5 print:hidden">
          {onVerify && (
            <button
              id="verify-from-modal-btn"
              type="button"
              onClick={() => onVerify(payment.receiptNumber)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Verify receipt authenticity & security hash</span>
            </button>
          )}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
            <button
              id="print-receipt-modal-secondary-btn"
              type="button"
              onClick={handlePrint}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Receipt</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
