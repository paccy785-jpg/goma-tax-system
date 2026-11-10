import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Business, PropertyParcel, RentalLease, UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { PROPERTY_PARCELS_COLLECTION } from './parcelService';
import { PROPERTY_LEASES_COLLECTION } from './leaseService';

/**
 * Transfers of property ownership — a declared property moving from one
 * taxpayer to another (sale, donation, succession).
 *
 * A transfer does three things in one atomic write, so the registers never
 * disagree with each other halfway through:
 *   1. the property's declaration is re-assigned to the new owner;
 *   2. optionally, the leases on it follow, so the new owner becomes bailleur;
 *   3. a transfer record is filed — the permanent history of who owned it.
 *
 * Tax calculations already saved stay with the owner they were filed for: they
 * are the record of what was due while that person owned the property.
 * Transfer records are final — the Firestore rules allow create and read only.
 */
export const PROPERTY_TRANSFERS_COLLECTION = 'propertyTransfers';

export type MutationKind = 'vente' | 'donation' | 'succession' | 'autre';

export const MUTATION_KIND_LABELS: Record<MutationKind, string> = {
  vente: 'Vente',
  donation: 'Donation',
  succession: 'Succession',
  autre: 'Autre',
};
export const MUTATION_KINDS: MutationKind[] = ['vente', 'donation', 'succession', 'autre'];

export interface TransferParty {
  id: string;
  name: string;
  nif?: string;
}

export interface PropertyTransfer {
  id: string;
  parcelId: string;
  /** The property as declared at the moment of transfer. */
  nature?: string;
  villeTerritoire?: string;
  communeChefferie?: string;
  quartierGroupement?: string;
  avenueLocalite?: string;
  numeroParcelle?: string;
  /** Ancien propriétaire. */
  from: TransferParty;
  /** Nouveau propriétaire. */
  to: TransferParty;
  kind: MutationKind;
  /** YYYY-MM-DD the ownership changed. */
  dateMutation: string;
  /** Acte reference — only on transfers recorded before the field was removed. */
  reference?: string;
  /** Sale price, when there was one. */
  prixUSD?: number;
  notes?: string;
  /** Leases that moved to the new owner with the property. */
  leasesTransferred: number;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface TransferInput {
  parcel: PropertyParcel;
  to: Business;
  kind: MutationKind;
  dateMutation: string;
  /** Move the leases on the property to the new owner too. */
  moveLeases: boolean;
}

const party = (b: Pick<Business, 'id' | 'businessName' | 'nif'>): TransferParty => ({
  id: b.id,
  name: (b.businessName || '').trim(),
  ...(b.nif?.trim() ? { nif: b.nif.trim() } : {}),
});

/**
 * Live leases on one property — ended tenancies excluded.
 *
 * A locataire who has been removed from the property does not follow it to the
 * new owner, so a vacated lease is left out of a transfer entirely.
 */
export async function getLeasesForParcel(parcelId: string): Promise<RentalLease[]> {
  const snap = await getDocs(
    query(collection(db, PROPERTY_LEASES_COLLECTION), where('parcelId', '==', parcelId))
  );
  return snap.docs
    .map((d) => ({ ...(d.data() as RentalLease), id: d.id }))
    .filter((l) => !l.vacatedAt);
}

export async function transferProperty(
  input: TransferInput,
  fromOwner: Pick<Business, 'id' | 'businessName' | 'nif'>,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<PropertyTransfer> {
  const { to } = input;
  const dateMutation = input.dateMutation.trim();

  if (!input.parcel?.id) throw new Error('Sélectionnez la propriété à transférer.');
  if (!to?.id) throw new Error('Sélectionnez le nouveau propriétaire.');
  if (to.id === fromOwner.id) throw new Error('Le nouveau propriétaire doit être différent de l’actuel.');
  if (!MUTATION_KIND_LABELS[input.kind]) throw new Error('Choisissez la nature de la mutation.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateMutation)) throw new Error('Saisissez la date de la mutation.');

  // Re-read the property: it must still belong to the owner shown on screen,
  // so two officers cannot transfer the same property twice.
  const parcelRef = doc(db, PROPERTY_PARCELS_COLLECTION, input.parcel.id);
  const fresh = await getDoc(parcelRef);
  if (!fresh.exists()) throw new Error('Cette propriété n’existe plus dans le registre.');
  const current = { ...(fresh.data() as PropertyParcel), id: fresh.id };
  if ((current.ownerTaxpayerId || '') !== fromOwner.id) {
    throw new Error(
      `Cette propriété n’appartient plus à ${fromOwner.businessName} — elle a déjà été transférée. Actualisez la page.`
    );
  }

  const leases = input.moveLeases ? await getLeasesForParcel(current.id) : [];
  const toParty = party(to);
  const fromParty = party(fromOwner);

  const now = Date.now();
  const id: string = intentId('trf', 'transfer.apply', [
    current.id,
    to.id,
    input.kind,
    dateMutation,
    actor.uid,
  ]);
  const transfer: PropertyTransfer = {
    id,
    parcelId: current.id,
    ...(current.nature ? { nature: current.nature } : {}),
    ...(current.villeTerritoire ? { villeTerritoire: current.villeTerritoire } : {}),
    ...(current.communeChefferie ? { communeChefferie: current.communeChefferie } : {}),
    ...(current.quartierGroupement ? { quartierGroupement: current.quartierGroupement } : {}),
    ...(current.avenueLocalite ? { avenueLocalite: current.avenueLocalite } : {}),
    ...(current.numeroParcelle?.trim() || current.rang?.trim()
      ? { numeroParcelle: (current.numeroParcelle?.trim() || current.rang.trim()) }
      : {}),
    from: fromParty,
    to: toParty,
    kind: input.kind,
    dateMutation,
    leasesTransferred: leases.length,
    createdAt: new Date(now).toISOString(),
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };

  const batch = writeBatch(db);
  batch.update(parcelRef, { ownerTaxpayerId: toParty.id, ownerName: toParty.name });
  leases.forEach((l) =>
    batch.update(doc(db, PROPERTY_LEASES_COLLECTION, l.id), {
      bailleurId: toParty.id,
      bailleurName: toParty.name,
    })
  );
  batch.set(doc(db, PROPERTY_TRANSFERS_COLLECTION, transfer.id), transfer);
  await batch.commit();

  const parcelLabel = transfer.numeroParcelle ? `parcelle ${transfer.numeroParcelle}` : current.id;
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'TRANSFER_PROPERTY',
    'PropertyTransfer',
    transfer.id,
    `Transfert de propriété (${MUTATION_KIND_LABELS[input.kind]}) — ${parcelLabel} (${[
      current.quartierGroupement,
      current.communeChefferie,
    ]
      .filter(Boolean)
      .join(', ')}) : ${fromParty.name} → ${toParty.name}, le ${dateMutation}` +
      (leases.length ? `, ${leases.length} bail(aux) transféré(s)` : '') +
      '.',
    { ownerTaxpayerId: fromParty.id, ownerName: fromParty.name },
    { ownerTaxpayerId: toParty.id, ownerName: toParty.name }
  ).catch(() => {});

  return transfer;
}

/** Live transfer history, newest first. */
export function subscribeToTransfers(
  onData: (rows: PropertyTransfer[]) => void,
  onError?: (err: unknown) => void,
  limitCount = 500
): Unsubscribe {
  const q = query(collection(db, PROPERTY_TRANSFERS_COLLECTION), orderBy('createdAt', 'desc'), limit(limitCount));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as PropertyTransfer), id: d.id }))),
    (err) => {
      console.warn('[Transfers] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
