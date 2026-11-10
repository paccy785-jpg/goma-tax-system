import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  Firestore,
  doc,
  getDocFromServer
} from 'firebase/firestore';
import { emitGlobalToast } from '../contexts/ToastContext';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App instance safely
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// ---------------------------------------------------------------------------
// One database per portal
//
// The DPRNK and DGI portals keep their data in two separate Firestore
// databases of the same project: their own taxpayers, their own user accounts
// (users/{uid}), their own settings, audit log and counters. Nothing one portal
// files is visible in the other.
//
// The portal is chosen by the URL (`?portal=dgi`) when the page loads, and
// switching portal reloads the page, so every service that imports `db` works
// on the active portal's database without knowing there is another one.
// ---------------------------------------------------------------------------

export type DatabasePortal = 'dprnk' | 'dgi';

/** The DPRNK database — the one the app has always used. */
export const DPRNK_DATABASE_ID: string = firebaseConfig.firestoreDatabaseId;
/** The DGI portal's own database. */
export const DGI_DATABASE_ID = 'goma-tax-system-dgi';

/** The portal this page was loaded for. */
export const ACTIVE_PORTAL: DatabasePortal = (() => {
  try {
    return new URLSearchParams(window.location.search).get('portal') === 'dgi' ? 'dgi' : 'dprnk';
  } catch {
    return 'dprnk';
  }
})();

/** The database of the active portal — the one `db` is. */
export const ACTIVE_DATABASE_ID: string = ACTIVE_PORTAL === 'dgi' ? DGI_DATABASE_ID : DPRNK_DATABASE_ID;

// Initialize Cloud Firestore with Offline Persistence enabled
let firestoreInstance: Firestore;

// Firestore rejects writes containing `undefined` field values unless
// `ignoreUndefinedProperties` is set ("Unsupported field value: undefined").
// This app builds documents from interfaces with many optional fields, so an
// absent value is routinely written as `undefined` — e.g. a payment taken
// outside an open cash shift writes `sessionId: undefined`, which aborted the
// whole receipt transaction. Omitting those keys is the intended behaviour.
const FIRESTORE_SETTINGS = { ignoreUndefinedProperties: true };

try {
  firestoreInstance = initializeFirestore(
    app,
    {
      ...FIRESTORE_SETTINGS,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    ACTIVE_DATABASE_ID
  );
  console.log('[Firestore] Offline persistence initialized with multi-tab manager');
} catch (err: unknown) {
  console.warn('[Firestore] Multi-tab persistence fallback to standard instance:', err);
  // Persistence can be unavailable (private-mode IndexedDB, sandboxed iframe).
  // Retry without it so ignoreUndefinedProperties still applies; getFirestore()
  // takes no settings, so it is only the last resort.
  try {
    firestoreInstance = initializeFirestore(
      app,
      FIRESTORE_SETTINGS,
      ACTIVE_DATABASE_ID
    );
  } catch {
    firestoreInstance = getFirestore(app, ACTIVE_DATABASE_ID);
  }
}

export const db = firestoreInstance;

/**
 * The OTHER portal's database, opened on demand without offline cache. Used
 * only to tell, when an account has no profile here, whether it is an account
 * of the other portal (which must not be given access here automatically).
 */
let otherPortalInstance: Firestore | null = null;
export function otherPortalDb(): Firestore {
  if (!otherPortalInstance) {
    const id = ACTIVE_PORTAL === 'dgi' ? DPRNK_DATABASE_ID : DGI_DATABASE_ID;
    try {
      otherPortalInstance = initializeFirestore(app, FIRESTORE_SETTINGS, id);
    } catch {
      otherPortalInstance = getFirestore(app, id);
    }
  }
  return otherPortalInstance;
}

// ---------------------------------------------------------------------------
// Error classification
//
// Firestore is the only store in this app. A refused write is reported to the
// officer as a failure, never quietly redirected to on-device storage: data an
// officer believes is filed but that exists only in one browser is worse than a
// visible error. (Offline resilience is still real — the SDK's persistent local
// cache in this file queues genuine network-loss writes and replays them.)
// ---------------------------------------------------------------------------

export function isPermissionDeniedError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'permission-denied' ||
    code === 7 ||
    /missing or insufficient permissions/i.test(message)
  );
}

// SKILL REQUIRED: Validate connection to Firestore
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('[Firestore] Connection to server validated successfully');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Firestore] The client is offline. Local persistent cache will serve reads/writes.');
      return;
    }
    // Every other failure used to be swallowed: a wrong API key, a database id
    // that does not exist, or rules that refuse the probe document left the
    // office with a silent startup and a blank register, and nothing in the
    // console to act on. The probe runs on every page load, so the diagnostic
    // is the only warning anybody gets before the first write fails.
    const code = (error as { code?: string })?.code;
    console.error(
      `[Firestore] Connection test failed${code ? ` (${code})` : ''}.`,
      error
    );
  }
}

// Execute connection test on startup
testConnection();

// SKILL REQUIRED: Structured Firestore error handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  try {
    emitGlobalToast(
      `Firestore ${operationType} on ${path || 'record'}: ${errMsg}`,
      'error',
      'Database Error'
    );
  } catch {}
  // Throw a human-readable message — a raw JSON dump ends up in UI error
  // boxes (e.g. the login screen). The full detail stays in console.error.
  //
  // The Firestore code is carried over to the thrown error: it is what tells a
  // refused write from an unreachable one, and `isPermissionDeniedError` reads
  // it. A fresh Error dropped it, so the one classifier this file exports
  // could never recognise an error that came through here.
  const thrown = new Error(`Database ${operationType} failed${path ? ` (${path})` : ''}: ${errMsg}`);
  const code = (error as { code?: unknown })?.code;
  if (code !== undefined) {
    (thrown as Error & { code?: unknown }).code = code;
  }
  throw thrown;
}
