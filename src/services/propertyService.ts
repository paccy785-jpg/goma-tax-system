import {
  PropertyParcel,
  PropertyMeasureKind,
  PropertyTotalKind,
} from '../types';
import { formatMoney } from '../utils/money';

/* ==================================================================== */
/*  GROUPING BY OWNER                                                   */
/* ==================================================================== */

/** One proprietor's block in the register: their properties, kept together. */
export interface ParcelOwnerGroup {
  /** Stable grouping key — the linked taxpayer id, else the filed name. */
  key: string;
  ownerTaxpayerId: string;
  ownerName: string;
  parcels: PropertyParcel[];
}

/**
 * The grouping key for a parcel: the linked taxpayer id when there is one, so a
 * renamed contributor stays grouped, otherwise the filed owner name. Parcels
 * with no owner recorded share one bucket rather than each being split out.
 */
export function parcelOwnerKey(parcel: PropertyParcel): string {
  if (parcel.ownerTaxpayerId) return `id:${parcel.ownerTaxpayerId}`;
  const name = (parcel.ownerName || '').trim().toLowerCase();
  return name ? `name:${name}` : 'unattached';
}

/**
 * Group parcels by proprietor so one person's assets occupy a single block
 * instead of being scattered down the register. Groups keep first-appearance
 * order; the owner name is taken from the first parcel in the group (the view
 * can substitute the roll's current name for a linked taxpayer).
 */
export function groupParcelsByOwner(parcels: PropertyParcel[]): ParcelOwnerGroup[] {
  const groups = new Map<string, ParcelOwnerGroup>();
  for (const parcel of parcels) {
    const key = parcelOwnerKey(parcel);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        ownerTaxpayerId: parcel.ownerTaxpayerId || '',
        ownerName: parcel.ownerName || '',
        parcels: [],
      };
      groups.set(key, group);
    }
    group.parcels.push(parcel);
  }
  return Array.from(groups.values());
}

/**
 * Cadastral duty for one parcel.
 *
 * The tariff is expressed per m² for parcels measured by surface and per unit
 * for counted assets (kiosks, stalls). Mixing the two in one sum would be
 * meaningless, so `montantImpotUSD` is always derived here and the totals are
 * kept in separate dimensions.
 */
export function computeMontantImpot(measureValue: number, tauxUSD: number): number {
  if (!Number.isFinite(measureValue) || !Number.isFinite(tauxUSD)) return 0;
  return Math.round(measureValue * tauxUSD);
}

export interface CadastralRegisterTotals {
  parcels: number;

  /** Aggregate surface in m² across `superficie` parcels only. */
  superficieM2: number;
  /** Aggregate unit count across `nombre` parcels only. */
  nombreUnites: number;

  /** Total duty owed across every parcel, in USD. */
  totalImpotUSD: number;

  /** Duty owed grouped by declared usage, largest first. */
  byUsage: { usage: string; montantUSD: number; parcels: number }[];
  /** Duty owed grouped by commune / chiefdom, largest first. */
  byCommune: { commune: string; montantUSD: number; parcels: number }[];
}

/**
 * Total the cadastral register.
 *
 * `superficieM2` and `nombreUnites` are deliberately kept apart — a kiosk
 * counted as 1 unit must not be added to a 400 m² parcel.
 */
export function totalCadastralRegister(
  parcels: PropertyParcel[]
): CadastralRegisterTotals {
  const totals: CadastralRegisterTotals = {
    parcels: parcels.length,
    superficieM2: 0,
    nombreUnites: 0,
    totalImpotUSD: 0,
    byUsage: [],
    byCommune: [],
  };

  const usageMap = new Map<string, { montantUSD: number; parcels: number }>();
  const communeMap = new Map<string, { montantUSD: number; parcels: number }>();

  parcels.forEach((p) => {
    if (p.measureKind === 'superficie') totals.superficieM2 += p.measureValue || 0;
    else totals.nombreUnites += p.measureValue || 0;

    totals.totalImpotUSD += p.montantImpotUSD || 0;

    const usage = usageMap.get(p.usage) || { montantUSD: 0, parcels: 0 };
    usage.montantUSD += p.montantImpotUSD || 0;
    usage.parcels += 1;
    usageMap.set(p.usage, usage);

    const commune = communeMap.get(p.communeChefferie) || { montantUSD: 0, parcels: 0 };
    commune.montantUSD += p.montantImpotUSD || 0;
    commune.parcels += 1;
    communeMap.set(p.communeChefferie, commune);
  });

  const toSorted = (map: Map<string, { montantUSD: number; parcels: number }>, key: string) =>
    Array.from(map.entries())
      .map(([name, v]) => ({ [key]: name, montantUSD: v.montantUSD, parcels: v.parcels }))
      .sort((a, b) => b.montantUSD - a.montantUSD);

  totals.byUsage = toSorted(usageMap, 'usage') as CadastralRegisterTotals['byUsage'];
  totals.byCommune = toSorted(communeMap, 'commune') as CadastralRegisterTotals['byCommune'];

  return totals;
}

/**
 * Header labels for the cadastral declaration table, in declaration order.
 *
 * `label` is the full French form wording and is what the CSV export prints.
 * `shortLabel` is the condensed heading used on screen: the full labels are
 * single long tokens ("Quartier/groupement") that cannot wrap inside a
 * table-layout:fixed column and would overlap their neighbours. The full
 * wording stays available as the column's tooltip.
 */
export const CADASTRAL_COLUMNS: {
  key: keyof PropertyParcel | 'montant';
  label: string;
  shortLabel: string;
  hint: string;
  align: 'left' | 'right' | 'center';
  numeric?: boolean;
}[] = [
  { key: 'nature', label: 'Nature', shortLabel: 'Nature', hint: 'Type of registered asset', align: 'left' },
  { key: 'villeTerritoire', label: 'Ville/territoire', shortLabel: 'Ville', hint: 'City or territory', align: 'left' },
  { key: 'communeChefferie', label: 'Commune/chefferie', shortLabel: 'Commune', hint: 'Commune or chiefdom', align: 'left' },
  { key: 'quartierGroupement', label: 'Quartier/groupement', shortLabel: 'Quartier', hint: 'Quarter or grouping', align: 'left' },
  { key: 'avenueLocalite', label: 'Avenue/Localite', shortLabel: 'Avenue', hint: 'Street or locality', align: 'left' },
  // This column is the parcel's identifier, so it is headed in full rather than
  // as a bare "Numéro" — the short form left officers guessing what it numbered.
  { key: 'numeroParcelle', label: 'Numéro de parcelle', shortLabel: 'Numéro de parcelle', hint: 'Cadastral parcel number', align: 'center', numeric: true },
];

/** Which column dimension a footer total belongs to. */
export const CADASTRAL_TOTAL_KIND: Partial<Record<string, PropertyTotalKind>> = {
  measureValue: 'superficie',
  montant: 'montant',
};

/** Render the measured extent with its unit, never as a bare number. */
export function formatMeasure(value: number, kind: PropertyMeasureKind): string {
  if (kind === 'superficie') return `${value.toLocaleString('en-US')} m²`;
  return `${value.toLocaleString('en-US')} unité${value === 1 ? '' : 's'}`;
}

/** Render the combined tariff + duty cell. */
export function formatTariffAndDuty(tauxUSD: number, montantUSD: number): { taux: string; montant: string } {
  return {
    taux: `${formatMoney(tauxUSD)}/u`,
    montant: `${formatMoney(montantUSD)}`,
  };
}
