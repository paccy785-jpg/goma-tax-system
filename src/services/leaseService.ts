import {
  collection,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  deleteField,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { RentalLease, UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { AddLeaseInput, buildLease, buildLeaseForNextPeriod, isLeaseTermsLocked, isLeaseVacated, NextPeriodInput } from './leaseRecord';
import { formatMoney } from '../utils/money';

/**
 * The lease register — tenancies declared against declared property.
 *
 * A lease is the evidence behind an IRL assessment, so it belongs on the
 * server beside the cadastral declaration it points at: a browser's memory
 * would lose the tenancy on refresh while the assessment it justified
 * survived.
 *
 * The record shape itself lives in `leaseRecord.ts` — pure and testable, so the
 * card-to-column mapping is asserted rather than assumed. This module is only
 * the persistence around it.
 */
export const PROPERTY_LEASES_COLLECTION = 'propertyLeases';

/**
 * Live lease register.
 *
 * Ordered by document id descending: lease ids are time-prefixed
 * (`lea_<base36 time>_<random>`), so that order is newest-first and the limit
 * window keeps recent tenancies instead of an arbitrary subset. Requires the
 * `__name__ DESC` index declared in firestore.indexes.json, exactly like the
 * parcels, businesses and assessments listeners.
 */
export function subscribeToLeases(
  onData: (leases: RentalLease[]) => void,
  onError?: (err: unknown) => void,
  limitCount: number | null = null
): Unsubscribe {
  const q = query(
    collection(db, PROPERTY_LEASES_COLLECTION),
    orderBy(documentId(), 'desc'),
    ...(limitCount === null ? [] : [limit(limitCount)])
  );
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => ({ ...(d.data() as RentalLease), id: d.id })));
    },
    (err) => {
      console.warn('[Leases] Register listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}

/**
 * File one tenancy against a declared property.
 *
 * The locataires and the parcel are the only required inputs: everything the
 * register prints about the property is copied from the parcel by `buildLease`,
 * so the row is complete the moment it is saved.
 */
export async function addLease(
  input: AddLeaseInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<RentalLease> {
  const lease = buildLease(
    input,
    intentId('lea', 'lease.add', [
      input.parcel.id,
      input.tenantNames,
      input.startDate,
      input.endDate,
      input.monthlyRentUSD,
      input.exercice,
      actor.uid,
    ]),
    actor.displayName
  );

  await setDoc(doc(db, PROPERTY_LEASES_COLLECTION, lease.id), lease);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_LEASE',
    'Lease',
    lease.id,
    `Bail enregistré — locataire(s) ${lease.tenantNames.join(', ')} sur parcelle ${
      lease.numeroParcelle || lease.rang
    } (${lease.quartierGroupement}, ${lease.communeChefferie}) — ${lease.nature}` +
      (lease.bailleurName ? `, bailleur ${lease.bailleurName}` : '') +
      (lease.monthlyRentUSD > 0
        ? ` Loyer mensuel ${formatMoney(lease.monthlyRentUSD)}.`
        : ' Loyer non encore chiffré.')
  ).catch(() => {});

  return lease;
}

/** Période de location and loyer mensuel of a lease already on file. */
export interface LeaseTermsInput {
  /** YYYY-MM-DD, or empty to clear. */
  startDate: string;
  /** YYYY-MM-DD, or empty while the tenancy is open-ended. */
  endDate: string;
  /** Monthly rent in USD; 0 while not entered. */
  monthlyRentUSD: number;
}

/**
 * Record the period and the rent of a lease filed before they were known.
 *
 * Cleared dates are deleted from the document rather than written as empty
 * strings, so the revenue math keeps treating them as "not entered".
 */
export async function updateLeaseTerms(
  lease: RentalLease,
  terms: LeaseTermsInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  if (isLeaseTermsLocked(lease)) {
    throw new Error('La période et le loyer de ce bail sont verrouillés et ne peuvent plus être modifiés.');
  }
  const startDate = terms.startDate.trim();
  const endDate = terms.endDate.trim();
  const monthlyRentUSD =
    Number.isFinite(terms.monthlyRentUSD) && terms.monthlyRentUSD > 0
      ? Math.round(terms.monthlyRentUSD * 100) / 100
      : 0;
  // Saving locks the terms, so they must be complete: a start date and a rent.
  if (!startDate) throw new Error('Saisissez la date de début de la location.');
  if (monthlyRentUSD <= 0) throw new Error('Saisissez le loyer mensuel.');
  if (startDate && endDate && endDate < startDate) {
    throw new Error('La date de fin précède la date de début.');
  }

  await updateDoc(doc(db, PROPERTY_LEASES_COLLECTION, lease.id), {
    startDate,
    endDate: endDate || deleteField(),
    monthlyRentUSD,
    termsLockedAt: new Date().toISOString(),
    termsLockedByName: actor.displayName,
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'UPDATE_LEASE',
    'Lease',
    lease.id,
    `Bail verrouillé — ${lease.tenantNames.join(', ')} : période ${startDate || '—'} → ${
      endDate || 'en cours'
    }, loyer mensuel ${formatMoney(monthlyRentUSD)}.`,
    {
      startDate: lease.startDate || null,
      endDate: lease.endDate || null,
      monthlyRentUSD: lease.monthlyRentUSD || 0,
    },
    { startDate: startDate || null, endDate: endDate || null, monthlyRentUSD }
  ).catch(() => {});
}

/**
 * File the next période de location of a tenancy already on the register.
 *
 * This **creates a new lease** and never touches the existing one. The période
 * drives the revenu brut, so an already-assessed record must stay exactly as it
 * was filed; a second declaration is a second record, chained by
 * `previousLeaseId`. The old lease is only read — its locked terms are never
 * rewritten, and the Firestore rules would refuse it anyway.
 */
export async function adjustLeasePeriod(
  previous: RentalLease,
  terms: NextPeriodInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<RentalLease> {
  const lease = buildLeaseForNextPeriod(
    previous,
    terms,
    intentId('lea', 'lease.nextPeriod', [
      previous.id,
      terms.startDate,
      terms.endDate,
      terms.monthlyRentUSD,
      actor.uid,
    ]),
    actor.displayName
  );

  await setDoc(doc(db, PROPERTY_LEASES_COLLECTION, lease.id), lease);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_LEASE',
    'Lease',
    lease.id,
    `Ajustement de période — nouveau bail pour ${lease.tenantNames.join(', ')} sur parcelle ${
      lease.numeroParcelle || lease.rang
    } : ${lease.startDate} → ${lease.endDate || 'en cours'}, loyer mensuel ${formatMoney(
      lease.monthlyRentUSD
    )}. Suite du bail ${previous.id} (${previous.startDate || '—'} → ${
      previous.endDate || 'en cours'
    }), laissé inchangé.`,
    undefined,
    {
      previousLeaseId: previous.id,
      startDate: lease.startDate || null,
      endDate: lease.endDate || null,
      monthlyRentUSD: lease.monthlyRentUSD,
    }
  ).catch(() => {});

  return lease;
}

/** Recorded when a locataire is removed from a property. */
export interface EndLeaseInput {
  /** YYYY-MM-DD the locataire left, when known; empty if not recorded. */
  moveOutDate?: string;
  /** Optional note — e.g. the locataire moved to another bailleur. */
  reason?: string;
}

/**
 * Remove a locataire from a property — end the tenancy.
 *
 * The lease is **not deleted**: it is the evidence behind an IRL assessment, and
 * the Firestore rules forbid erasing it. Instead the record is stamped as
 * vacated, so the register keeps the row but reads it as ended. The locataire is
 * then free to be registered on another property, under another bailleur, at any
 * later time — that is a brand-new lease, filed from the rental register.
 *
 * Only the `vacated*` keys are written, never the locked période / loyer, so the
 * update passes the rules even for a lease whose terms are already locked.
 */
export async function endLease(
  lease: RentalLease,
  input: EndLeaseInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  if (isLeaseVacated(lease)) {
    throw new Error('Ce locataire a déjà été retiré de cette propriété.');
  }
  const moveOutDate = (input.moveOutDate || '').trim();
  if (moveOutDate && !/^\d{4}-\d{2}-\d{2}$/.test(moveOutDate)) {
    throw new Error('La date de départ est invalide.');
  }
  if (moveOutDate && lease.startDate && moveOutDate < lease.startDate) {
    throw new Error('La date de départ précède le début du bail.');
  }
  const reason = (input.reason || '').trim();

  const patch: Record<string, unknown> = {
    vacatedAt: new Date().toISOString(),
    vacatedByName: actor.displayName,
  };
  if (moveOutDate) patch.moveOutDate = moveOutDate;
  if (reason) patch.vacatedReason = reason;

  await updateDoc(doc(db, PROPERTY_LEASES_COLLECTION, lease.id), patch);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'UPDATE_LEASE',
    'Lease',
    lease.id,
    `Locataire retiré — ${lease.tenantNames.join(', ')} retiré de la parcelle ${
      lease.numeroParcelle || lease.rang
    } (${lease.quartierGroupement}, ${lease.communeChefferie})` +
      (lease.bailleurName ? `, bailleur ${lease.bailleurName}` : '') +
      (moveOutDate ? `, départ le ${moveOutDate}` : '') +
      (reason ? `. Motif : ${reason}` : '') +
      '. Le bail reste au registre comme pièce de la déclaration.',
    undefined,
    { vacatedAt: patch.vacatedAt, moveOutDate: moveOutDate || null }
  ).catch(() => {});
}

export {
  buildLease,
  normalizeTenantNames,
  isLeaseTermsLocked,
  isLeaseVacated,
  buildLeaseForNextPeriod,
  periodsOverlap,
} from './leaseRecord';
export type { AddLeaseInput, NextPeriodInput } from './leaseRecord';