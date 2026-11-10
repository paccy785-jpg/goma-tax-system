/**
 * Central brand source of truth.
 *
 * The operating organization is DPRNK. Every app surface and every generated
 * document (receipts, certificates, assessment notices, settlement records,
 * verification screens) must read its authority name from here so a future
 * rename is a one-line change.
 *
 * RULE: nothing outside this file may spell the brand. If a surface needs a
 * name, it imports it. The one thing that may not be renamed away silently is
 * history — see LEGACY_OFFICE_LABELS.
 */

export const BRAND = {
  /** Short authority name shown in titles, mastheads and footers. */
  shortName: 'DPRNK',
  /** Monogram rendered in the logo mark. */
  monogram: 'DPRNK',
  /** Eyebrow line above the sign-in masthead. */
  loginEyebrow: 'Dem. Rep. of the Congo • North Kivu',
  /**
   * Full authority name printed on official documents. DPRNK is issued as a
   * single word with no expansion, so this equals the short name; it is kept
   * distinct so a future expansion is a one-line change, and so document
   * mastheads read from a "full name" field.
   */
  fullName: 'DPRNK',
  /** Browser tab / portal title. */
  portalTitle: 'DPRNK',
  /** Terminal name on the loading screen. */
  terminalName: 'DPRNK Revenue Terminal',
  /** Product descriptor, shown under the brand where the name alone reads thin. */
  tagline: 'Revenue command center',
  /** Jurisdiction line for app chrome footers. */
  jurisdiction: 'Democratic Republic of the Congo • Province of North Kivu • City of Goma',
  /** System line for the app footer and the sign-in screen. */
  systemLine: 'DPRNK — Revenue Command Center',
  /** Default office for newly provisioned users. */
  defaultOffice: 'DPRNK — Goma Main Office',
  /** Fallback officer label when no profile is loaded. */
  fallbackCashierName: 'DPRNK Counter Cashier',
  /** Authority line printed on official documents. */
  docAuthority: 'DPRNK',
  /** Issuing-office line printed on certificates. */
  docIssuingOffice: 'DPRNK — Goma Division',
  /** Official stamp placeholder text on documents. */
  docStamp: '[Official Stamp DPRNK]',
  /** QR payload app tag encoded into new receipts. */
  qrAppTag: 'DPRNK-TAX',
} as const;

/** Independently branded portals served by this deployment. */
export type PortalId = 'dprnk' | 'dgi';

/**
 * DGI portal identity.
 *
 * The DGI workspace is provisioned ahead of its build-out. Only the surfaces
 * that exist today (sign-in, loading, portal shell) read from this object; the
 * full DGI module will extend it when that work begins.
 */
export const DGI_BRAND = {
  shortName: 'DGI',
  monogram: 'DGI',
  loginEyebrow: 'Dem. Rep. of the Congo • DGI',
  fullName: 'Direction Générale des Impôts',
  portalTitle: 'DGI Portal',
  terminalName: 'DGI Revenue Terminal',
  tagline: 'Tax administration portal',
  jurisdiction: 'Democratic Republic of the Congo',
  systemLine: 'DGI — Tax Administration Portal',
  /** Default office for newly provisioned DGI users. */
  defaultOffice: 'DGI — Goma',
} as const;

/** Resolve the brand for a portal. */
export function portalBrand(portal: PortalId) {
  return portal === 'dgi' ? DGI_BRAND : BRAND;
}

/**
 * Office labels issued under the previous brand.
 *
 * The renaming must not strand users already provisioned with the old office
 * string: a live record still reads "DGI — Goma Main Office", and rewriting
 * Firestore from the client would be both unverifiable and a silent edit of
 * someone's record. Instead those labels are normalized on read, so old and new
 * records display identically while history stays intact.
 */
const LEGACY_OFFICE_LABELS: readonly string[] = ['DGI — Goma Main Office'];

/** Office label for display: legacy labels resolve to the current brand. */
export function officeLabel(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return BRAND.defaultOffice;
  if (LEGACY_OFFICE_LABELS.includes(raw)) return BRAND.defaultOffice;
  return raw;
}

/**
 * Largest whole pixel size at which the monogram fits inside a brand mark.
 *
 * Callers pass the mark's box; `inset` reserves breathing room on both sides.
 * The per-glyph figure is measured, not assumed: Space Grotesk Bold renders
 * "DPRNK" at 3.078px per point of font-size, i.e. 0.616em per glyph. A
 * 5-character monogram needs a visibly smaller size than the 3-character one
 * this formula replaced, so the size is derived rather than hard-coded.
 */
export function monogramSize(
  box = 38,
  inset = 6,
  glyph = 0.616,
  characters = BRAND.monogram.length,
): number {
  const size = Math.floor((box - inset) / (Math.max(1, characters) * glyph));
  return Math.max(7, size);
}
