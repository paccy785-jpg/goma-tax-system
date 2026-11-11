import { useRevenueLedger } from '../hooks/useRevenueLedger';
import React, { useState, useMemo } from 'react';
import { 
  ReceiptText, 
  Search, 
  DollarSign, 
  Printer, 
  Landmark, 
  Building,
  Smartphone,
  X,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Ban,
  AlertOctagon
} from 'lucide-react';
import { Payment, PaymentMethod, UserRole } from '../types';
import { 
  getPayments, 
  subscribeToPayments,
  voidPaymentReceipt
} from '../services/dbService';
import { emitGlobalToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { localDateFromIsoTimestamp } from '../utils/date';
import { OfficialReceiptModal } from './OfficialReceiptModal';
import {
  BankConfirmation,
  PaymentReceipt,
  RECEIPT_KIND_LABELS,
  receiptNumberOf,
  subscribeToBankConfirmations,
} from '../services/bankConfirmationService';
import { DeclarationReceiptModal } from './bank/DeclarationReceiptModal';
import { noteReceipt, subscribeToNotesPerception } from '../services/notePerceptionService';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';

interface PaymentsViewProps {
  userRole: UserRole;
  onNavigateToVerify?: (receiptNumber?: string) => void;
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({ 
  userRole,
  onNavigateToVerify 
}) => {
  const { currentUser, userProfile } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const { sources, loading, error, cached } = useRevenueLedger(reloadKey);
  const payments = sources.payments;
  const confirmations = sources.bankConfirmations;
  const noteReceipts = useMemo(() => sources.notesPerception.map(noteReceipt).filter((r): r is PaymentReceipt => !!r), [sources.notesPerception]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [activeReceipt, setActiveReceipt] = useState<Payment | null>(null);
  /**
   * Declaration payments the bank has confirmed. Each one is a receipt: a
   * declaration enters this ledger only once its payment is confirmed.
   */
  const [activeDeclReceipt, setActiveDeclReceipt] = useState<PaymentReceipt | null>(null);

  // Void Receipt Authority States
  const [receiptToVoid, setReceiptToVoid] = useState<Payment | null>(null);
  const [voidReasonInput, setVoidReasonInput] = useState<string>('');
  const [voidingReceipt, setVoidingReceipt] = useState<boolean>(false);
  const [voidError, setVoidError] = useState<string | null>(null);



  const reloadData = () => setReloadKey((k) => k + 1);
  const canVoidReceipt = userRole === 'Supervisor' || userRole === 'Admin';
  



  const handleConfirmVoidReceipt = async () => {
    if (!receiptToVoid) return;
    // The void action is authority-gated in the row button only; a handler must
    // refuse on its own so a stale/other trigger cannot void a receipt.
    if (!canVoidReceipt) {
      setVoidError('Only Supervisors or Administrators may void a receipt.');
      return;
    }
    if (!voidReasonInput.trim()) {
      setVoidError('A regulatory justification reason is required to void this receipt.');
      return;
    }
    setVoidingReceipt(true);
    setVoidError(null);
    try {
      const officer = {
        uid: userProfile?.uid || currentUser?.uid || 'officer_001',
        displayName: userProfile?.displayName || 'Fiscal Supervisor',
        role: userRole,
      };

      await voidPaymentReceipt(
        receiptToVoid.id,
        receiptToVoid.receiptNumber,
        voidReasonInput.trim(),
        officer
      );

      emitGlobalToast(`Receipt ${receiptToVoid.receiptNumber} officially voided. The linked assessment balance has been reinstated.`, 'success');
      setReceiptToVoid(null);
      setVoidReasonInput('');
      await reloadData();
    } catch (err: any) {
      console.error('[Void Receipt Error]', err);
      setVoidError(err?.message || 'Failed to void the receipt.');
    } finally {
      setVoidingReceipt(false);
    }
  };

  // Filtered Payments List
  const filtered = payments.filter((p) => {
    const matchesSearch = 
      (p.receiptNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.businessName || p.taxpayerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.assessmentNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.notes || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.voidReason || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (filterType === 'all') return true;
    if (filterType === 'full') return p.paymentType !== 'partial' && !p.isPartial && !p.isVoided;
    if (filterType === 'partial') return (p.paymentType === 'partial' || !!p.isPartial) && !p.isVoided;
    if (filterType === 'offline') return Boolean(p.offlineCreated) && !p.isVoided;
    if (filterType === 'voided') return Boolean(p.isVoided);
    return true;
  });

  // Bank-confirmed declaration receipts, under the same search. They are full,
  // final payments: never partial, offline or voided.
  const searchLower = searchQuery.toLowerCase();
  const filteredBank = confirmations.filter((c) => {
    if (!['all', 'full', 'declarations'].includes(filterType)) return false;
    if (!searchLower) return true;
    return [
      receiptNumberOf(c),
      c.contribuableName,
      c.contribuableNif || '',
      c.reference,
      c.detail || '',
      RECEIPT_KIND_LABELS[c.kind] || '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchLower);
  });

  // Confirmed notes de perception, under the same search — their own filter,
  // apart from the confirmed declarations.
  const filteredNotes = noteReceipts.filter((c) => {
    if (!['all', 'full', 'notes'].includes(filterType)) return false;
    if (!searchLower) return true;
    return [receiptNumberOf(c), c.contribuableName, c.contribuableNif || '', c.reference, c.detail || '', RECEIPT_KIND_LABELS[c.kind]]
      .join(' ')
      .toLowerCase()
      .includes(searchLower);
  });

  /** One ledger, newest first: counter receipts, confirmed declarations and confirmed notes de perception. */
  type LedgerEntry =
    | { type: 'counter'; at: string; p: Payment }
    | { type: 'bank'; at: string; c: PaymentReceipt };
  const ledger: LedgerEntry[] = [
    ...(filterType === 'declarations' || filterType === 'notes' ? [] : filtered).map(
      (p): LedgerEntry => ({ type: 'counter', at: String(p.paidAt || p.paymentDate || ''), p })
    ),
    ...filteredBank.map((c): LedgerEntry => ({ type: 'bank', at: c.confirmedAt || '', c })),
    ...filteredNotes.map((c): LedgerEntry => ({ type: 'bank', at: c.confirmedAt || '', c })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Calculate totals (excluding voided receipts)
  const validPayments = payments.filter((p) => !p.isVoided);
  const voidedCount = payments.filter((p) => p.isVoided).length;
  const bankCollectedUSD =
    confirmations.reduce((sum, c) => sum + (c.amountUSD || 0), 0) +
    noteReceipts.reduce((sum, c) => sum + (c.amountUSD || 0), 0);
  const totalCollectedUSD =
    validPayments.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0) + bankCollectedUSD;
  const totalReceipts = payments.length + confirmations.length + noteReceipts.length;

  const renderBankRow = (c: PaymentReceipt) => (
    <tr key={`bank_${c.id}`} className="hover:bg-surface2/30 transition-premium">
      <td className="py-4 px-6 font-mono">
        <div className="font-bold text-ink flex items-center gap-1.5 flex-wrap">
          <span className="tabular-nums">{receiptNumberOf(c)}</span>
          <Badge variant="sage" size="sm">Bank</Badge>
        </div>
        <div className="text-[11px] text-muted font-sans mt-0.5">Bank ref. {c.reference}</div>
      </td>

      <td className="py-4 px-6">
        <div className="font-bold text-ink">{c.contribuableName}</div>
        <div className="text-[12px] text-muted truncate max-w-xs mt-0.5">
          {[c.contribuableNif ? `NIF ${c.contribuableNif}` : '', c.detail || ''].filter(Boolean).join(' • ')}
        </div>
      </td>

      <td className="py-4 px-6">
        <div className="flex flex-col gap-1 items-start">
          <Badge variant="sage" dot>{RECEIPT_KIND_LABELS[c.kind] || c.kind}</Badge>
          <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-ink bg-surface2 px-2 py-0.5 rounded-full border border-line">
            <Landmark className="w-3 h-3 text-muted" />
            {c.modePaiement || 'Bank confirmed'}
          </span>
        </div>
      </td>

      <td className="py-4 px-6 text-right font-mono">
        <div className="font-display text-sm font-bold tabular-nums text-ink">{formatMoney(c.amountUSD || 0)}</div>
        <div className="text-[11px] text-sage font-bold mt-0.5 font-sans">Confirmed by the bank</div>
      </td>

      <td className="py-4 px-6">
        <div className="text-xs text-ink font-mono tabular-nums">
          {c.confirmedAt ? localDateFromIsoTimestamp(c.confirmedAt) : '-'}
        </div>
      </td>

      <td className="py-4 px-6 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveDeclReceipt(c)}
            icon={<Printer className="w-3.5 h-3.5" />}
          >
            Receipt
          </Button>
        </div>
      </td>
    </tr>
  );

  const getMethodBadge = (m: PaymentMethod) => {
    switch (m) {
      case 'Cash_Guichet':
        return (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
            <Building className="w-3 h-3 text-slate-500" />
            Cash at Counter
          </span>
        );
      case 'Mobile_Money_Airtel':
        return (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-800 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
            <Smartphone className="w-3 h-3 text-red-600" />
            Airtel Money DRC
          </span>
        );
      case 'Mobile_Money_Orange':
        return (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
            <Smartphone className="w-3 h-3 text-amber-600" />
            Orange Money DRC
          </span>
        );
      case 'Bank_Transfer_Rawbank':
        return (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
            <Landmark className="w-3 h-3 text-blue-700" />
            Rawbank Transfer
          </span>
        );
      case 'Bank_Transfer_EquityBCDC':
        return (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <Landmark className="w-3 h-3 text-emerald-700" />
            Equity BCDC Transfer
          </span>
        );
      default:
        return <span className="text-[12px] text-slate-700">{m}</span>;
    }
  };

  if (loading || error) return <div role="status" className="space-y-4">
    <p>{error || 'Chargement du registre complet…'}</p>
    {error && <Button onClick={reloadData}>Réessayer</Button>}
  </div>;

  return (
    <div className="space-y-8 font-sans">
      {cached && <p role="status">Données locales non confirmées : les totaux peuvent être incomplets.</p>}
      
      {/* Page Header */}
      <PageHeader
        eyebrow="Cash desk"
        title="Cash Collection & Official Receipts"
        actions={
          <>
            {onNavigateToVerify && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => onNavigateToVerify()}
                icon={<ShieldCheck className="w-4 h-4 text-sage" />}
              >
                Verify Receipt
              </Button>
            )}

          </>
        }
      />

      {/* Metric Strip (2 columns) */}
      <MetricStrip
        columns={2}
        items={[
          {
            label: 'Total Collected (USD)',
            value: `${formatMoney(totalCollectedUSD)}`,
            trend: `${validPayments.length + confirmations.length + noteReceipts.length} valid receipts`,
            trendType: 'sage',
            subline: 'Counter & bank-confirmed',
            icon: <DollarSign className="w-4 h-4 text-sage" />,
          },
          {
            label: 'Receipts Issued',
            value: totalReceipts.toString(),
            trend: voidedCount > 0 ? `${voidedCount} voided` : 'All cleared',
            trendType: voidedCount > 0 ? 'danger' : 'sage',
            subline: 'Strict sequential numbers',
            icon: <ReceiptText className="w-4 h-4 text-accent" />,
          },
        ]}
      />

      {/* Panel with Search & Filter Bar and Table */}
      <Panel
        title="Revenue Collection Ledger"
        subtitle={`Displaying ${ledger.length} of ${totalReceipts} issued receipts`}
        padding="none"
      >
        {/* Search and Filters Bar */}
        <div className="p-4 sm:p-5 border-b border-line bg-surface2/30 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="payment-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 text-xs rounded-[10px] border border-line bg-surface font-medium text-ink focus:border-accent focus:outline-none transition-premium font-sans"
            >
              <option value="all">All Payments ({totalReceipts})</option>
              <option value="declarations">Confirmed declarations ({confirmations.length})</option>
              <option value="notes">Confirmed notes de perception ({noteReceipts.length})</option>
              <option value="full">Full Payments</option>
              <option value="partial">Partial Payments</option>
              <option value="offline">Recorded Offline</option>
              {voidedCount > 0 && (
                <option value="voided">Voided Receipts ({voidedCount})</option>
              )}
            </select>
          </div>
        </div>

        {/* Payments Table */}
        <div className="overflow-x-auto">
          <table className="premium-table w-full text-left border-collapse text-xs font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/40">
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Official Receipt</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Taxpayer / Business</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Payment Type</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint text-right">Amount Collected</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Date</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink">
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    No payment records found matching criteria.
                  </td>
                </tr>
              ) : (
                ledger.map((entry) => entry.type === 'bank' ? renderBankRow(entry.c) : ((item: Payment) => (
                  <tr key={item.id} className={`hover:bg-surface2/30 transition-premium ${item.isVoided ? 'bg-danger/5' : ''}`}>
                    <td className="py-4 px-6 font-mono">
                      <div className="font-bold text-ink flex items-center gap-1.5 flex-wrap">
                        <span className={`tabular-nums ${item.isVoided ? 'line-through text-muted' : ''}`}>{item.receiptNumber}</span>
                        {item.isVoided ? (
                          <Badge variant="danger" size="sm">VOIDED</Badge>
                        ) : item.offlineCreated ? (
                          <Badge variant="warn" size="sm">Offline</Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted font-sans mt-0.5">
                        Notice #{item.assessmentNumber || item.assessmentId}
                      </div>
                    </td>

                    <td className="py-4 px-6">
                      <div className="font-bold text-ink">
                        {item.businessName || item.taxpayerName}
                      </div>
                      {item.isVoided && item.voidReason ? (
                        <div className="text-[12px] text-danger font-medium mt-0.5">
                          Voided: "{item.voidReason}" {item.voidedByName ? `(${item.voidedByName})` : ''}
                        </div>
                      ) : item.notes ? (
                        <div className="text-[12px] text-muted truncate max-w-xs mt-0.5">
                          {item.notes}
                        </div>
                      ) : null}
                    </td>

                    <td className="py-4 px-6">
                      {item.isVoided ? (
                        <Badge variant="danger">Receipt Voided</Badge>
                      ) : (
                        <div className="flex flex-col gap-1 items-start">
                          {item.paymentType === 'partial' || item.isPartial ? (
                            <Badge variant="warn" dot>Partial Payment</Badge>
                          ) : (
                            <Badge variant="sage" dot>Full Payment</Badge>
                          )}
                          <div className="mt-0.5">
                            {getMethodBadge(item.paymentMethod)}
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-6 text-right font-mono">
                      <div className={`font-display text-sm font-bold tabular-nums ${item.isVoided ? 'line-through text-muted' : 'text-ink'}`}>
                        {formatMoney((item.amountPaidUSD ?? 0))}
                      </div>
                      {!item.isVoided && (item.paymentType === 'partial' || item.isPartial) && typeof item.remainingBalanceUSD === 'number' && (
                        <div className="text-[11px] text-warn font-bold mt-0.5 tabular-nums">
                          Balance: {formatMoney((item.remainingBalanceUSD ?? 0))}
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-6">
                      <div className="text-xs text-ink font-mono tabular-nums">
                        {item.paymentDate || (item.paidAt ? localDateFromIsoTimestamp(item.paidAt) : '-')}
                      </div>
                    </td>

                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveReceipt(item)}
                          icon={<Printer className="w-3.5 h-3.5" />}
                        >
                          Receipt
                        </Button>
                        {onNavigateToVerify && (
                          <button
                            type="button"
                            onClick={() => onNavigateToVerify(item.receiptNumber)}
                            className="p-1.5 rounded-[8px] border border-line bg-surface text-sage hover:bg-surface2 transition-premium"
                            title="Verify Anti-Fraud Security"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                        )}
                        {canVoidReceipt && !item.isVoided && (
                          <button
                            type="button"
                            onClick={() => {
                              setReceiptToVoid(item);
                              setVoidReasonInput('');
                              setVoidError(null);
                            }}
                            className="p-1.5 rounded-[8px] border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20 transition-premium"
                            title="Void this official receipt"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))(entry.p))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Official Receipt Modal */}
      {activeReceipt && (
        <OfficialReceiptModal
          payment={activeReceipt}
          onClose={() => setActiveReceipt(null)}
          onVerify={(receiptNumber) => {
            setActiveReceipt(null);
            if (onNavigateToVerify) {
              onNavigateToVerify(receiptNumber);
            }
          }}
        />
      )}

      {/* Receipt of a bank-confirmed declaration payment */}
      <DeclarationReceiptModal confirmation={activeDeclReceipt} onClose={() => setActiveDeclReceipt(null)} />

      {/* Void Receipt Modal (Supervisor / Admin Authority) */}
      {receiptToVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg my-6 overflow-hidden animate-fadeIn">
            {/* Header */}
            <div className="px-6 py-4 bg-rose-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500/30 flex items-center justify-center text-rose-200 border border-rose-400/30">
                  <Ban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Void Official Receipt</h3>
                  <p className="text-xs text-rose-200 font-mono">Receipt: {receiptToVoid.receiptNumber}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptToVoid(null)}
                className="p-1 rounded-lg text-rose-200 hover:text-white hover:bg-rose-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Regulatory Warning:</strong> Voiding an official receipt does not erase the accounting trail. The receipt will be marked <em>VOIDED</em>, the balance due on the linked tax assessment will be automatically reinstated, and an anomaly entry will be recorded in the fiscal audit log.
                </div>
              </div>

              {/* Receipt Overview Card */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Taxpayer</span>
                  <div className="font-bold text-slate-900 mt-0.5 truncate">{receiptToVoid.businessName || receiptToVoid.taxpayerName}</div>
                </div>
                <div>
                  <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Amount Collected</span>
                  <div className="font-bold text-rose-700 font-mono mt-0.5">
                    {formatMoney((receiptToVoid.amountPaidUSD ?? 0))}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Collected By</span>
                  <div className="text-slate-700 mt-0.5 truncate">{receiptToVoid.cashierName || receiptToVoid.receivedByName || 'Cashier'}</div>
                </div>
                <div>
                  <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">Date</span>
                  <div className="text-slate-700 font-mono mt-0.5">{receiptToVoid.paymentDate || (receiptToVoid.paidAt ? localDateFromIsoTimestamp(receiptToVoid.paidAt) : '-')}</div>
                </div>
              </div>

              {/* Justification input */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Void reason (mandatory) *
                </label>
                <textarea
                  required
                  rows={3}
                  value={voidReasonInput}
                  onChange={(e) => setVoidReasonInput(e.target.value)}
                  placeholder="e.g. Counter data-entry error, duplicate collection, or rejected payment..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-rose-500 bg-white"
                />
              </div>

              {/* Quick Select Buttons */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Counter data-entry error",
                  "Duplicate collection",
                  "Bank rejection / Bounced check",
                  "Wrong taxpayer selected",
                  "Administrative regularization"
                ].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setVoidReasonInput(reason)}
                    className="px-2 py-1 rounded-md text-[12px] bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200"
                  >
                    {reason}
                  </button>
                ))}
              </div>

              {voidError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                  <span>{voidError}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReceiptToVoid(null)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                disabled={voidingReceipt || !voidReasonInput.trim()}
                onClick={handleConfirmVoidReceipt}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-md transition-colors disabled:opacity-50"
              >
                {voidingReceipt ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Voiding receipt...</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-3.5 h-3.5" />
                    <span>Confirm Receipt Void</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
