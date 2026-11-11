import { Assessment, Business, Payment, PaymentMethod } from '../types';
import { roundMoney } from '../utils/frenchNumber';
import { localDateFromIsoTimestamp } from '../utils/date';
import { BankConfirmation, confirmationId, receiptNumberOf } from './bankConfirmationService';
import { FoncierCalculation } from './foncierCalculationService';
import { TaxCalculation } from './taxCalculationService';
import { montantPaiementUSD, NotePerception } from './notePerceptionService';

/**
 * The payments the system takes today, as the reports read them.
 *
 * Rapports et règlements was built on the counter receipts (patente). The
 * office now collects through the Comptable tab: IF / IRL declarations whose
 * payment the bank confirmed, and notes de perception whose payment was
 * confirmed. Each is turned into the ledger shapes the report functions
 * already aggregate — a payment for the money received, and a notice for the
 * amount owed — so every report (periods, communes, sectors, heads of tax,
 * arrears) counts them alongside the counter receipts.
 */

const norm = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Finds a taxpayer of the register: by id, else by NIF, else by name. */
function makeResolver(businesses: Business[]) {
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const byNif = new Map<string, Business>();
  const byName = new Map<string, Business>();
  const ambiguousNifs = new Set<string>();
  const ambiguousNames = new Set<string>();
  for (const b of businesses) {
    if (b.nif && norm(b.nif)) {
      if (byNif.has(norm(b.nif))) ambiguousNifs.add(norm(b.nif));
      byNif.set(norm(b.nif), b);
    }
    if (norm(b.businessName)) {
      if (byName.has(norm(b.businessName))) ambiguousNames.add(norm(b.businessName));
      byName.set(norm(b.businessName), b);
    }
  }
  for (const key of ambiguousNifs) byNif.delete(key);
  for (const key of ambiguousNames) byName.delete(key);
  return (id?: string, nif?: string, name?: string): Business | undefined =>
    (id && byId.get(id)) || (nif && byNif.get(norm(nif))) || (name && byName.get(norm(name))) || undefined;
}

/** Cash is "Espèces"; everything else is another means of payment. */
const methodOf = (label?: string): PaymentMethod =>
  norm(label).startsWith('espèces') || norm(label).startsWith('especes')
    ? 'Cash_Guichet'
    : 'Other';

function paymentRecord(p: {
  id: string;
  receiptNumber: string;
  taxTypeCode: string;
  taxpayer?: Business;
  taxpayerName: string;
  amountUSD: number;
  amountDueUSD?: number;
  methodLabel?: string;
  confirmedAt: string;
  confirmedByUid: string;
  confirmedByName: string;
}): Payment {
  const day = localDateFromIsoTimestamp(p.confirmedAt);
  return {
    id: p.id,
    receiptNumber: p.receiptNumber,
    assessmentId: '',
    businessId: p.taxpayer?.id,
    businessName: p.taxpayer?.businessName || p.taxpayerName,
    taxpayerId: p.taxpayer?.id || '',
    taxpayerName: p.taxpayerName,
    taxTypeCode: p.taxTypeCode,
    fiscalYear: Number(day.slice(0, 4)) || undefined,
    amountPaidUSD: roundMoney(p.amountUSD),
    currency: 'USD',
    paymentType: p.amountDueUSD !== undefined && p.amountUSD < p.amountDueUSD ? 'partial' : 'full',
    isPartial: p.amountDueUSD !== undefined && p.amountUSD < p.amountDueUSD,
    remainingBalanceUSD: p.amountDueUSD === undefined ? undefined : Math.max(0, roundMoney(p.amountDueUSD - p.amountUSD)),
    paymentMethod: methodOf(p.methodLabel),
    receivedBy: p.confirmedByUid,
    receivedByName: p.confirmedByName,
    paymentDate: day,
    paidAt: p.confirmedAt,
    verified: true,
  };
}

function noticeRecord(n: {
  id: string;
  number: string;
  taxTypeCode: string;
  taxpayer?: Business;
  taxpayerName: string;
  amountDueUSD: number;
  paidUSD: number;
  issuedAt: string;
  dueDate?: string;
}): Assessment {
  const remaining = Math.max(0, roundMoney(n.amountDueUSD - n.paidUSD));
  const issueDay = localDateFromIsoTimestamp(n.issuedAt);
  return {
    id: n.id,
    businessId: n.taxpayer?.id,
    businessName: n.taxpayer?.businessName || n.taxpayerName,
    commune: n.taxpayer?.commune,
    quartier: n.taxpayer?.quartier,
    activitySector: n.taxpayer?.activitySector,
    sizeClass: n.taxpayer?.sizeClass,
    taxpayerId: n.taxpayer?.id,
    taxpayerName: n.taxpayerName,
    assessmentNumber: n.number,
    noticeNumber: n.number,
    fiscalYear: Number(issueDay.slice(0, 4)) || new Date().getFullYear(),
    baseAnnualFeeUSD: n.amountDueUSD,
    amountDueUSD: n.amountDueUSD,
    amountPaidUSD: n.paidUSD,
    remainingBalanceUSD: remaining,
    isProrated: false,
    proratedMonths: 12,
    issueDate: issueDay,
    // Declarations carry no payment deadline, so they are never "overdue";
    // a note de perception is due by the date the ordonnateur set.
    dueDate: n.dueDate || '',
    status: remaining <= 0.001 ? 'Paid' : 'Pending',
    assessedBy: '',
    assessedByName: '',
    taxTypeCode: n.taxTypeCode,
  } as Assessment;
}

export interface ComptableLedger {
  payments: Payment[];
  assessments: Assessment[];
}

/**
 * The Comptable tab's collections, as report payments and notices:
 *   - an IF / IRL declaration with an amount to pay is a notice; once the bank
 *     confirmed its payment, that confirmation is a payment;
 *   - a note de perception is a notice for the amount taxed, due by the
 *     ordonnateur's date; once its payment is confirmed, it is a payment.
 */
export function comptableLedger(input: {
  confirmations: BankConfirmation[];
  fonciers: FoncierCalculation[];
  locatifs: TaxCalculation[];
  notes: NotePerception[];
  businesses: Business[];
}): ComptableLedger {
  const resolve = makeResolver(input.businesses);
  const payments: Payment[] = [];
  const assessments: Assessment[] = [];
  const confirmed = new Map(input.confirmations.map((c) => [c.id, c]));

  // Declarations — foncier.
  for (const f of input.fonciers) {
    const tp = resolve(f.bailleurId, f.bailleurNif, f.bailleurName);
    const name = f.bailleurName || tp?.businessName || 'Non renseigné';
    const c = confirmed.get(confirmationId('foncier', f.id));
    if (f.totalImpotDuUSD > 0) {
      assessments.push(
        noticeRecord({
          id: `decl_foncier_${f.id}`,
          number: `IF-${f.id.slice(0, 8)}`,
          taxTypeCode: 'IF',
          taxpayer: tp,
          taxpayerName: name,
          amountDueUSD: f.totalImpotDuUSD,
          paidUSD: c ? c.amountUSD : 0,
          issuedAt: f.createdAt,
        })
      );
    }
  }
  // Declarations — locatif (the amount due is the solde à payer).
  for (const l of input.locatifs) {
    const tp = resolve(
      l.contribuableType === 'bailleur' ? l.contribuableRefId : undefined,
      l.contribuableNif,
      l.contribuableName
    );
    const name = l.contribuableName || tp?.businessName || 'Non renseigné';
    const c = confirmed.get(confirmationId('locatif', l.id));
    if (l.soldeUSD > 0) {
      assessments.push(
        noticeRecord({
          id: `decl_locatif_${l.id}`,
          number: `IRL-${l.id.slice(0, 8)}`,
          taxTypeCode: 'IRL',
          taxpayer: tp,
          taxpayerName: name,
          amountDueUSD: l.soldeUSD,
          paidUSD: c ? c.amountUSD : 0,
          issuedAt: l.createdAt,
        })
      );
    }
  }
  // The bank's confirmations of those declarations — the money received.
  const fonciersById = new Map(input.fonciers.map((f) => [f.id, f]));
  const locatifsById = new Map(input.locatifs.map((l) => [l.id, l]));
  for (const c of input.confirmations) {
    let tp: Business | undefined;
    if (c.kind === 'foncier') {
      const f = fonciersById.get(c.calculationId);
      tp = resolve(f?.bailleurId, c.contribuableNif || f?.bailleurNif, c.contribuableName);
    } else {
      const l = locatifsById.get(c.calculationId);
      tp = resolve(l?.contribuableType === 'bailleur' ? l.contribuableRefId : undefined, c.contribuableNif, c.contribuableName);
    }
    payments.push(
      paymentRecord({
        id: `bank_${c.id}`,
        receiptNumber: receiptNumberOf(c),
        taxTypeCode: c.kind === 'foncier' ? 'IF' : 'IRL',
        taxpayer: tp,
        taxpayerName: c.contribuableName,
        amountUSD: c.amountUSD,
        methodLabel: c.modePaiement,
        confirmedAt: c.confirmedAt,
        confirmedByUid: c.confirmedByUid,
        confirmedByName: c.confirmedByName,
      })
    );
  }

  // Notes de perception.
  for (const n of input.notes) {
    if (!n.taxateur || /^NP-DEMO-/i.test(n.taxateur.numeroFacture || '')) continue;
    const t = n.taxateur;
    const tp = resolve(t.contribuableId, t.contribuableNif, t.contribuableName);
    const name = t.contribuableName || tp?.businessName || 'Non renseigné';
    const paid = n.confirmation && n.comptable ? montantPaiementUSD(n.comptable) : 0;
    if ((t.montantUSD || 0) > 0) {
      assessments.push(
        noticeRecord({
          id: `np_${n.id}`,
          number: t.numeroFacture,
          taxTypeCode: 'NP',
          taxpayer: tp,
          taxpayerName: name,
          amountDueUSD: t.montantUSD,
          // Only the amount actually recorded can reduce the balance.
          paidUSD: paid,
          issuedAt: t.filledAt || n.createdAt,
          dueDate: n.ordonnateur?.paiementAuPlusTardLe,
        })
      );
    }
    if (n.confirmation && n.comptable) {
      payments.push(
        paymentRecord({
          id: `np_${n.id}`,
          receiptNumber: receiptNumberOf({
            id: `notePerception_${n.id}`,
            receiptNumber: n.confirmation.receiptNumber,
            confirmedAt: n.confirmation.confirmedAt,
          }),
          taxTypeCode: 'NP',
          taxpayer: tp,
          taxpayerName: name,
          amountUSD: paid,
          amountDueUSD: t.montantUSD,
          methodLabel: n.comptable.modePaiement,
          confirmedAt: n.confirmation.confirmedAt,
          confirmedByUid: n.confirmation.confirmedByUid,
          confirmedByName: n.confirmation.confirmedByName,
        })
      );
    }
  }

  return { payments, assessments };
}
