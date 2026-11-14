/**
 * The keys of the DGI portal's final records.
 *
 * A Calcul d'impôt and the payment that settles it are both final once
 * written — the Firestore rules allow create and read only. The document id
 * is therefore part of the control: a record filed under a derived id cannot
 * be created twice, because a second write would be an update, and the rules
 * refuse those. The id is derived from the thing that must be unique (the
 * taxpayer and the period; the calculation being settled), so the uniqueness
 * is enforced by the database rather than by a check that can be raced.
 */

/** The document a Calcul d'impôt is filed under: one per taxpayer and period. */
export function dgiCalculDocId(contribuableId: string, periode: string): string {
  return `calc_${contribuableId}_${periode}`;
}

/** The document a payment against a Calcul d'impôt is filed under. */
export function dgiDeclarationDocId(calculId: string): string {
  return `paid_${calculId}`;
}

/** The period a calculation covers: yyyy-mm, from its month and year. */
export function dgiPeriode(annee: number, salairesMois: number): string {
  return `${annee}-${String(salairesMois).padStart(2, '0')}`;
}

/** The parts of a calculation needed to spot a duplicate. */
export interface DgiCalculPeriodLike {
  contribuableId?: string;
  periode?: string;
}

/** True when a calculation already exists for that taxpayer and period. */
export function hasCalculForPeriod(
  calculs: DgiCalculPeriodLike[],
  contribuableId: string,
  periode: string
): boolean {
  return calculs.some((c) => c.contribuableId === contribuableId && c.periode === periode);
}

/** The parts of a payment needed to spot a duplicate. */
export interface DgiDeclarationLinkLike {
  calculId?: string;
}

/** True when a payment has already been filed against that calculation. */
export function hasPaymentForCalcul(
  declarations: DgiDeclarationLinkLike[],
  calculId: string
): boolean {
  return declarations.some((d) => !!d.calculId && d.calculId === calculId);
}

/**
 * The calculations of a taxpayer that no payment has settled yet.
 *
 * A calculation is settled by one payment: the payment always stands for the
 * whole "Impôt total dû", so settling the same one twice would collect the
 * tax twice and count it twice in every total.
 */
export function unsettledCalculs<T extends { id: string }>(
  calculs: T[],
  declarations: DgiDeclarationLinkLike[]
): T[] {
  const settled = new Set(
    declarations.map((d) => d.calculId).filter((id): id is string => !!id)
  );
  return calculs.filter((c) => !settled.has(c.id));
}
