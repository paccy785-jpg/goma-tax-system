import {
  collection,
  documentId,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PropertyParcel, UserRole } from '../types';
import { logAuditEvent } from './dbService';

/**
 * The cadastral register — declared properties, stored on the server.
 *
 * A parcel declaration is a fiscal filing: it is the evidence behind an Impôt
 * Foncier notice. It belongs in Firestore like every other record here, not in a
 * browser's memory, where a refresh would erase the declaration while any notice
 * raised from it survived.
 */
export const PROPERTY_PARCELS_COLLECTION = 'propertyParcels';

/**
 * Live cadastral register.
 *
 * Ordered by document id descending: parcel ids are time-prefixed
 * (`par_<base36 time>_<random>`), so that order is newest-first and the limit
 * window keeps recent declarations instead of an arbitrary subset. Requires the
 * `__name__ DESC` index declared in firestore.indexes.json, exactly like the
 * businesses and assessments listeners.
 */
export function subscribeToParcels(
  onData: (parcels: PropertyParcel[]) => void,
  onError?: (err: unknown) => void,
  limitCount = 100
): Unsubscribe {
  const q = query(
    collection(db, PROPERTY_PARCELS_COLLECTION),
    orderBy(documentId(), 'desc'),
    limit(limitCount)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      // Pin the document id onto the record: a legacy declaration may have been
      // written without an `id` field, and an amendment must still target it.
      onData(snapshot.docs.map((d) => ({ ...(d.data() as PropertyParcel), id: d.id })));
    },
    (err) => {
      console.warn('[Parcels] Register listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}

/**
 * Every declaration filed against one contributor.
 *
 * The equality filter is the authoritative taxpayer-to-asset link, so a dossier
 * never has to load the whole cadastre and guess by owner name. Firestore serves
 * a single-field equality query from its automatic index; the newest-first order
 * is applied here so no composite index is required.
 */
export function subscribeToParcelsByOwner(
  ownerTaxpayerId: string,
  onData: (parcels: PropertyParcel[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const q = query(
    collection(db, PROPERTY_PARCELS_COLLECTION),
    where('ownerTaxpayerId', '==', ownerTaxpayerId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const parcels = snapshot.docs
        .map((d) => ({ ...(d.data() as PropertyParcel), id: d.id }))
        .sort(
          (a, b) =>
            (b.registeredAt || '').localeCompare(a.registeredAt || '') ||
            b.id.localeCompare(a.id)
        );
      onData(parcels);
    },
    (err) => {
      console.warn('[Parcels] Owner register listener error:', err);
      onError?.(err);
      onData([]);
    }
  );
}

/**
 * File or amend one parcel declaration. The id is minted by the form for a new
 * declaration and preserved when editing, so saving the same object again
 * overwrites that declaration rather than duplicating it.
 */
export async function savePropertyParcel(
  parcel: PropertyParcel,
  actor: { uid: string; displayName: string; role: UserRole },
  mode: 'create' | 'update' = 'create'
): Promise<void> {
  await setDoc(doc(db, PROPERTY_PARCELS_COLLECTION, parcel.id), parcel);

  const verb = mode === 'update' ? 'amended' : 'filed';
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    mode === 'update' ? 'UPDATE_PROPERTY_PARCEL' : 'CREATE_PROPERTY_PARCEL',
    'PropertyParcel',
    parcel.id,
    `Cadastral declaration ${verb} for parcel ${parcel.numeroParcelle || parcel.rang} (${parcel.quartierGroupement}, ${parcel.communeChefferie}) — ${parcel.nature}, usage ${parcel.usage}.`
  ).catch(() => {});
}
