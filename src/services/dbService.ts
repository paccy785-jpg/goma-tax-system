import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  documentId,
  runTransaction,
  deleteDoc,
  onSnapshot,
  getCountFromServer,
  type Unsubscribe
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import { 
  UserProfile, 
  Taxpayer, 
  Assessment, 
  AssessmentStatus,
  Payment, 
  PaymentType,
  PaymentMethod,
  ReceiptCounter, 
  AuditLog, 
  TaxRateConfig, 
  UserRole,
  Business,
  TaxRate,
  BusinessSector,
  BusinessSizeClass,
  BusinessStatus,
  normalizeSector,
  normalizeSizeClass,
  normalizeBusinessStatus,
  normalizeAssessmentStatus
} from '../types';
import { daysBetweenDates, localDateFromIsoTimestamp, shiftDateString, todayDateString } from '../utils/date';
import { formatMoney } from '../utils/money';
import { roundMoney } from '../utils/frenchNumber';
import { INTENT_BUCKET_MS, intentId, isFirstIntent } from './idempotency';

// USERS
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const path = `users/${uid}`;
  try {
    const docSnap = await getDoc(doc(db, 'users', uid));
    if (docSnap.exists()) {
      return docSnap.data() as UserProfile;
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function setUserProfile(profile: UserProfile): Promise<void> {
  const path = `users/${profile.uid}`;
  try {
    await setDoc(doc(db, 'users', profile.uid), profile, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserRole(uid: string, newRole: UserRole): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      role: newRole,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const path = 'users';
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    return snapshot.docs.map((d) => d.data() as UserProfile);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// TAX RATE CONFIGURATIONS
export const DEFAULT_TAX_RATES: TaxRateConfig[] = [
  {
    id: 'rate_cat_a',
    category: 'Category_A_Grande',
    categoryLabel: 'Category A: Large Commercial Enterprises & Hotels',
    description: 'Wholesalers, large hotels, import-export agencies, mining offices, telecommunications branches',
    annualRateUSD: 500,
    updatedBy: 'Admin - Urban Revenue Division',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rate_cat_b',
    category: 'Category_B_Moyenne',
    categoryLabel: 'Category B: Medium Businesses & Bakeries',
    description: 'Pharmacies, supermarkets, automotive repair workshops, restaurants, printing presses',
    annualRateUSD: 250,
    updatedBy: 'Admin - Urban Revenue Division',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rate_cat_c',
    category: 'Category_C_Petite',
    categoryLabel: 'Category C: Small Retail & Services',
    description: 'Alimentations, hair salons, tailoring workshops, cybercafes, hardware stores',
    annualRateUSD: 100,
    updatedBy: 'Admin - Urban Revenue Division',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rate_cat_d',
    category: 'Category_D_Micro',
    categoryLabel: 'Category D: Micro-enterprises & Kiosks',
    description: 'Corner kiosks, mobile money stalls, market vendors with fixed tables',
    annualRateUSD: 40,
    updatedBy: 'Admin - Urban Revenue Division',
    updatedAt: new Date().toISOString(),
  },
];

export async function getTaxRateConfigs(): Promise<TaxRateConfig[]> {
  const path = 'taxRateConfigs';
  try {
    const snapshot = await getDocs(collection(db, 'taxRateConfigs'));
    if (snapshot.empty) {
      // Seed default rates
      for (const rate of DEFAULT_TAX_RATES) {
        await setDoc(doc(db, 'taxRateConfigs', rate.id), rate);
      }
      return DEFAULT_TAX_RATES;
    }
    return snapshot.docs.map((d) => d.data() as TaxRateConfig);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function updateTaxRate(config: TaxRateConfig): Promise<void> {
  const path = `taxRateConfigs/${config.id}`;
  try {
    await setDoc(doc(db, 'taxRateConfigs', config.id), {
      ...config,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ============================================================================
// PHASE 3: PATENTE RATE SCHEDULE (/taxRates/{rateId}) WITH VERSIONING
// ============================================================================

export const DEFAULT_PATENTE_RATES: TaxRate[] = [
  // Commerce
  {
    id: 'rate_commerce_petite_v1',
    activitySector: 'Commerce',
    sizeClass: 'Small',
    annualFeeUSD: 60,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Retail boutiques, neighborhood fresh produce and clothing stores',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_commerce_moyenne_v1',
    activitySector: 'Commerce',
    sizeClass: 'Medium',
    annualFeeUSD: 150,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Mini-markets, semi-wholesalers, hardware shops',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_commerce_grande_v1',
    activitySector: 'Commerce',
    sizeClass: 'Large',
    annualFeeUSD: 350,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Large supermarkets, import and distribution centers',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },

  // Food Service
  {
    id: 'rate_restauration_petite_v1',
    activitySector: 'Food Service',
    sizeClass: 'Small',
    annualFeeUSD: 80,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Cafeterias, modest snack bars, quick bites',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_restauration_moyenne_v1',
    activitySector: 'Food Service',
    sizeClass: 'Medium',
    annualFeeUSD: 200,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Gastronomic restaurants, air-conditioned lounges, motels',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_restauration_grande_v1',
    activitySector: 'Food Service',
    sizeClass: 'Large',
    annualFeeUSD: 450,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'High-end hotels with catering services and banquet halls',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },

  // Services
  {
    id: 'rate_services_petite_v1',
    activitySector: 'Services',
    sizeClass: 'Small',
    annualFeeUSD: 75,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Public secretarial offices, cybercafes, local money exchange points',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_services_moyenne_v1',
    activitySector: 'Services',
    sizeClass: 'Medium',
    annualFeeUSD: 180,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Neighborhood medical practices, travel agencies, accounting firms',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_services_grande_v1',
    activitySector: 'Services',
    sizeClass: 'Large',
    annualFeeUSD: 400,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Private clinics, real estate and financial agency headquarters',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },

  // Crafts
  {
    id: 'rate_artisanat_petite_v1',
    activitySector: 'Crafts',
    sizeClass: 'Small',
    annualFeeUSD: 40,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Sewing shops, cobblers, neighborhood hair salons',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_artisanat_moyenne_v1',
    activitySector: 'Crafts',
    sizeClass: 'Medium',
    annualFeeUSD: 90,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Machine-equipped carpentry shops, metalwork and welding workshops',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_artisanat_grande_v1',
    activitySector: 'Crafts',
    sizeClass: 'Large',
    annualFeeUSD: 200,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Large artisanal furniture workshops and stone yards',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },

  // Industry
  {
    id: 'rate_industrie_petite_v1',
    activitySector: 'Industry',
    sizeClass: 'Small',
    annualFeeUSD: 120,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Flour mills, local ice-making facilities',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_industrie_moyenne_v1',
    activitySector: 'Industry',
    sizeClass: 'Medium',
    annualFeeUSD: 300,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Semi-industrial bakeries, soap works, water packaging plants',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_industrie_grande_v1',
    activitySector: 'Industry',
    sizeClass: 'Large',
    annualFeeUSD: 700,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Heavy processing industrial units, industrial grain mills',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },

  // Other
  {
    id: 'rate_autre_petite_v1',
    activitySector: 'Other',
    sizeClass: 'Small',
    annualFeeUSD: 50,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Miscellaneous commercial activities and fixed stalls',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_autre_moyenne_v1',
    activitySector: 'Other',
    sizeClass: 'Medium',
    annualFeeUSD: 120,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'Logistics and intermediary courier services',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'rate_autre_grande_v1',
    activitySector: 'Other',
    sizeClass: 'Large',
    annualFeeUSD: 250,
    effectiveStartDate: '2026-01-01',
    effectiveEndDate: null,
    version: 1,
    isActive: true,
    legalBasis: 'Urban Decree N° 01/2026 City of Goma - Annual Business License Tax (Patente) Schedule',
    notes: 'General warehouses and multi-purpose logistics platforms',
    createdBy: 'admin_goma',
    createdByName: 'Revenue Department of Goma',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
];

export async function getTaxRates(onlyActive: boolean = false): Promise<TaxRate[]> {
  const path = 'taxRates';
  try {
    const snapshot = await getDocs(collection(db, 'taxRates'));
    let rates: TaxRate[] = [];

    if (snapshot.empty) {
      console.log('[TaxRates] Seeding default 18 sector x size patente rate schedule...');
      for (const rate of DEFAULT_PATENTE_RATES) {
        await setDoc(doc(db, 'taxRates', rate.id), rate);
      }
      rates = [...DEFAULT_PATENTE_RATES];
    } else {
      rates = snapshot.docs.map((d) => {
      const data = d.data() as TaxRate & { annualRateUSD?: number };
      // Legacy rate docs may be missing the numeric fee fields (older
      // TaxRateConfig-shaped records) — normalize so consumers never read
      // undefined and crash on toLocaleString/fixed.
      const usd = Number(data.annualFeeUSD ?? data.annualRateUSD ?? 0) || 0;
      return {
        ...data,
        annualFeeUSD: usd,
        version: Number(data.version ?? 1) || 1,
        isActive: data.isActive !== false,
        activitySector: normalizeSector(data.activitySector),
        sizeClass: normalizeSizeClass(data.sizeClass),
      };
    });
  }

  if (onlyActive) {
    rates = rates.filter((r) => r.isActive !== false);
  }

  // Sort by sector, then size class (Small -> Medium -> Large), then version desc
  const sizeOrder: Record<string, number> = { Small: 1, Medium: 2, Large: 3, petite: 1, moyenne: 2, grande: 3 };
    return rates.sort((a, b) => {
      if (a.activitySector !== b.activitySector) {
        return a.activitySector.localeCompare(b.activitySector);
      }
      const orderA = sizeOrder[a.sizeClass] || 0;
      const orderB = sizeOrder[b.sizeClass] || 0;
      if (orderA !== orderB) return orderA - orderB;
      return (b.version || 1) - (a.version || 1);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return DEFAULT_PATENTE_RATES;
  }
}

export async function getTaxRateHistory(
  sector: BusinessSector,
  sizeClass: BusinessSizeClass
): Promise<TaxRate[]> {
  const allRates = await getTaxRates(false);
  return allRates
    .filter((r) => r.activitySector === sector && r.sizeClass === sizeClass)
    .sort((a, b) => (b.version || 1) - (a.version || 1));
}

export interface CreateTaxRateVersionParams {
  activitySector: BusinessSector;
  sizeClass: BusinessSizeClass;
  newAnnualFeeUSD: number;
  effectiveStartDate: string; // YYYY-MM-DD
  legalBasis?: string;
  notes?: string;
  userProfile: UserProfile;
}

export async function createNewTaxRateVersion(
  params: CreateTaxRateVersionParams
): Promise<{ newRate: TaxRate; supersededRate?: TaxRate }> {
  const path = 'taxRates';
  const newFeeUSD = Math.max(0, Number(params.newAnnualFeeUSD));

  try {
    // 1. Fetch current active rate for this sector + size
    const allForSector = await getTaxRateHistory(params.activitySector, params.sizeClass);
    const activeRate = allForSector.find((r) => r.isActive !== false) || allForSector[0];

    // 2. Version without overwriting: end-date previous active rate
    let supersededRate: TaxRate | undefined = undefined;
    const currentVersion = activeRate?.version || 1;
    const newVersion = currentVersion + 1;

    if (activeRate) {
      // Calculate end date as the day before the new effective start date, or same date
      // Plain string arithmetic: no Date parsing, so no UTC/local day shift.
      const endDate = shiftDateString(params.effectiveStartDate, -1) || params.effectiveStartDate;

      supersededRate = {
        ...activeRate,
        effectiveEndDate: endDate,
        isActive: false,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'taxRates', activeRate.id), {
        effectiveEndDate: endDate,
        isActive: false,
        updatedAt: new Date().toISOString(),
      });
    }

    // 3. Create brand new document in /taxRates
    // Keyed on sector + size + version, so a repeated submit refreshes the same
    // version instead of leaving two competing v-n records.
    const newRateId = `rate_${params.activitySector}_${params.sizeClass}_v${newVersion}`;
    const newRate: TaxRate = {
      id: newRateId,
      activitySector: params.activitySector,
      sizeClass: params.sizeClass,
      annualFeeUSD: newFeeUSD,
      effectiveStartDate: params.effectiveStartDate,
      effectiveEndDate: null,
      version: newVersion,
      isActive: true,
      legalBasis: params.legalBasis?.trim() || 'City of Goma Urban Decree',
      notes: params.notes?.trim() || '',
      createdBy: params.userProfile.uid,
      createdByName: params.userProfile.displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, 'taxRates', newRateId), newRate);

    // 4. Log to immutable audit trail
    await logAuditEvent(
      params.userProfile.uid,
      params.userProfile.displayName,
      params.userProfile.role,
      'VERSION_TAX_RATE',
      'TaxRate',
      newRateId,
      `New rate version v${newVersion} for "${params.activitySector}" (${params.sizeClass}) set to ${formatMoney(newFeeUSD)} effective ${params.effectiveStartDate}. Previous version v${currentVersion} (${activeRate ? '$' + activeRate.annualFeeUSD : 'n/a'} USD) archived with end date ${supersededRate?.effectiveEndDate || params.effectiveStartDate}. Previously issued assessments remain unaffected.`
    );

    return { newRate, supersededRate };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    throw err;
  }
}

export async function getActiveTaxRateFor(
  sector: BusinessSector,
  sizeClass: BusinessSizeClass,
  asOfDate?: string
): Promise<TaxRate | null> {
  const targetDate = asOfDate || todayDateString();
  const history = await getTaxRateHistory(sector, sizeClass);

  if (history.length === 0) {
    // Fallback to default
    return (
      DEFAULT_PATENTE_RATES.find(
        (r) => r.activitySector === sector && r.sizeClass === sizeClass
      ) || null
    );
  }

  // Find rate whose [effectiveStartDate, effectiveEndDate] encompasses targetDate
  const match = history.find((r) => {
    const started = !r.effectiveStartDate || r.effectiveStartDate <= targetDate;
    const notEnded = !r.effectiveEndDate || r.effectiveEndDate >= targetDate;
    return started && notEnded;
  });

  return match || history[0];
}

// BUSINESSES REGISTRY (PHASE 2)


export async function getBusinesses(): Promise<Business[]> {
  const path = 'businesses';
  try {
    const snapshot = await getDocs(collection(db, 'businesses'));
    return snapshot.docs.map((d) => {
      const data = d.data() as any;
      const normalizedStatus = normalizeBusinessStatus(data.status);
      if (data.status === 'Deregistration Pending' || data.status === 'en radiation') {
        // Automatically migrate legacy Firestore document to new canonical value
        updateDoc(doc(db, 'businesses', d.id), {
          status: 'Closure Pending',
          updatedAt: new Date().toISOString(),
        }).catch((e) => console.warn('[Migration] Note migrating doc to Closure Pending:', e));
      }
      return {
        ...data,
        activitySector: normalizeSector(data.activitySector),
        sizeClass: normalizeSizeClass(data.sizeClass),
        status: normalizedStatus,
      } as Business;
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/**
 * Active-aware real-time listener for Business Registry.
 * Bounded by Spark tier limit() and explicitly cleans up when unsubscribed.
 */
export function subscribeToBusinesses(
  onData: (businesses: Business[]) => void,
  onError?: (err: any) => void,
  limitCount: number = 100
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to businesses (limit: ${limitCount})`);
  // Order by document id (descending) so the limit window returns the newest
  // registrations rather than an arbitrary/lowest-id subset. Without an explicit
  // orderBy, Firestore returned the LOWEST ids and every business past the 100th
  // silently vanished from the registry.
  const q = query(collection(db, 'businesses'), orderBy(documentId(), 'desc'), limit(limitCount));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as any;
        const normalizedStatus = normalizeBusinessStatus(data.status);
        if (data.status === 'Deregistration Pending' || data.status === 'en radiation') {
          // Automatically migrate legacy Firestore document to new canonical value
          updateDoc(doc(db, 'businesses', d.id), {
            status: 'Closure Pending',
            updatedAt: new Date().toISOString(),
          }).catch((e) => console.warn('[Migration] Note migrating doc to Closure Pending:', e));
        }
        return {
          ...data,
          activitySector: normalizeSector(data.activitySector),
          sizeClass: normalizeSizeClass(data.sizeClass),
          status: normalizedStatus,
        } as Business;
      });

      // Sort newest first
      list.sort(
        (a, b) =>
          new Date(b.createdAt || b.registrationDate || 0).getTime() -
          new Date(a.createdAt || a.registrationDate || 0).getTime()
      );

      onData(list);
    },
    (err) => {
      // A failed listener is reported as a failure. Serving the device copy here
      // is what made a broken query look like lost data.
      console.error('[Firestore Listener] Error on businesses:', err);
      emitGlobalToast(`Error syncing businesses: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from businesses');
    unsubscribe();
  };
}

export async function getBusinessById(businessId: string): Promise<Business | null> {
  const path = `businesses/${businessId}`;
  try {
    const snap = await getDoc(doc(db, 'businesses', businessId));
    if (snap.exists()) {
      const data = snap.data() as any;
      return {
        ...data,
        activitySector: normalizeSector(data.activitySector),
        sizeClass: normalizeSizeClass(data.sizeClass),
        status: normalizeBusinessStatus(data.status),
      } as Business;
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

export async function addBusiness(business: Business): Promise<void> {
  const normalized: Business = {
    ...business,
    activitySector: normalizeSector(business.activitySector),
    sizeClass: normalizeSizeClass(business.sizeClass),
    status: normalizeBusinessStatus(business.status),
  };
  const path = `businesses/${normalized.id}`;
  await setDoc(doc(db, 'businesses', normalized.id), normalized);
}

export async function updateBusiness(
  businessId: string, 
  updates: Partial<Business>
): Promise<void> {
  const path = `businesses/${businessId}`;
  const payload: any = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  if (payload.activitySector) payload.activitySector = normalizeSector(payload.activitySector);
  if (payload.sizeClass) payload.sizeClass = normalizeSizeClass(payload.sizeClass);
  if (payload.status) payload.status = normalizeBusinessStatus(payload.status);

  await updateDoc(doc(db, 'businesses', businessId), payload);
}

/**
 * Permanently delete a business record if and only if NO active assessments exist.
 * If assessments exist, hard deletion is blocked in compliance with public revenue integrity standards.
 */
export async function deleteBusiness(
  businessId: string,
  user: { uid: string; displayName: string; role: UserRole }
): Promise<{ success: boolean; reason?: string }> {
  const path = `businesses/${businessId}`;

  // 1. Check if any assessments exist for this business
  const assessments = await getAssessments();
  const linked = assessments.filter((a) => a.businessId === businessId && a.status !== 'Cancelled');
  if (linked.length > 0) {
    throw new Error(
      `Cannot delete business: ${linked.length} active tax assessment(s) exist. In accordance with fiscal integrity regulations, records with issued assessments cannot be hard-deleted. Use Administrative Closure instead.`
    );
  }

  // 2. Delete from Firestore
  try {
    await deleteDoc(doc(db, 'businesses', businessId));

    // Also delete linked taxpayer doc if exists
    try {
      await deleteDoc(doc(db, 'taxpayers', businessId));
    } catch {}

    // Log to audit log
    await logAuditEvent(
      user.uid,
      user.displayName,
      user.role,
      'DELETE_BUSINESS',
      'Business',
      businessId,
      `Business record ${businessId} permanently deleted by ${user.displayName} (${user.role}). Record had no prior active assessments.`,
      { businessId }
    );

    return { success: true };
  } catch (err: any) {
    handleFirestoreError(err, OperationType.DELETE, path);
    throw err;
  }
}

/**
 * Flag a business "Deregistration Pending" after Admin review.
 * Updates business status, records review audit, and syncs linked taxpayer.
 */
export async function flagBusinessEnRadiation(
  businessId: string,
  adminId: string,
  adminName: string,
  reason: string,
  overdueAmountUSD?: number
): Promise<void> {
  const now = new Date().toISOString();
  // Read the record from the server: the audit entry quotes the business name,
  // its Nat ID and the status being closed, all of which must come from the
  // authoritative row rather than anything cached on this device.
  const currentBiz = await getBusinessById(businessId);
  const previousStatus = currentBiz?.status || 'Active';

  const updates: Partial<Business> = {
    status: 'Closure Pending',
    deregisteredAt: now,
    deregisteredBy: adminId,
    deregisteredByName: adminName,
    deregistrationReason: reason.trim(),
    updatedAt: now,
  };

  await updateDoc(doc(db, 'businesses', businessId), updates);

  // Also suspend linked taxpayer record if present
  try {
    await updateDoc(doc(db, 'taxpayers', businessId), {
      status: 'Suspended',
      updatedAt: now,
    });
  } catch {}

  // Log to immutable audit ledger with before/after comparison
  await logAuditEvent(
    adminId,
    adminName,
    'Admin',
    'FLAG_DEREGISTERED',
    'Deregistration',
    businessId,
    `Administrative closure notice issued for business "${currentBiz?.businessName || businessId}" (Nat ID: ${currentBiz?.nationalIdOrRccm || 'N/A'}). Reason: "${reason.trim()}". Outstanding tax debt: ${formatMoney(overdueAmountUSD || 0)}.`,
    {
      status: previousStatus,
    },
    {
      status: 'Closure Pending',
      deregisteredAt: now,
      deregisteredByName: adminName,
      deregistrationReason: reason.trim(),
      outstandingDebtUSD: overdueAmountUSD || 0,
    }
  );
}

/**
 * Restore active status for a business previously flagged "Closure Pending".
 */
export async function restoreBusinessStatus(
  businessId: string,
  adminId: string,
  adminName: string,
  reason?: string
): Promise<void> {
  const now = new Date().toISOString();
  const currentBiz = await getBusinessById(businessId);
  const previousStatus = currentBiz?.status || 'Closure Pending';

  const updates: Partial<Business> = {
    status: 'Active',
    updatedAt: now,
  };

  await updateDoc(doc(db, 'businesses', businessId), updates);

  try {
    await updateDoc(doc(db, 'taxpayers', businessId), {
      status: 'Active',
      updatedAt: now,
    });
  } catch {}

  await logAuditEvent(
    adminId,
    adminName,
    'Admin',
    'RESTORE_ACTIVE_STATUS',
    'Deregistration',
    businessId,
    `Administrative closure lifted and business reactivated: "${currentBiz?.businessName || businessId}". Reason: "${reason?.trim() || 'Tax regularized'}".`,
    {
      status: previousStatus,
      deregistrationReason: currentBiz?.deregistrationReason || null,
    },
    {
      status: 'Active',
      restoredAt: now,
      restoredByName: adminName,
      restorationReason: reason?.trim() || 'Regularized',
    }
  );
}

// TAXPAYERS
export async function getTaxpayers(): Promise<Taxpayer[]> {
  const path = 'taxpayers';
  try {
    const snapshot = await getDocs(collection(db, 'taxpayers'));
    return snapshot.docs.map((d) => d.data() as Taxpayer);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function addTaxpayer(taxpayer: Taxpayer): Promise<void> {
  const path = `taxpayers/${taxpayer.id}`;
  try {
    await setDoc(doc(db, 'taxpayers', taxpayer.id), taxpayer);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ==========================================
// ASSESSMENTS (PHASE 4 BILLING ENGINE)
// ==========================================

export interface ProrationCalculation {
  baseAnnualFeeUSD: number;
  amountDueUSD: number;
  isProrated: boolean;
  proratedMonths: number;
  proratedRatio: number;
  notes: string;
}

export function calculateProratedAssessment(
  baseAnnualFeeUSD: number,
  registrationDate: string,
  targetFiscalYear: number,
): ProrationCalculation {
  let regYear = targetFiscalYear;
  let regMonth = 1; // 1-based (Jan = 1, Dec = 12)

  if (registrationDate) {
    const parts = registrationDate.split('-');
    if (parts.length >= 2) {
      regYear = parseInt(parts[0], 10) || targetFiscalYear;
      regMonth = parseInt(parts[1], 10) || 1;
    } else {
      const parsed = new Date(registrationDate);
      if (!isNaN(parsed.getTime())) {
        regYear = parsed.getFullYear();
        regMonth = parsed.getMonth() + 1;
      }
    }
  }

  // 1. If registered before the fiscal year: Full year rate (12/12 months)
  if (regYear < targetFiscalYear) {
    return {
      baseAnnualFeeUSD,
      amountDueUSD: baseAnnualFeeUSD,
      isProrated: false,
      proratedMonths: 12,
      proratedRatio: 1,
      notes: `Enterprise registered in ${regYear}: Full annual rate (12/12 months).`,
    };
  }

  // 2. If registered during the fiscal year: Prorate from registration month to December!
  if (regYear === targetFiscalYear) {
    if (regMonth <= 1) {
      return {
        baseAnnualFeeUSD,
        amountDueUSD: baseAnnualFeeUSD,
        isProrated: false,
        proratedMonths: 12,
        proratedRatio: 1,
        notes: `Registration in January ${targetFiscalYear}: Full annual rate (12/12 months).`,
      };
    }

    const monthsActive = Math.max(1, 12 - regMonth + 1);
    const proratedRatio = monthsActive / 12;
    // roundMoney, not `Math.round(x * 100) / 100`: the naive form rounds a true
    // half-cent DOWN whenever the binary product lands a hair under .5
    // (8.075 * 100 === 807.4999999999999), so the amount a taxpayer is billed
    // could be a cent short of the prorated tariff.
    const amountDueUSD = roundMoney(baseAnnualFeeUSD * proratedRatio);

    const monthNames = [
      '', 'January', 'February', 'March', 'April', 'May', 'June', 
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    return {
      baseAnnualFeeUSD,
      amountDueUSD,
      isProrated: true,
      proratedMonths: monthsActive,
      proratedRatio,
      notes: `Registration in ${monthNames[regMonth] || 'mid-year'} ${regYear}: Pro-rata temporis of ${monthsActive}/12 months applied (${Math.round(proratedRatio * 100)}% of tariff schedule).`,
    };
  }

  // 3. If registered in future compared to fiscal year
  return {
    baseAnnualFeeUSD,
    amountDueUSD: baseAnnualFeeUSD,
    isProrated: false,
    proratedMonths: 12,
    proratedRatio: 1,
    notes: `Fiscal tariff applied for fiscal year ${targetFiscalYear}.`,
  };
}

/**
 * Next sequential assessment number for a fiscal year.
 *
 * `prefixCode` is the head of tax the notice is issued under — "PAT" for the
 * Business License Tax (the default, and what every legacy record uses), "IF"
 * or "IRL" for the property heads of tax. Each head of tax keeps its own
 * independent sequence, so IF-2026-00001 and PAT-2026-00001 can coexist.
 */
export function generateNextAssessmentNumber(
  existingAssessments: Assessment[],
  fiscalYear: number,
  prefixCode: string = 'PAT'
): string {
  const prefix = `${prefixCode}-${fiscalYear}-`;
  let maxSeq = 0;

  for (const a of existingAssessments) {
    const num = a.assessmentNumber || a.noticeNumber || '';
    // Only numbers from THIS fiscal year define the sequence. Folding other
    // years' tails into maxSeq made a new year restart at the previous year's
    // high-water mark (PAT-2027-00193 instead of PAT-2027-00001).
    if (num.startsWith(prefix)) {
      const seqStr = num.substring(prefix.length);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

export function getNormalizedAssessmentStatus(
  assessment: Assessment
): AssessmentStatus {
  const s = normalizeAssessmentStatus(assessment.status);
  if (s === 'Paid') return 'Paid';
  if (s === 'Cancelled') return 'Cancelled';
  if (s === 'Overdue') return 'Overdue';
  // Draft / Pending_Approval / Approved are distinct workflow states — do not
  // collapse them into 'Pending' (a Draft with a past due date was being
  // reported as an overdue receivable).
  if (s === 'Draft' || s === 'Pending_Approval' || s === 'Approved') return s;

  // Check if overdue by date
  if (assessment.dueDate) {
    const today = todayDateString();
    if (assessment.dueDate < today) {
      return 'Overdue';
    }
  }

  return 'Pending';
}

export async function getAssessments(): Promise<Assessment[]> {
  const path = 'assessments';
  try {
    const snapshot = await getDocs(collection(db, 'assessments'));
    const list = snapshot.docs.map((d) => {
      const data = d.data() as any;
      return {
        ...data,
        activitySector: normalizeSector(data.activitySector),
        sizeClass: normalizeSizeClass(data.sizeClass),
        status: normalizeAssessmentStatus(data.status),
      } as Assessment;
    });
    // Sort newest first
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/**
 * Active-aware real-time listener for Tax Assessments.
 * Bounded by Spark tier limit() and explicitly cleans up when unsubscribed.
 */
export function subscribeToAssessments(
  onData: (assessments: Assessment[]) => void,
  onError?: (err: any) => void,
  limitCount: number = 100
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to assessments (limit: ${limitCount})`);
  // Order by document id (descending): assessment ids are ass_<timestamp>_<rand>,
  // so this returns the NEWEST documents. Without an explicit orderBy, Firestore
  // returned an ARBITRARY 100-document subset — the next notice number was then
  // computed from an arbitrary subset (duplicate PAT-YYYY sequences possible),
  // and the ledger silently hid older rows. Ordering by id never drops a
  // document the way orderBy on a data field would.
  const q = query(collection(db, 'assessments'), orderBy(documentId(), 'desc'), limit(limitCount));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as any;
        return {
          ...data,
          activitySector: normalizeSector(data.activitySector),
          sizeClass: normalizeSizeClass(data.sizeClass),
          status: normalizeAssessmentStatus(data.status),
        } as Assessment;
      });

      // Sort newest first
      list.sort(
        (a, b) =>
          new Date(b.createdAt || b.issueDate || 0).getTime() -
          new Date(a.createdAt || a.issueDate || 0).getTime()
      );

      onData(list);
    },
    (err) => {
      console.error('[Firestore Listener] Error on assessments:', err);
      emitGlobalToast(`Error syncing tax assessments: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from assessments');
    unsubscribe();
  };
}

export async function addAssessment(assessment: Assessment): Promise<void> {
  const normalized: Assessment = {
    ...assessment,
    activitySector: normalizeSector(assessment.activitySector),
    sizeClass: normalizeSizeClass(assessment.sizeClass),
    status: normalizeAssessmentStatus(assessment.status),
  };
  const path = `assessments/${normalized.id}`;
  try {
    await setDoc(doc(db, 'assessments', normalized.id), normalized);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function cancelAssessment(
  assessmentId: string,
  reason: string,
  cancelledBy: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  const path = `assessments/${assessmentId}`;
  try {
    // Status guard: a Paid or already-Cancelled assessment must not be
    // cancelled. Cancelling a paid notice left the money collected with no live
    // obligation behind it; a repeat cancel overwrote the original reason and
    // officer. Only Pending / Overdue / Draft / Pending_Approval may be closed.
    const current = await getDoc(doc(db, 'assessments', assessmentId));
    if (!current.exists()) {
      throw new Error(`Tax assessment (${assessmentId}) not found.`);
    }
    const currentStatus = normalizeAssessmentStatus(current.data()?.status);
    if (currentStatus === 'Cancelled') {
      throw new Error(`Assessment ${assessmentId} is already cancelled.`);
    }
    if (currentStatus === 'Paid') {
      throw new Error('A fully paid assessment cannot be cancelled — void the receipt first.');
    }

    const now = new Date().toISOString();
    await updateDoc(doc(db, 'assessments', assessmentId), {
      status: 'Cancelled',
      cancelledBy: cancelledBy.uid,
      cancelledByName: cancelledBy.displayName,
      cancelledAt: now,
      cancellationReason: reason.trim(),
      updatedAt: now,
    });

    await logAuditEvent(
      cancelledBy.uid,
      cancelledBy.displayName,
      cancelledBy.role,
      'CANCEL_ASSESSMENT',
      'Assessment',
      assessmentId,
      `Cancellation of tax assessment ${assessmentId} by ${cancelledBy.displayName} (${cancelledBy.role}). Reason for cancellation: "${reason.trim()}".`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
    throw err;
  }
}

export interface BulkAssessmentResult {
  targetYear: number;
  totalActiveBusinesses: number;
  skippedAlreadyAssessed: number;
  createdCount: number;
  totalBilledUSD: number;
  createdAssessments: Assessment[];
}

export async function generateBulkAnnualAssessments(
  targetYear: number,
  adminUser: { uid: string; displayName: string; role: UserRole }
): Promise<BulkAssessmentResult> {
  // 1. Fetch active businesses
  const businesses = await getBusinesses();
  const activeBusinesses = businesses.filter((b) => b.status === 'Active');

  // 2. Fetch existing assessments
  const allAssessments = await getAssessments();
  const yearAssessments = allAssessments.filter(
    (a) => a.fiscalYear === targetYear && a.status !== 'Cancelled' && (a.status as string)?.toLowerCase() !== 'annul\u00E9e'
  );

  // Find which businesses already have an assessment for this year
  const alreadyAssessedBizIds = new Set<string>();
  for (const a of yearAssessments) {
    if (a.businessId) alreadyAssessedBizIds.add(a.businessId);
    if (a.taxpayerId) alreadyAssessedBizIds.add(a.taxpayerId);
  }

  const businessesToAssess = activeBusinesses.filter(
    (b) => !alreadyAssessedBizIds.has(b.id)
  );

  // 3. Fetch active tax rates
  const taxRates = await getTaxRates(true);

  // 4. Generate sequential assessments
  let workingAssessments = [...allAssessments];
  const createdAssessments: Assessment[] = [];
  let totalBilledUSD = 0;
  const now = new Date().toISOString();
  const dueDate = `${targetYear}-03-31`;

  for (const biz of businessesToAssess) {
    // Find active rate for sector + size (default custom sectors to Other)
    const rate = taxRates.find(
      (r) => r.activitySector === biz.activitySector && r.sizeClass === biz.sizeClass
    ) || DEFAULT_PATENTE_RATES.find(
      (r) => r.activitySector === biz.activitySector && r.sizeClass === biz.sizeClass
    ) || taxRates.find(
      (r) => r.activitySector === 'Other' && r.sizeClass === biz.sizeClass
    ) || DEFAULT_PATENTE_RATES.find(
      (r) => r.activitySector === 'Other' && r.sizeClass === biz.sizeClass
    );

    const baseFee = rate ? rate.annualFeeUSD : 100;
    const proration = calculateProratedAssessment(
      baseFee,
      biz.registrationDate,
      targetYear
    );
    const nextNoticeNum = generateNextAssessmentNumber(workingAssessments, targetYear);

    const newAssessment: Assessment = {
      // One patente assessment per business per year — the invariant this
      // function already enforces by skipping assessed businesses. A second
      // submit therefore refreshes the same notice instead of billing twice.
      id: `ass_${targetYear}_${biz.id}`,
      businessId: biz.id,
      businessName: biz.businessName,
      ownerFullName: biz.ownerFullName,
      nationalIdOrRccm: biz.nationalIdOrRccm,
      commune: biz.commune,
      quartier: biz.quartier,
      activitySector: biz.activitySector,
      sizeClass: biz.sizeClass,
      taxpayerId: biz.id,
      taxpayerName: biz.businessName,
      assessmentNumber: nextNoticeNum,
      noticeNumber: nextNoticeNum,
      fiscalYear: targetYear,
      baseAnnualFeeUSD: proration.baseAnnualFeeUSD,
      amountDueUSD: proration.amountDueUSD,
      isProrated: proration.isProrated,
      proratedMonths: proration.proratedMonths,
      proratedNotes: proration.notes,
      registrationDate: biz.registrationDate,
      issueDate: todayDateString(),
      dueDate: dueDate,
      status: 'Pending',
      assessedBy: adminUser.uid,
      assessedByName: adminUser.displayName,
      rateId: rate?.id,
      rateVersion: rate?.version || 1,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, 'assessments', newAssessment.id), newAssessment);
    createdAssessments.push(newAssessment);
    workingAssessments.push(newAssessment);
    totalBilledUSD += proration.amountDueUSD;
  }

  // 5. Audit log
  await logAuditEvent(
    adminUser.uid,
    adminUser.displayName,
    adminUser.role,
    'BULK_ASSESSMENT_GENERATION',
    'Assessment',
    `bulk_${targetYear}`,
    `Bulk generation of annual assessments for fiscal year ${targetYear}: ${createdAssessments.length} assessments created for a total amount of ${formatMoney(totalBilledUSD)}. ${alreadyAssessedBizIds.size} active business(es) skipped as already assessed.`
  );

  return {
    targetYear,
    totalActiveBusinesses: activeBusinesses.length,
    skippedAlreadyAssessed: alreadyAssessedBizIds.size,
    createdCount: createdAssessments.length,
    totalBilledUSD,
    createdAssessments,
  };
}



export async function approveAssessment(
  assessmentId: string, 
  supervisorId: string, 
  supervisorName: string
): Promise<void> {
  const path = `assessments/${assessmentId}`;
  try {
    // Status guard: approving (or re-approving) must not resurrect a Cancelled
    // notice or touch one already settled — that would leave linked payments and
    // certificates pointing at an obligation the ledger no longer agrees with.
    const current = await getDoc(doc(db, 'assessments', assessmentId));
    if (!current.exists()) {
      throw new Error(`Tax assessment (${assessmentId}) not found.`);
    }
    const currentStatus = normalizeAssessmentStatus(current.data()?.status);
    if (currentStatus === 'Cancelled') {
      throw new Error('A cancelled assessment cannot be approved.');
    }
    if (currentStatus === 'Paid') {
      throw new Error('This assessment is already fully paid.');
    }

    await updateDoc(doc(db, 'assessments', assessmentId), {
      status: 'Approved',
      approvedBy: supervisorId,
      approvedByName: supervisorName,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ==========================================
// PAYMENTS & RECEIPTS (PHASE 5)
// ==========================================



export async function getPayments(): Promise<Payment[]> {
  const path = 'payments';
  try {
    const snapshot = await getDocs(collection(db, 'payments'));
    const result = snapshot.docs.map((d) => d.data() as Payment);
    // Sort descending by sequenceNumber or paidAt
    result.sort((a, b) => {
      if (a.sequenceNumber && b.sequenceNumber) return b.sequenceNumber - a.sequenceNumber;
      return new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime();
    });

    return result;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/**
 * Active-aware real-time listener for Payment History.
 * Bounded by Spark tier limit() and explicitly cleans up when unsubscribed.
 */
export function subscribeToPayments(
  onData: (payments: Payment[]) => void,
  onError?: (err: any) => void,
  limitCount: number = 100
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to payments (limit: ${limitCount})`);
  // Order by document id (descending): payment ids are pay_<year>_<seq5>, i.e.
  // lexicographically newest-first. Without an explicit orderBy, Firestore
  // returned the LOWEST ids — the oldest receipts — so once the collection
  // passed 100 docs every newer receipt (and its revenue) vanished from the
  // listener while a manual Refresh still showed it.
  const q = query(collection(db, 'payments'), orderBy(documentId(), 'desc'), limit(limitCount));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const result = snapshot.docs.map((d) => d.data() as Payment);
      result.sort((a, b) => {
        if (a.sequenceNumber && b.sequenceNumber) return b.sequenceNumber - a.sequenceNumber;
        return new Date(b.paidAt || b.paymentDate || 0).getTime() - new Date(a.paidAt || a.paymentDate || 0).getTime();
      });

      onData(result);
    },
    (err) => {
      console.error('[Firestore Listener] Error on payments:', err);
      emitGlobalToast(`Error syncing payments: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from payments');
    unsubscribe();
  };
}

export async function addPayment(payment: Payment): Promise<void> {
  const path = `payments/${payment.id}`;
  try {
    await setDoc(doc(db, 'payments', payment.id), payment);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export interface RecordCashPaymentParams {
  assessmentId: string;
  amountPaidUSD: number;
  paymentDate: string; // YYYY-MM-DD
  paymentType: PaymentType;
  paymentMethod?: PaymentMethod; // Collection channel; defaults to cash at counter
  cashierId: string;
  cashierName: string;
  sessionId?: string; // Links payment to active CashSession
  notes?: string;
}

/**
 * Executes an atomic Firestore transaction to:
 * 1. Read assessment and calculate updated paid amount and remaining balance
 * 2. Read and monotonically increment the sequential receipt counter
 * 3. Issue the unique, non-reusable receipt number (e.g. REC-2026-00043)
 * 4. Write payment record
 * 5. Update assessment status to 'Paid' if fully paid, or keep pending with remaining balance
 * 6. Append to audit log
 */
export async function recordCashPayment(params: RecordCashPaymentParams): Promise<Payment> {
  const {
    assessmentId,
    amountPaidUSD,
    paymentDate,
    paymentType,
    cashierId,
    cashierName,
    notes,
  } = params;

  // Reject a non-finite or non-positive amount before any write. Without this,
  // a NaN (blank field) or a negative amount was clamped by Math.min against the
  // remaining balance and stored as the receipt's amountPaidUSD — issuing a
  // negative/garbage receipt and corrupting the assessment's running balance.
  if (typeof amountPaidUSD !== 'number' || !Number.isFinite(amountPaidUSD) || amountPaidUSD <= 0) {
    throw new Error('Le montant du paiement doit être un nombre supérieur à zéro.');
  }

  // Sequence floor for databases where counters/receiptCounter has never been
  // written (fresh seed). The demo receipts occupy sequences up to 104, so the
  // old hardcoded floor of 43 eventually re-issued an existing receipt number
  // (REC-2026-00055 …) and transaction.set silently overwrote that payment doc.
  // This pre-read is only a lower bound: once the counter document exists it
  // remains the single source of truth inside the transaction.
  let sequenceFloor = 0;
  try {
    const topSeqSnap = await getDocs(
      query(collection(db, 'payments'), orderBy('sequenceNumber', 'desc'), limit(1))
    );
    const topSeq = topSeqSnap.docs[0]?.data()?.sequenceNumber;
    if (typeof topSeq === 'number' && topSeq > 0) sequenceFloor = topSeq;
  } catch {
    // Fall back to the historical floor; the counter check below still guards
    // against reuse once the counter document has been created.
  }

  try {
    const paymentRecord = await runTransaction(db, async (transaction) => {
      // 1. Fetch current assessment
      const assessmentRef = doc(db, 'assessments', assessmentId);
      const assessmentDoc = await transaction.get(assessmentRef);
      const assessmentExisted = assessmentDoc.exists();

      let assessmentData: Assessment;
      if (!assessmentDoc.exists()) {
        // Never take money against a cached copy of a notice. If the server has
        // no such assessment, the payment is refused rather than filed against a
        // row that exists only on this device.
        throw new Error(`Tax assessment (${assessmentId}) not found in database.`);
      } else {
        assessmentData = assessmentDoc.data() as Assessment;
      }

      if (assessmentData.status === 'Cancelled' || (assessmentData.status as string)?.toLowerCase().startsWith('annul')) {
        throw new Error(`Cannot record payment on a cancelled assessment (${assessmentData.assessmentNumber}).`);
      }
      if (assessmentData.status === 'Draft' || assessmentData.status === 'Pending_Approval') {
        throw new Error(`Cannot record payment on assessment ${assessmentData.assessmentNumber}: it has not been approved/issued yet.`);
      }

      const totalAssessmentUSD = assessmentData.amountDueUSD;
      if (typeof totalAssessmentUSD !== 'number' || !Number.isFinite(totalAssessmentUSD)) {
        throw new Error(`Assessment ${assessmentData.assessmentNumber} has no valid amount due — cannot record a payment against it.`);
      }
      const previousPaidUSD = assessmentData.amountPaidUSD || 0;
      const currentRemainingUSD = typeof assessmentData.remainingBalanceUSD === 'number'
        ? assessmentData.remainingBalanceUSD
        : Math.max(0, totalAssessmentUSD - previousPaidUSD);

      if (currentRemainingUSD <= 0.001) {
        throw new Error(`This tax assessment (${assessmentData.assessmentNumber}) is already fully paid.`);
      }

      // A payment larger than the balance is refused, not silently reduced.
      // `Math.min(entered, remaining)` used to clamp it: the cashier typed 500
      // against a 300 balance, the receipt was issued for 300, and the extra 200
      // was taken from the taxpayer and recorded nowhere. Refusing sends the
      // officer back to the counter with the real figure.
      if (amountPaidUSD > currentRemainingUSD + 0.005) {
        throw new Error(
          `Le montant saisi (${formatMoney(amountPaidUSD)}) dépasse le solde restant de cette note ` +
            `(${formatMoney(currentRemainingUSD)}). Encaissez au plus le solde, ou corrigez la note.`
        );
      }

      // Calculate new balances
      const actualAmountPaidUSD = Math.min(amountPaidUSD, currentRemainingUSD);
      const newTotalPaidUSD = previousPaidUSD + actualAmountPaidUSD;
      const newRemainingBalanceUSD = Math.max(0, totalAssessmentUSD - newTotalPaidUSD);
      const isFullyPaid = newRemainingBalanceUSD <= 0.001;
      const newStatus = isFullyPaid ? 'Paid' : assessmentData.status;

      // 2. Fetch and increment atomic monotonic counter
      const counterRef = doc(db, 'counters', 'receiptCounter');
      const counterDoc = await transaction.get(counterRef);

      let nextSequence = 1;
      if (counterDoc.exists()) {
        const data = counterDoc.data() as ReceiptCounter;
        nextSequence = (data.currentSequence || 0) + 1;
      }
      // Never fall below the highest sequence already present in the collection,
      // otherwise a freshly seeded database re-issues an existing receipt number.
      if (sequenceFloor > 0) {
        nextSequence = Math.max(nextSequence, sequenceFloor + 1);
      }

      const fiscalYear = assessmentData.fiscalYear || new Date().getFullYear();
      const receiptNumber = `REC-${fiscalYear}-${String(nextSequence).padStart(5, '0')}`;
      const paymentId = `pay_${fiscalYear}_${String(nextSequence).padStart(5, '0')}`;
      const paymentRef = doc(db, 'payments', paymentId);

      const createdPayment: Payment = {
        id: paymentId,
        receiptNumber,
        sequenceNumber: nextSequence,
        sessionId: params.sessionId,
        assessmentId: assessmentData.id,
        assessmentNumber: assessmentData.assessmentNumber || assessmentData.noticeNumber,
        businessId: assessmentData.businessId || assessmentData.taxpayerId,
        businessName: assessmentData.businessName || assessmentData.taxpayerName,
        taxpayerId: assessmentData.taxpayerId || assessmentData.businessId || '',
        taxpayerName: assessmentData.taxpayerName || assessmentData.businessName,
        // Carry the head of tax onto the receipt so it can name the tax that
        // was settled without re-reading the notice at print time.
        taxTypeCode: assessmentData.taxTypeCode,
        taxRatePercent: assessmentData.taxRatePercent,
        fiscalYear,
        amountPaidUSD: actualAmountPaidUSD,
        currency: 'USD',
        paymentType: isFullyPaid ? 'full' : paymentType,
        isPartial: !isFullyPaid,
        assessmentTotalUSD: totalAssessmentUSD,
        previousPaidUSD,
        remainingBalanceUSD: newRemainingBalanceUSD,
        paymentMethod: params.paymentMethod || 'Cash_Guichet',
        cashierId,
        cashierName,
        receivedBy: cashierId,
        receivedByName: cashierName,
        paymentDate: paymentDate || todayDateString(),
        paidAt: new Date().toISOString(),
        verified: true,
        offlineCreated: false,
        notes: notes || (isFullyPaid ? 'Full payment at counter' : `Partial payment (Remaining balance: ${formatMoney(newRemainingBalanceUSD)})`),
      };

      // 3. Write atomic batch
      transaction.set(counterRef, {
        id: 'receiptCounter',
        currentSequence: nextSequence,
        lastReceiptNumber: receiptNumber,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      transaction.set(paymentRef, createdPayment);

      // The assessment may exist only in the offline local cache (never yet
      // written to Firestore) — use set in that case, since update on a
      // non-existent document aborts the whole transaction.
      if (assessmentExisted) {
        transaction.update(assessmentRef, {
          amountPaidUSD: newTotalPaidUSD,
          remainingBalanceUSD: newRemainingBalanceUSD,
          status: newStatus,
          lastPaymentDate: createdPayment.paymentDate,
          updatedAt: new Date().toISOString(),
        });
      } else {
        transaction.set(assessmentRef, {
          ...assessmentData,
          amountPaidUSD: newTotalPaidUSD,
          remainingBalanceUSD: newRemainingBalanceUSD,
          status: newStatus,
          lastPaymentDate: createdPayment.paymentDate,
          updatedAt: new Date().toISOString(),
        });
      }

      return createdPayment;
    });

    // 4. Log to Audit Trail
    await logAuditEvent(
      cashierId,
      cashierName,
      'Cashier',
      'RECORD_PAYMENT',
      'Payment',
      paymentRecord.id,
      `Cash collection: Sequential receipt No. ${paymentRecord.receiptNumber} issued for ${paymentRecord.businessName}. Amount: ${formatMoney(paymentRecord.amountPaidUSD)}. Type: ${paymentRecord.paymentType === 'full' ? 'Full payment' : 'Partial payment (Balance: $' + paymentRecord.remainingBalanceUSD + ' USD)'}.`
    );

    // Phase 11: When a business's assessment for a tax year is marked Paid, generate an official Business License Certificate
    if (paymentRecord.paymentType === 'full' || (paymentRecord.remainingBalanceUSD !== undefined && paymentRecord.remainingBalanceUSD <= 0.001)) {
      try {
        const { issueCertificateForAssessment } = await import('./certificateService');
        const allAssessments = await getAssessments();
        const currentAssessment = allAssessments.find((a) => a.id === assessmentId);
        if (currentAssessment) {
          await issueCertificateForAssessment(
            currentAssessment,
            { uid: cashierId, displayName: cashierName, role: 'Cashier' },
            paymentRecord.receiptNumber
          );
        }
      } catch (certErr) {
        // Issuance is now all-or-nothing: it either reserves a free certificate
        // number and writes the document, or it fails. Failing here leaves the
        // payment recorded with no certificate, so it must be visible — a
        // console warning alone let a cashier hand over a receipt and nothing
        // else. The certificate can be re-issued from the Certificates view.
        console.warn('[Phase 11 Automatic Certificate Issuance Error]', certErr);
        emitGlobalToast(
          'Paiement enregistré, mais le certificat n\'a pas pu être émis. Réémettez-le depuis le registre des certificats.',
          'warning',
          'Certificat non émis'
        );
      }
    }

    // If linked to an active cash session, update the session running totals
    if (params.sessionId) {
      try {
        const { linkPaymentToCashSession } = await import('./cashService');
        await linkPaymentToCashSession(params.sessionId, paymentRecord);
      } catch (err) {
        // The receipt is issued, but the shift's running total could not be
        // updated — the drawer would then under-count this payment. Surface it
        // instead of leaving a silent console warning behind a real receipt.
        console.warn('[linkPaymentToCashSession error]', err);
        emitGlobalToast(
          'Reçu enregistré, mais le rattachement à la session de caisse a échoué — vérifiez la clôture de caisse.',
          'warning',
          'Lien caisse incomplet'
        );
      }
    }

    return paymentRecord;
  } catch (err: any) {
    // A failed receipt is reported to the cashier rather than parked on the
    // device. Firestore's persistent cache already holds an offline write and
    // replays it with a real sequential number; the removed local queue minted
    // temporary REC-OFFLINE numbers that had to be rewritten on sync, and a
    // rewritten receipt number is how two taxpayers end up sharing one.
    console.error('[Payment Error]', err);
    throw err;
  }
}

/**
 * Official Void Receipt Flow:
 * Never hard-deletes a receipt. Marks receipt as voided, records officer identity,
 * restabilizes assessment balance, records receipt sequence anomaly, and writes to audit log.
 */
export async function voidPaymentReceipt(
  paymentId: string,
  receiptNumber: string,
  reason: string,
  voidedBy: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  const now = new Date().toISOString();

  // 1. Fetch payments to locate the specific record
  const payments = await getPayments();
  const payment = payments.find((p) => p.id === paymentId || p.receiptNumber === receiptNumber);

  if (!payment) {
    throw new Error(`Payment record not found for receipt ${receiptNumber}`);
  }

  if (payment.isVoided) {
    throw new Error(`Receipt ${payment.receiptNumber} has already been voided. Cannot void the same receipt twice.`);
  }

  // Void payload applied inside the transaction below.
  const updates: Partial<Payment> = {
    isVoided: true,
    voidedAt: now,
    voidedBy: voidedBy.uid,
    voidedByName: voidedBy.displayName,
    voidReason: reason.trim(),
  };

  // 2+3. Mark the receipt voided AND roll back the linked assessment balance in
  // a single atomic transaction. This used to be a read-check-write spread over
  // separate updateDoc calls: two supervisors voiding concurrently both passed
  // the isVoided pre-check and one rollback was silently lost, and a failure
  // between the two writes left the receipt voided with the balance never
  // restored. runTransaction re-invokes this callback on write contention, so
  // the guard holds even under concurrent voids of the same receipt.
  await runTransaction(db, async (transaction) => {
    const paymentRef = doc(db, 'payments', payment.id);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists()) {
      throw new Error(`Receipt ${payment.receiptNumber} no longer exists in the database.`);
    }
    const livePayment = paymentSnap.data() as Payment;
    if (livePayment.isVoided) {
      throw new Error(`Receipt ${payment.receiptNumber} has already been voided. Cannot void the same receipt twice.`);
    }

    transaction.update(paymentRef, updates);

    if (livePayment.assessmentId) {
      const assessmentRef = doc(db, 'assessments', livePayment.assessmentId);
      const assessmentSnap = await transaction.get(assessmentRef);
      if (assessmentSnap.exists()) {
        const assData = assessmentSnap.data() as Assessment;
        const remainingUSD = Math.min(
          assData.amountDueUSD,
          (assData.remainingBalanceUSD ?? (assData.amountDueUSD - (assData.amountPaidUSD || 0))) + (livePayment.amountPaidUSD || 0)
        );
        // Reinstate a valid status: the balance goes back up, so the assessment is
        // either fully unpaid again or partially paid. 'Partial' is not a valid
        // AssessmentStatus, so derive Pending vs Overdue from the due date.
        // The date check must apply to BOTH branches — a partially-paid notice
        // past its due date used to be reset to 'Pending', silently dropping it
        // out of every overdue/receivable report.
        const todayStr = todayDateString();
        const newStatus: AssessmentStatus =
          (assData.dueDate && assData.dueDate < todayStr) ? 'Overdue' : 'Pending';

        transaction.update(assessmentRef, {
          status: newStatus,
          remainingBalanceUSD: remainingUSD,
          amountPaidUSD: Math.max(0, (assData.amountPaidUSD || 0) - (livePayment.amountPaidUSD || 0)),
          updatedAt: now,
        });
      }
    }
  });

  // 4. Remove the voided receipt from its cash session's running totals so the
  // expected drawer cash at close no longer counts this cancelled receipt.
  if (payment.sessionId) {
    try {
      const { unlinkPaymentFromCashSession } = await import('./cashService');
      await unlinkPaymentFromCashSession(payment.sessionId, payment);
    } catch (e) {
      console.warn('[Cash Session Unlink Warning]', e);
    }
  }

  // 5. Record anomaly in receipt sequence
  try {
    const anomalyId = `ANOM-VOID-${payment.receiptNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const today = todayDateString();
    await setDoc(doc(db, 'receiptAnomalies', anomalyId), {
      id: anomalyId,
      type: 'voided_receipt',
      receiptNumber: payment.receiptNumber,
      expectedReceiptNumber: payment.receiptNumber,
      actualReceiptNumber: payment.receiptNumber,
      sequenceNumber: payment.sequenceNumber || 0,
      cashierId: payment.cashierId || voidedBy.uid,
      cashierName: payment.cashierName || voidedBy.displayName,
      stationOffice: 'Goma Main Station',
      description: `Official receipt ${payment.receiptNumber} voided by ${voidedBy.displayName} (${voidedBy.role}). Justification: ${reason.trim()}`,
      status: 'Explained',
      startDate: payment.paymentDate || today,
      endDate: payment.paymentDate || today,
      detectedAt: now,
      resolvedAt: now,
      resolvedBy: voidedBy.uid,
      resolvedByName: voidedBy.displayName,
      resolutionNote: `Officially voided per administrative authorization: ${reason.trim()}`,
      resolutionNotes: `Officially voided per administrative authorization: ${reason.trim()}`,
      severity: 'Medium',
      source: 'manual_scan',
    });
  } catch (e) {
    console.warn('[Anomaly Creation Warning]', e);
  }

  // 6. Log in Audit Log
  await logAuditEvent(
    voidedBy.uid,
    voidedBy.displayName,
    voidedBy.role,
    'VOID_PAYMENT_RECEIPT',
    'Payment',
    payment.id,
    `Receipt ${payment.receiptNumber} voided by ${voidedBy.displayName} (${voidedBy.role}). Assessment balance reinstated. Reason: ${reason.trim()}`,
    { receiptNumber: payment.receiptNumber, amountUSD: payment.amountPaidUSD, reason }
  );
}

export interface ReceiptVerificationResult {
  isValid: boolean;
  payment: Payment | null;
  assessment?: Assessment | null;
  status: 'valid' | 'not_found' | 'cancelled';
  message: string;
  checkedAt: string;
}

/**
 * Anti-fraud checkpoint verification service:
 * Allows anyone (tax inspectors, police at checkpoints, taxpayers)
 * to enter a receipt number to confirm it's genuine and see its amount.
 */
export async function verifyReceipt(receiptNumberOrId: string): Promise<ReceiptVerificationResult> {
  const trimmed = receiptNumberOrId.trim();
  const now = new Date().toISOString();

  if (!trimmed) {
    return {
      isValid: false,
      payment: null,
      status: 'not_found',
      message: 'Please enter a receipt number or scan the QR code.',
      checkedAt: now,
    };
  }

  // Extract receipt number if input is a QR code payload. Official printed
  // receipts encode JSON: {"app":"GOMA-PATENTE-TAX","rec":"REC-2026-00043",...}
  // Legacy pipe format is also accepted: GOMA-PATENTE|REC:REC-2026-00042|...
  let searchNum = trimmed;
  if (trimmed.includes('REC:')) {
    const match = trimmed.match(/REC:([A-Z0-9_-]+)/i);
    if (match && match[1]) {
      searchNum = match[1];
    }
  } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { rec?: string };
      if (parsed && typeof parsed.rec === 'string' && parsed.rec) {
        searchNum = parsed.rec;
      }
    } catch {
      // Not valid JSON — treat the raw string as the receipt number.
    }
  }

  try {
    // 1. Check all payments in Firestore & local caches
    const allPayments = await getPayments();
    const foundPayment = allPayments.find(
      (p) =>
        (p.receiptNumber || '').toLowerCase() === searchNum.toLowerCase() ||
        (p.id || '').toLowerCase() === searchNum.toLowerCase()
    );

    if (!foundPayment) {
      return {
        isValid: false,
        payment: null,
        status: 'not_found',
        message: `Receipt "${searchNum}" is not listed in any fiscal registry of the City of Goma. Potential risk of counterfeit document or fraud attempt.`,
        checkedAt: now,
      };
    }

    // 2. Voided receipts are no longer liberatory — never certify them as valid
    if (foundPayment.isVoided) {
      return {
        isValid: false,
        payment: foundPayment,
        status: 'cancelled',
        message: `Receipt ${foundPayment.receiptNumber} was officially VOIDED on ${(foundPayment.voidedAt ? localDateFromIsoTimestamp(foundPayment.voidedAt) : 'an unknown date')} by ${foundPayment.voidedByName || 'an authorized officer'}. Reason: ${foundPayment.voidReason || 'not specified'}. It no longer constitutes proof of payment.`,
        checkedAt: now,
      };
    }

    // 3. Fetch linked assessment for cross-validation
    let linkedAssessment: Assessment | null = null;
    if (foundPayment.assessmentId) {
      const allAssessments = await getAssessments();
      linkedAssessment = allAssessments.find((a) => a.id === foundPayment.assessmentId) || null;
    }

    return {
      isValid: true,
      payment: foundPayment,
      assessment: linkedAssessment,
      status: 'valid',
      message: 'Receipt certified authentic and valid by the Revenue Directorate of the City of Goma.',
      checkedAt: now,
    };
  } catch (err: any) {
    // Verification answers one question only: does the official ledger hold
    // this receipt? Searching a device's cached payments instead would let a
    // laptop that once saw a receipt keep certifying it as proof of payment
    // after the server voided or never accepted it.
    console.error('[Verify Receipt Error]', err);
    return {
      isValid: false,
      payment: null,
      status: 'not_found',
      message: `Receipt "${searchNum}" could not be verified — the official revenue ledger is unavailable. A receipt is only proven by the server record, so please retry.`,
      checkedAt: now,
    };
  }
}

// ==========================================
// AUDIT LOGS & COMPLIANCE (PHASE 6)
// ==========================================



export async function getAuditLogs(): Promise<AuditLog[]> {
  try {
    // Check auditLog collection first, then auditLogs — both are written, and
    // entries predating the dual write live in only one of them.
    const q1 = query(collection(db, 'auditLog'), orderBy('timestamp', 'desc'), limit(100));
    const snap1 = await getDocs(q1);
    let firestoreLogs: AuditLog[] = [];
    if (!snap1.empty) {
      firestoreLogs = snap1.docs.map((d) => d.data() as AuditLog);
    } else {
      const q2 = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(100));
      const snap2 = await getDocs(q2);
      if (!snap2.empty) {
        firestoreLogs = snap2.docs.map((d) => d.data() as AuditLog);
      }
    }

    return firestoreLogs.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'auditLog');
    return [];
  }
}

/**
 * Real-time listener for the audit ledger.
 * Bounded by limit(100) to respect Spark free tier.
 */
export function subscribeToAuditLogs(
  onData: (logs: AuditLog[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'auditLog'), orderBy('timestamp', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => d.data() as AuditLog));
    },
    (err) => {
      // The audit trail is the account of everything done to public revenue. A
      // cached copy on one machine is not that account, so a sync failure is
      // announced instead of quietly presented as the ledger.
      console.error('[Audit Log] Snapshot error:', err);
      emitGlobalToast('Audit Log could not be read from the server. The entries below are not a complete record.', 'error');
      if (onError) onError(err);
      onData([]);
    }
  );
}

export async function logAuditEvent(
  userId: string,
  userName: string,
  userRole: UserRole,
  action: string,
  entityType: AuditLog['entityType'],
  entityId: string,
  details: string,
  beforeValue?: any,
  afterValue?: any
): Promise<void> {
  // An identical entry from the same officer inside the same minute is the same
  // event reported twice by a duplicated request, not a second fact: the id is
  // derived from the content so the retry lands on the same document, and the
  // repeat is skipped outright rather than overwriting a good row.
  const id = intentId('log', 'audit', [userId, action, entityType, entityId, details]);
  if (!isFirstIntent(id, INTENT_BUCKET_MS)) return;  const logEntry: AuditLog = {
    id,
    userId,
    userName,
    userRole,
    action,
    entityType,
    entityId,
    details,
    beforeValue: beforeValue !== undefined ? beforeValue : null,
    afterValue: afterValue !== undefined ? afterValue : null,
    timestamp: new Date().toISOString(),
  };

  try {
    // Save to both /auditLog and /auditLogs for complete system compliance
    await setDoc(doc(db, 'auditLog', id), logEntry);
    await setDoc(doc(db, 'auditLogs', id), logEntry);
  } catch (err) {
    // An audit write must never be parked in local storage as a substitute for
    // the ledger. It stays unwritten, and the officer is told the record is
    // missing rather than being left to assume the action was audited. The
    // surrounding fiscal action is not failed over it.
    console.error('[Audit Log] FAILED to write audit entry — this action is unrecorded:', err);
    emitGlobalToast(
      `Audit entry could not be written to the server (${action}). The action itself succeeded but is unrecorded.`,
      'error',
      'Audit Gap'
    );
  }
}

// ==========================================
// COMPLIANCE & DELINQUENT TAXPAYERS (PHASE 6)
// ==========================================

export interface DelinquentTaxpayerItem {
  id: string; // businessId
  businessId: string;
  businessName: string;
  ownerFullName: string;
  nationalIdOrRccm: string;
  phoneNumber: string;
  physicalAddress: string;
  commune: string;
  quartier: string;
  activitySector: BusinessSector;
  sizeClass: BusinessSizeClass;
  status: BusinessStatus; // 'actif' | 'inactif' | 'en radiation'
  deregisteredAt?: string;
  deregisteredByName?: string;
  deregistrationReason?: string;
  totalOverdueUSD: number;
  totalPaidUSD: number;
  assessmentsCount: number;
  overdueAssessments: Assessment[];
  maxDaysOverdue: number;
  oldestDueDate: string;
  severity: 'faible' | 'moyen' | 'eleve' | 'critique'; // <30j, 31-60j, 61-90j, >90j
}

export function computeDelinquentTaxpayers(
  businesses: Business[], 
  assessments: Assessment[]
): DelinquentTaxpayerItem[] {
  const today = todayDateString();
  const results: DelinquentTaxpayerItem[] = [];

  // Group assessments by businessId (or taxpayerId)
  const assessmentsByBiz = new Map<string, Assessment[]>();
  assessments.forEach((ass) => {
    const bId = ass.businessId || ass.taxpayerId;
    if (!bId) return;
    const list = assessmentsByBiz.get(bId) || [];
    list.push(ass);
    assessmentsByBiz.set(bId, list);
  });

  businesses.forEach((biz) => {
    const bizAssessments = assessmentsByBiz.get(biz.id) || [];
    
    // Filter overdue assessments:
    // Unpaid (remainingBalanceUSD > 0 or not Paid/Cancelled) AND (status === 'Overdue' OR dueDate < today)
    const overdueList = bizAssessments.filter((ass) => {
      if (ass.status === 'Paid' || (ass.status as string)?.toLowerCase().startsWith('pay') || ass.status === 'Cancelled' || (ass.status as string)?.toLowerCase().startsWith('annul')) return false;
      const isPastDue = Boolean(ass.dueDate && ass.dueDate < today);
      const isOverdueStatus = ass.status === 'Overdue' || (ass.status as any) === 'en retard';
      const balance = typeof ass.remainingBalanceUSD === 'number' 
        ? ass.remainingBalanceUSD 
        : Math.max(0, ass.amountDueUSD - (ass.amountPaidUSD || 0));
      return (isPastDue || isOverdueStatus) && balance > 0;
    });

    // If business has overdue assessments OR is currently flagged 'Closure Pending' / 'en radiation'
    const isClosureStatus = normalizeBusinessStatus(biz.status) === 'Closure Pending';
    if (overdueList.length > 0 || isClosureStatus) {
      let totalOverdueUSD = 0;
      let totalPaidUSD = 0;
      let maxDaysOverdue = 0;
      let oldestDueDate = today;

      overdueList.forEach((ass) => {
        const balanceUSD = typeof ass.remainingBalanceUSD === 'number'
          ? ass.remainingBalanceUSD
          : Math.max(0, ass.amountDueUSD - (ass.amountPaidUSD || 0));
        totalOverdueUSD += balanceUSD;
        totalPaidUSD += ass.amountPaidUSD || 0;

        if (ass.dueDate) {
          if (ass.dueDate < oldestDueDate) {
            oldestDueDate = ass.dueDate;
          }
          const days = Math.max(0, daysBetweenDates(ass.dueDate, today));
          if (days > maxDaysOverdue) {
            maxDaysOverdue = days;
          }
        }
      });

      // If business has no overdue assessments directly attached but was flagged Closure Pending
      // Closure Pending with no overdue assessments: the business carries no
      // quantified debt from the ledger — report zeros, not invented figures.
      if (overdueList.length === 0 && isClosureStatus) {
        maxDaysOverdue = 0;
        oldestDueDate = today;
        totalOverdueUSD = 0;
      }

      let severity: 'faible' | 'moyen' | 'eleve' | 'critique' = 'faible';
      if (maxDaysOverdue > 90) severity = 'critique';
      else if (maxDaysOverdue > 60) severity = 'eleve';
      else if (maxDaysOverdue > 30) severity = 'moyen';

      results.push({
        id: biz.id,
        businessId: biz.id,
        businessName: biz.businessName,
        ownerFullName: biz.ownerFullName,
        nationalIdOrRccm: biz.nationalIdOrRccm,
        phoneNumber: biz.phoneNumber,
        physicalAddress: biz.physicalAddress,
        commune: biz.commune,
        quartier: biz.quartier,
        activitySector: biz.activitySector,
        sizeClass: biz.sizeClass,
        status: biz.status,
        deregisteredAt: biz.deregisteredAt,
        deregisteredByName: biz.deregisteredByName,
        deregistrationReason: biz.deregistrationReason,
        totalOverdueUSD: Math.round(totalOverdueUSD * 100) / 100,
        totalPaidUSD,
        assessmentsCount: overdueList.length,
        overdueAssessments: overdueList,
        maxDaysOverdue,
        oldestDueDate,
        severity,
      });
    }
  });

  // Sort by days overdue descending by default
  return results.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue);
}

export async function getDelinquentTaxpayers(): Promise<DelinquentTaxpayerItem[]> {
  const [businesses, assessments] = await Promise.all([
    getBusinesses(),
    getAssessments(),
  ]);

  return computeDelinquentTaxpayers(businesses, assessments);
}

// INITIAL SEEDING HELPER


/**
 * Lightweight aggregation helper for Dashboard summary cards.
 * Uses Firestore getCountFromServer() to stay well within Spark free-tier quotas.
 */
export async function getDashboardAggregateCounts(): Promise<{
  totalBusinesses: number;
  totalAssessments: number;
  pendingApprovalsCount: number;
}> {
  try {
    const [bizCountSnap, assCountSnap, approvalsCountSnap] = await Promise.all([
      getCountFromServer(collection(db, 'businesses')),
      getCountFromServer(collection(db, 'assessments')),
      getCountFromServer(query(collection(db, 'approvalRequests'), where('status', '==', 'Pending'))).catch(() => null),
    ]);

    const totalBusinesses = bizCountSnap.data().count;
    const totalAssessments = assCountSnap.data().count;
    const pendingApprovalsCount = approvalsCountSnap ? approvalsCountSnap.data().count : 0;

    return {
      totalBusinesses,
      totalAssessments,
      pendingApprovalsCount,
    };
  } catch (err) {
    // Report the failure instead of counting rows cached on this device — a
    // dashboard total that disagrees with the server is worse than no total.
    console.error('[Dashboard Aggregate] Server count failed:', err);
    throw err;
  }
}
