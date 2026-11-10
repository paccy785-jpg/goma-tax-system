import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logAuditEvent } from './dbService';
import { shiftDateString, todayDateString } from '../utils/date';
import {
  Assessment,
  PropertyParcel,
  TaxType,
  TaxTypeRateVersion,
  UserRole,
  isPercentageTaxType,
} from '../types';

/**
 * Heads of tax levied on declared property.
 *
 * Both of these are percentage taxes on a base the taxpayer declares, which is
 * why they live here rather than in the patente tariff schedule — a percentage
 * of a declared value cannot be expressed as a flat annual fee, and it must not
 * inherit the pro-rata maths that only makes sense for an annual tariff.
 *
 * These values are the built-in fallback. The authoritative copy lives in the
 * `taxTypes` collection so an administrator can revise a rate without a
 * deployment; this seed is used to populate an empty database and to keep the
 * UI working when Firestore is unreachable.
 */
export const DEFAULT_TAX_TYPES: TaxType[] = [
  {
    id: 'taxtype_if',
    code: 'IF',
    label: "Déclaration de l'impôt foncier",
    labelEn: 'Property Tax Declaration',
    ratePercent: 15,
    baseKind: 'declared_property_value',
    baseDescription: 'Valeur déclarée du bien immobilier',
    numberPrefix: 'IF',
    isActive: true,
    legalBasis: 'Code des impôts — Impôt foncier (IF)',
    notes: '15% de la valeur déclarée du bien immobilier.',
    updatedBy: 'Admin - Urban Revenue Division',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'taxtype_irl',
    code: 'IRL',
    label: "Déclaration de l'impôt sur les revenus locatifs",
    labelEn: 'Rental Income Tax Declaration',
    ratePercent: 15,
    baseKind: 'annual_rental_income',
    baseDescription: 'Revenu locatif annuel déclaré',
    numberPrefix: 'IRL',
    isActive: true,
    legalBasis: 'Code des impôts — Impôt sur les revenus locatifs (IRL)',
    notes: '15% du revenu locatif annuel déclaré.',
    updatedBy: 'Admin - Urban Revenue Division',
    updatedAt: new Date().toISOString(),
  },
];

export const TAX_TYPES_COLLECTION = 'taxTypes';

/**
 * Read the tax-type registry, seeding the built-in entries on first run.
 *
 * Unlike the transactional collections, a failure here falls back to the seed
 * rather than propagating: the registry is configuration, and an unreachable
 * Firestore should not leave the officer with no heads of tax to choose from.
 */
export async function getTaxTypes(): Promise<TaxType[]> {
  try {
    const snapshot = await getDocs(collection(db, TAX_TYPES_COLLECTION));
    if (snapshot.empty) {
      for (const taxType of DEFAULT_TAX_TYPES) {
        try {
          await setDoc(doc(db, TAX_TYPES_COLLECTION, taxType.id), taxType);
        } catch (seedErr) {
          // A read-only or offline session can still read the seed from memory.
          console.warn('[TaxTypes] Could not persist seed entry:', seedErr);
        }
      }
      return DEFAULT_TAX_TYPES;
    }
    const stored = snapshot.docs.map((d) => d.data() as TaxType);
    // Keep the built-in order stable (IF, then IRL, then any additions).
    return stored.sort((a, b) => a.code.localeCompare(b.code));
  } catch (err) {
    console.warn('[TaxTypes] Registry unavailable, using built-in heads of tax:', err);
    return DEFAULT_TAX_TYPES;
  }
}

/** Persist one head of tax. `updatedAt` is always stamped here. */
export async function saveTaxType(taxType: TaxType): Promise<void> {
  await setDoc(doc(db, TAX_TYPES_COLLECTION, taxType.id), {
    ...taxType,
    updatedAt: new Date().toISOString(),
  });
}

/* ==================================================================== */
/*  RATE VERSIONING                                                     */
/*                                                                      */
/*  Same immutability principle as the patente schedule: a rate change  */
/*  closes the current version with an end date and opens a new one.    */
/*  The difference is governance, not mechanics — a head of tax is a    */
/*  published statutory rate, so it takes effect on submission without  */
/*  a second officer's sign-off.                                        */
/* ==================================================================== */

export const TAX_TYPE_VERSIONS_COLLECTION = 'taxTypeRateVersions';

/** All versions for one head of tax, newest first. */
export async function getTaxTypeRateHistory(
  taxType: TaxType
): Promise<TaxTypeRateVersion[]> {
  try {
    // Filtered server-side: the collection grows with every rate change across
    // every head of tax, so reading it whole to pick out one trail does not
    // scale. A single equality filter needs no composite index.
    const snapshot = await getDocs(
      query(collection(db, TAX_TYPE_VERSIONS_COLLECTION), where('taxTypeId', '==', taxType.id))
    );
    const mine = snapshot.docs
      .map((d) => d.data() as TaxTypeRateVersion)
      .sort((a, b) => (b.version || 1) - (a.version || 1));

    if (mine.length > 0) return mine;
    return [await backfillOpeningVersion(taxType)];
  } catch (err) {
    console.warn('[TaxTypes] Version history unavailable:', err);
    // Never leave the timeline empty just because Firestore is unreachable —
    // the current rate is by definition version 1.
    return [syntheticOpeningVersion(taxType)];
  }
}

/** Version 1 for a head of tax created before versioning existed. */
function syntheticOpeningVersion(taxType: TaxType): TaxTypeRateVersion {
  return {
    id: `${taxType.id}_v1`,
    taxTypeId: taxType.id,
    taxTypeCode: taxType.code,
    ratePercent: taxType.ratePercent,
    baseKind: taxType.baseKind,
    version: 1,
    isActive: true,
    effectiveStartDate: (taxType.updatedAt || new Date().toISOString()).slice(0, 10),
    effectiveEndDate: null,
    legalBasis: taxType.legalBasis,
    notes: taxType.notes,
    createdBy: 'system',
    createdByName: taxType.updatedBy || 'System',
    createdAt: taxType.updatedAt || new Date().toISOString(),
  };
}

/**
 * Record the current rate as version 1 for a head of tax that has no trail —
 * every head of tax that existed before versioning is, by definition, on its
 * first version, and the timeline should say so rather than show nothing.
 */
async function backfillOpeningVersion(taxType: TaxType): Promise<TaxTypeRateVersion> {
  const opening = syntheticOpeningVersion(taxType);
  try {
    await setDoc(doc(db, TAX_TYPE_VERSIONS_COLLECTION, opening.id), opening);
  } catch (err) {
    console.warn('[TaxTypes] Could not persist the opening version:', err);
  }
  return opening;
}

export interface CreateTaxTypeRateVersionParams {
  taxType: TaxType;
  newRatePercent: number;
  effectiveStartDate: string; // YYYY-MM-DD
  legalBasis?: string;
  notes?: string;
  userProfile: { uid: string; displayName: string; role: string };
}

/**
 * Open a new dated version of a head of tax's rate.
 *
 * Closes the active version with an end date (the eve of the new start date,
 * computed as plain string arithmetic so no UTC/local day shift can creep in),
 * writes the new version, and mirrors the new rate onto the head of tax so the
 * duty computation keeps reading a single working value.
 */
export async function createTaxTypeRateVersion(
  params: CreateTaxTypeRateVersionParams
): Promise<{ newVersion: TaxTypeRateVersion; superseded?: TaxTypeRateVersion }> {
  const { taxType, userProfile } = params;
  const newRatePercent = Math.min(100, Math.max(0, Number(params.newRatePercent)));
  const now = new Date().toISOString();

  const history = await getTaxTypeRateHistory(taxType);
  const active = history.find((v) => v.isActive !== false) || history[0];
  const newVersionNumber = (active?.version || 1) + 1;

  let superseded: TaxTypeRateVersion | undefined;
  if (active) {
    const endDate =
      shiftDateString(params.effectiveStartDate, -1) || params.effectiveStartDate;
    superseded = { ...active, effectiveEndDate: endDate, isActive: false, updatedAt: now };
  }

  const newVersion: TaxTypeRateVersion = {
    // Keyed on tax type + version number: a repeated submit refreshes this
    // version rather than minting a second competing one.
    id: `${taxType.id}_v${newVersionNumber}`,
    taxTypeId: taxType.id,
    taxTypeCode: taxType.code,
    ratePercent: newRatePercent,
    baseKind: taxType.baseKind,
    version: newVersionNumber,
    isActive: true,
    effectiveStartDate: params.effectiveStartDate,
    effectiveEndDate: null,
    legalBasis: params.legalBasis?.trim() || taxType.legalBasis,
    notes: params.notes?.trim() || '',
    createdBy: userProfile.uid,
    createdByName: userProfile.displayName,
    createdAt: now,
    updatedAt: now,
  };

  // The three writes land together or not at all. They used to be three
  // independent awaits, so a network failure between them left the published
  // timeline and the working rate disagreeing: the version trail said v2 (18 %)
  // was active while the head of tax still carried 15 %, and every notice
  // issued afterwards was computed at the old rate — or the trail was left
  // with a closed version and no successor.
  const batch = writeBatch(db);
  if (superseded) {
    batch.set(doc(db, TAX_TYPE_VERSIONS_COLLECTION, active!.id), superseded);
  }
  batch.set(doc(db, TAX_TYPE_VERSIONS_COLLECTION, newVersion.id), newVersion);
  // Keep the working value in step with the active version.
  batch.set(doc(db, TAX_TYPES_COLLECTION, taxType.id), {
    ...taxType,
    ratePercent: newRatePercent,
    updatedBy: userProfile.displayName,
    updatedAt: now,
  });
  await batch.commit();

  await logAuditEvent(
    userProfile.uid,
    userProfile.displayName,
    userProfile.role as UserRole,
    'VERSION_TAX_TYPE_RATE',
    'TaxType',
    newVersion.id,
    `New rate version v${newVersionNumber} for ${taxType.code} (${taxType.label}) set to ${newRatePercent}% of ${taxType.baseDescription}, effective ${params.effectiveStartDate}. Previous version v${active?.version || 1} (${active?.ratePercent ?? 'n/a'}%) closed with end date ${superseded?.effectiveEndDate || params.effectiveStartDate}. Notices already issued remain unaffected.`
  );

  return { newVersion, superseded };
}

/** Find a head of tax by its code, tolerating an unknown code. */
export function taxTypeForCode(taxTypes: TaxType[], code?: string): TaxType | null {
  if (!code) return null;
  return taxTypes.find((t) => t.code === code) || null;
}

/**
 * The figure a head of tax is assessed on, for one parcel.
 *
 * Returns null when the head of tax is tariff-based (patente), which has no
 * declared base and is handled by the patente schedule instead.
 */
export function baseForParcel(taxType: TaxType, parcel: PropertyParcel): number | null {
  switch (taxType.baseKind) {
    case 'declared_property_value':
      return parcel.declaredValueUSD || 0;
    case 'annual_rental_income':
      return parcel.annualRentUSD || 0;
    case 'flat_tariff':
    default:
      return null;
  }
}

export interface TaxComputation {
  taxType: TaxType;
  baseUSD: number;
  ratePercent: number;
  /** Duty owed, rounded to whole USD. */
  dutyUSD: number;
}

/**
 * Duty owed on one parcel under one head of tax.
 *
 * Returns null for tariff-based heads of tax, and for a percentage tax with no
 * declared base — a 15% rate against a zero base is "nothing declared", not a
 * zero-dollar liability, and the two must not be confused in a register.
 */
export function computeTaxDuty(
  taxType: TaxType,
  parcel: PropertyParcel
): TaxComputation | null {
  if (!isPercentageTaxType(taxType)) return null;
  const baseUSD = baseForParcel(taxType, parcel);
  if (baseUSD === null || baseUSD <= 0) return null;
  return {
    taxType,
    baseUSD,
    ratePercent: taxType.ratePercent,
    dutyUSD: Math.round((baseUSD * taxType.ratePercent) / 100),
  };
}

/** Every computable duty for one parcel, in registry order. */
export function computeParcelTaxLines(
  parcel: PropertyParcel,
  taxTypes: TaxType[]
): TaxComputation[] {
  return taxTypes
    .filter((t) => t.isActive !== false)
    .map((t) => computeTaxDuty(t, parcel))
    .filter((line): line is TaxComputation => line !== null);
}

export interface TaxTypeRollTotal {
  taxType: TaxType;
  /** Parcels that actually declared a base for this head of tax. */
  parcels: number;
  baseUSD: number;
  dutyUSD: number;
}

/**
 * Aggregate the register by head of tax.
 *
 * Totals follow the same `parcels` array the table is rendering, so a filtered
 * view can never print a grand total that contradicts the rows above it.
 */
export function summarizeTaxRoll(
  parcels: PropertyParcel[],
  taxTypes: TaxType[]
): TaxTypeRollTotal[] {
  return taxTypes
    .filter((t) => t.isActive !== false && isPercentageTaxType(t))
    .map((taxType) => {
      let count = 0;
      let baseUSD = 0;
      let dutyUSD = 0;
      for (const parcel of parcels) {
        const line = computeTaxDuty(taxType, parcel);
        if (!line) continue;
        count += 1;
        baseUSD += line.baseUSD;
        dutyUSD += line.dutyUSD;
      }
      return { taxType, parcels: count, baseUSD, dutyUSD };
    });
}

export interface TaxNoticeDraftParams {
  taxType: TaxType;
  ratePercent: number;
  /** The declared base the rate is applied to, in USD. */
  baseUSD: number;
  /** What is being assessed — a business, or a rented parcel. */
  subject: string;
  commune?: string;
  quartier?: string;
  address?: string;
  parcelId?: string;
  parcelRang?: string;
  fiscalYear: number;
  /** Pre-allocated number, so the caller owns the sequencing. */
  assessmentNumber: string;
  assessor: { uid: string; displayName: string };
  /** Describes the base on the printed notice. */
  baseLabel?: string;
  /** Extra context recorded on the notice, e.g. a reconciliation finding. */
  note?: string;
}

/**
 * Build a percentage-tax notice.
 *
 * One implementation shared by every screen that raises an IF/IRL notice, so a
 * notice can never differ depending on which tab happened to issue it. The
 * notice denormalises the tax code, the rate and the base — exactly as the
 * patente flow denormalises business details — so a reprint years later still
 * shows the liability it was actually assessed at.
 */
export function buildTaxNotice(params: TaxNoticeDraftParams): Assessment {
  const dutyUSD = Math.round((Math.max(0, params.baseUSD) * params.ratePercent) / 100);
  const now = new Date().toISOString();

  return {
    id: `ass_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    assessmentNumber: params.assessmentNumber,
    noticeNumber: params.assessmentNumber,
    fiscalYear: params.fiscalYear,
    businessName: params.subject,
    taxpayerName: params.subject,
    commune: params.commune,
    quartier: params.quartier,
    physicalAddress: params.address,
    // A percentage tax has no tariff-schedule base; the liability is the
    // declared base times the rate, recorded below.
    baseAnnualFeeUSD: 0,
    amountDueUSD: dutyUSD,
    amountPaidUSD: 0,
    remainingBalanceUSD: dutyUSD,
    isProrated: false,
    proratedMonths: 12,
    proratedNotes:
      params.note ||
      `${params.taxType.code} — ${params.ratePercent}% of ${(params.baseLabel || params.taxType.baseDescription).toLowerCase()}.`,
    issueDate: todayDateString(),
    dueDate: `${params.fiscalYear}-03-31`,
    status: 'Pending',
    assessedBy: params.assessor.uid,
    assessedByName: params.assessor.displayName,
    taxTypeCode: params.taxType.code,
    taxRatePercent: params.ratePercent,
    taxableBaseUSD: params.baseUSD,
    taxableBaseLabel: params.baseLabel || params.taxType.baseDescription,
    parcelId: params.parcelId,
    parcelRang: params.parcelRang,
    createdAt: now,
    updatedAt: now,
  };
}

/** Short label used on notices, receipts and report rows. */
export function taxTypeBadgeLabel(taxType?: TaxType | null): string {
  if (!taxType) return 'Patente (Business License Tax)';
  return `${taxType.code} — ${taxType.label}`;
}

/**
 * Label for an assessment, resolved from its own denormalised snapshot.
 *
 * Assessments store the tax type's code and rate at issue time rather than
 * joining the registry, so a notice re-printed years later still describes the
 * head of tax and rate it was actually issued under.
 */
export function assessmentTaxLabel(assessment: {
  taxTypeCode?: string;
  taxRatePercent?: number;
}): string {
  if (!assessment.taxTypeCode || assessment.taxTypeCode === 'PATENTE') {
    return 'Patente (Business License Tax)';
  }
  return assessment.taxRatePercent
    ? `${assessment.taxTypeCode} — ${assessment.taxRatePercent}%`
    : assessment.taxTypeCode;
}
