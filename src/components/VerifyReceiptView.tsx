import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Landmark, 
  QrCode, 
  Receipt, 
  FileText, 
  ArrowRight,
  ExternalLink,
  History,
  Building2,
  Calendar,
  DollarSign,
  UserCheck,
  RefreshCw,
  HelpCircle,
  Clock
} from 'lucide-react';
import { verifyReceipt, ReceiptVerificationResult } from '../services/dbService';
import { OfficialReceiptModal } from './OfficialReceiptModal';
import { Payment } from '../types';
import { formatMoney } from '../utils/money';

interface VerifyReceiptViewProps {
  initialReceiptNumber?: string;
  onBackToPortal?: () => void;
  isPublicMode?: boolean;
}

interface VerificationHistoryItem {
  receiptNumber: string;
  timestamp: string;
  isValid: boolean;
  businessName?: string;
  amountUSD?: number;
}

export const VerifyReceiptView: React.FC<VerifyReceiptViewProps> = ({
  initialReceiptNumber = '',
  onBackToPortal,
  isPublicMode = false,
}) => {
  const [inputQuery, setInputQuery] = useState<string>(initialReceiptNumber);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ReceiptVerificationResult | null>(null);
  const [activeModalPayment, setActiveModalPayment] = useState<Payment | null>(null);
  const [history, setHistory] = useState<VerificationHistoryItem[]>([]);
  const [qrPasteMode, setQrPasteMode] = useState<boolean>(false);

  // Resync when navigating here from Payments/Anomalies with a new receipt number.
  useEffect(() => {
    setInputQuery(initialReceiptNumber || '');
    setResult(null);
  }, [initialReceiptNumber]);

  const handleVerify = async (queryToUse?: string) => {
    const q = (queryToUse !== undefined ? queryToUse : inputQuery).trim();
    if (!q) return;
    // Re-entrancy guard: the disabled verify button does not stop implicit form
    // submission via the Enter key.
    if (loading) return;

    setLoading(true);
    try {
      const res = await verifyReceipt(q);
      setResult(res);

      // Add to session history
      const historyItem: VerificationHistoryItem = {
        receiptNumber: q,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        isValid: res.isValid,
        businessName: res.payment?.businessName || res.payment?.taxpayerName,
        amountUSD: res.payment?.amountPaidUSD,
      };

      setHistory((prev) => [historyItem, ...prev.filter((h) => h.receiptNumber !== q)].slice(0, 8));
    } catch (err) {
      console.error('[Verification Error]', err);
      setResult({
        isValid: false,
        payment: null,
        status: 'not_found',
        message: 'Technical error during receipt verification. Please retry.',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickTest = (num: string) => {
    setInputQuery(num);
    handleVerify(num);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      
      {/* Official Header Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-5 pointer-events-none flex items-center justify-end pr-6">
          <Landmark className="w-64 h-64 text-white" />
        </div>

        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Anti-Fraud Verification • Municipal & Road Checkpoints</span>
            </div>

            {onBackToPortal && (
              <button
                type="button"
                onClick={onBackToPortal}
                className="text-xs text-slate-300 hover:text-white underline font-medium"
              >
                Back to Portal
              </button>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Official Tax Receipt Verification (Patente)
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
            Enter the sequential receipt number or scan the QR code to instantly authenticate payment validity and confirm the collected revenue with the City of Goma official tax ledger.
          </p>

          {/* Search Box */}
          <div className="mt-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerify();
              }}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  id="receipt-verify-input"
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm rounded-xl bg-slate-950/80 border border-slate-700 text-white placeholder-slate-400 font-mono focus:outline-hidden focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all shadow-inner"
                />
              </div>

              <button
                id="receipt-verify-btn"
                type="submit"
                disabled={loading || !inputQuery.trim()}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                <span>Verify Receipt</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Verification Result Section */}
      {result && (
        <div className="transition-all animate-fadeIn">
          {result.isValid && result.payment ? (
            /* AUTHENTIC RECEIPT CARD */
            <div className="rounded-2xl border-2 border-emerald-500 bg-white shadow-xl overflow-hidden">
              
              {/* Header Badge */}
              <div className="p-5 sm:p-6 bg-emerald-600 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white text-emerald-700 flex items-center justify-center shadow-md">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-wider text-emerald-100">
                      Verification Successful • Official DPRNK Tax Ledger
                    </div>
                    <div className="text-xl font-black tracking-tight">
                      AUTHENTIC & VALID RECEIPT
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveModalPayment(result.payment)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-emerald-50 text-emerald-900 font-bold text-xs shadow-md transition-colors"
                >
                  <Receipt className="w-4 h-4 text-emerald-700" />
                  <span>View Official Receipt PDF</span>
                </button>
              </div>

              {/* Data Grid */}
              <div className="p-6 sm:p-8 space-y-6">
                
                {/* Highlight Amount Banner */}
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                      Statutory Amount Collected
                    </div>
                    <div className="text-3xl font-black text-emerald-950 mt-0.5">
                      {formatMoney(result.payment.amountPaidUSD)}
                    </div>
                  </div>

                  <div className="sm:text-right">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Settlement Status
                    </div>
                    <div className="mt-1">
                      {result.payment.paymentType === 'full' || !result.payment.isPartial ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 font-bold text-xs border border-emerald-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                          Full Payment Settled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 font-bold text-xs border border-amber-300">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                          Partial Payment
                        </span>
                      )}
                    </div>
                    {result.payment.isPartial && typeof result.payment.remainingBalanceUSD === 'number' && (
                      <div className="text-xs text-amber-900 font-bold mt-1 font-mono">
                        Remaining Balance: {formatMoney(result.payment.remainingBalanceUSD)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Detailed Information Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2 text-slate-700 font-bold border-b border-slate-200 pb-2">
                      <Building2 className="w-4 h-4 text-amber-600" />
                      <span>Taxpayer & Business Identity</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Business Name:</span>
                      <span className="font-bold text-slate-900 text-sm">
                        {result.payment.businessName || result.payment.taxpayerName}
                      </span>
                    </div>
                    {result.assessment && (
                      <>
                        <div>
                          <span className="text-slate-500 block">Sector & Category:</span>
                          <span className="font-semibold text-slate-800 capitalize">
                            {result.assessment.activitySector} • {result.assessment.sizeClass}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Location:</span>
                          <span className="font-semibold text-slate-800">
                            Commune of {result.assessment.commune || 'Goma'}, Quarter {result.assessment.quartier || '—'}
                          </span>
                        </div>
                      </>
                    )}
                    <div>
                      <span className="text-slate-500 block">Assessment Notice #:</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {result.payment.assessmentNumber || result.payment.assessmentId}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2 text-slate-700 font-bold border-b border-slate-200 pb-2">
                      <Calendar className="w-4 h-4 text-amber-600" />
                      <span>Receipt & Cashier Details</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Receipt Number:</span>
                      <span className="font-mono font-bold text-slate-950 text-sm">
                        {result.payment.receiptNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Covered Fiscal Year:</span>
                      <span className="font-semibold text-slate-900">
                        Fiscal Year {result.payment.fiscalYear || 2026}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Payment Timestamp:</span>
                      <span className="font-semibold text-slate-900">
                        {result.payment.paymentDate || new Date(result.payment.paidAt).toLocaleDateString('en-US')} • {new Date(result.payment.paidAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Collecting Cashier:</span>
                      <span className="font-semibold text-slate-900">
                        {result.payment.cashierName || result.payment.receivedByName}
                      </span>
                    </div>
                  </div>

                </div>

                {/* Checkpoint Inspector Clearance Note */}
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-950 text-xs flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Guidance for Road & Municipal Checkpoint Officers:</div>
                    <div className="mt-0.5 text-[12px] text-emerald-900">
                      This receipt is certified authentic and matches a verified entry in the municipal tax ledger. The business entity is legally compliant for fiscal year {result.payment.fiscalYear || 2026}.
                    </div>
                  </div>
                </div>

              </div>
            </div>
          ) : result.status === 'cancelled' && result.payment ? (
            /* VOIDED RECEIPT CARD — genuine number, but cancelled */
            <div className="rounded-2xl border-2 border-amber-500 bg-white shadow-xl overflow-hidden">
              <div className="p-6 bg-amber-500 text-white flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white text-amber-600 flex items-center justify-center shrink-0 shadow-md">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <div className="text-[12px] font-bold uppercase tracking-wider text-amber-100">
                    Verification Successful • Official DPRNK Tax Ledger
                  </div>
                  <div className="text-xl font-black tracking-tight">
                    VOIDED RECEIPT — NO LONGER VALID
                  </div>
                </div>
              </div>

              <div className="p-6 sm:p-8 space-y-5">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2">
                  <div className="font-bold text-sm text-amber-900">
                    Receipt Number: <span className="font-mono">{result.payment.receiptNumber}</span>
                  </div>
                  <p className="text-amber-800">
                    {result.message}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-800 uppercase tracking-wider text-[12px] border-b border-slate-200 pb-2">
                      Original Payment Details
                    </div>
                    <div>
                      <span className="text-slate-500 block">Business / Taxpayer:</span>
                      <span className="font-semibold text-slate-900">
                        {result.payment.businessName || result.payment.taxpayerName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Amount Was:</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatMoney(result.payment.amountPaidUSD)}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-800 uppercase tracking-wider text-[12px] border-b border-slate-200 pb-2">
                      Guidance for Inspection Officers:
                    </div>
                    <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
                      <li>This receipt number is genuine but was officially cancelled and carries no liberatory value.</li>
                      <li>Do NOT accept this document as proof of payment of the patente.</li>
                      <li>Request a valid replacement receipt or apply the applicable compliance procedure.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* FRAUDULENT / UNRECOGNIZED ALERT CARD */
            <div className="rounded-2xl border-2 border-red-500 bg-white shadow-xl overflow-hidden">
              <div className="p-6 bg-red-600 text-white flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white text-red-700 flex items-center justify-center shrink-0 shadow-md">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <div className="text-[12px] font-bold uppercase tracking-wider text-red-100">
                    Tax Fraud Alert • Checkpoint Security
                  </div>
                  <div className="text-xl font-black tracking-tight">
                    UNRECOGNIZED OR SUSPICIOUS RECEIPT
                  </div>
                </div>
              </div>

              <div className="p-6 sm:p-8 space-y-5">
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-950 space-y-2">
                  <div className="font-bold text-sm text-red-900">
                    Queried Number: <span className="font-mono">{inputQuery}</span>
                  </div>
                  <p className="text-red-800">
                    {result.message}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-3">
                  <div className="font-bold text-slate-800 uppercase tracking-wider text-[12px]">
                    Standard Operational Procedure for Inspection Officers:
                  </div>
                  <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
                    <li>Inspect physical receipt document thoroughly (check paper watermark, tamper-evident patterns, lack of handwritten alterations).</li>
                    <li>Verify exact format of receipt number (standard format <span className="font-mono font-semibold">REC-2026-XXXXX</span>).</li>
                    <li>If receipt is counterfeit or non-existent, deny passage/clearance and record an official notice of fiscal infraction.</li>
                    <li>Contact Urban Finance Directorate of Goma for direct counter-verification with central cashier log.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Verification History for the Checkpoint Session */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Session Verification Log ({history.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-[12px] text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {history.map((item) => (
              <div
                key={`${item.receiptNumber}-${item.timestamp}`}
                className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 cursor-pointer"
                onClick={() => handleQuickTest(item.receiptNumber)}
              >
                <div className="flex items-center gap-3">
                  {item.isValid ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  )}
                  <div>
                    <span className="font-mono font-bold text-slate-900">
                      {item.receiptNumber}
                    </span>
                    {item.businessName && (
                      <span className="text-slate-500 ml-2">
                        — {item.businessName}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {item.amountUSD !== undefined && (
                    <span className="font-bold text-emerald-800 font-mono">
                      {formatMoney(item.amountUSD)}
                    </span>
                  )}
                  <span className="text-[12px] text-slate-400 font-mono">
                    {item.timestamp}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal for full receipt visualization */}
      {activeModalPayment && (
        <OfficialReceiptModal
          payment={activeModalPayment}
          onClose={() => setActiveModalPayment(null)}
        />
      )}

    </div>
  );
};
