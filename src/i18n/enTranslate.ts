/**
 * French → English translation used when the toggle is on EN.
 *
 * Most of the app's domain text (declarations, transfers, bank agent, the
 * printed dossier…) is written in French. In English mode every one of those
 * strings is swapped for English: fixed labels through the `EN` dictionary,
 * sentences built from numbers or names through the patterns below, and amounts
 * spelled out in French words ("cent cinq dollars américains") re-spelled in
 * English. English text is never matched, so it is left exactly as written.
 */
import { EN } from './en';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lcFirst = (s: string) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Dictionary lookup tolerant of a lower-cased or capitalised first letter. */
function lookup(raw: string): string | undefined {
  const key = norm(raw);
  if (!key) return undefined;
  const hit = EN[key];
  if (hit !== undefined) return hit;
  const cap = EN[capFirst(key)];
  if (cap !== undefined && key[0] !== key[0].toUpperCase()) return lcFirst(cap);
  const low = EN[key[0].toLowerCase() + key.slice(1)];
  if (low !== undefined) return capFirst(low);
  return undefined;
}

/** Translate a fragment if the dictionary knows it, else leave it as is. */
const t = (s: string) => lookup(s) ?? s;
const n = (s: string) => Number(String(s).replace(/[\s  ]/g, ''));
const pl = (count: string, one: string, many: string) => (n(count) === 1 ? one : many);
const quote = (s: string) => `“${s}”`;
/** "en cours" style period ends → English. */
const periodEnd = (s: string) => (/^en cours$/i.test(s.trim()) ? 'ongoing' : s);

/* ------------------------------------------------------------------ */
/* Amounts spelled out in French                                        */
/* ------------------------------------------------------------------ */

const FR_NUM: Record<string, number> = {
  zéro: 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};

/** Parses French number words ("quatre-vingt-dix-sept mille deux cents") to an integer. */
function parseFrenchInt(words: string): number | null {
  const tokens = words.toLowerCase().split(/[\s-]+/).filter((w) => w && w !== 'et');
  if (!tokens.length) return null;
  let total = 0;
  let current = 0;
  let prev = '';
  for (const tok of tokens) {
    if (tok in FR_NUM) {
      const v = FR_NUM[tok];
      // "quatre-vingt" = 4 × 20
      if ((tok === 'vingt' || tok === 'vingts') && prev === 'quatre') current += 80 - 4;
      else current += v;
    } else if (tok === 'cent' || tok === 'cents') {
      current = (current || 1) * 100;
    } else if (tok === 'mille') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (tok === 'million' || tok === 'millions') {
      total += (current || 1) * 1_000_000;
      current = 0;
    } else if (tok === 'milliard' || tok === 'milliards') {
      total += (current || 1) * 1_000_000_000;
      current = 0;
    } else {
      return null;
    }
    prev = tok;
  }
  return total + current;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below1000(v: number): string {
  const parts: string[] = [];
  const h = Math.floor(v / 100);
  const r = v % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  }
  return parts.join(' ');
}

/** 1234567 → "one million two hundred thirty-four thousand five hundred sixty-seven". */
export function integerToEnglishWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  let v = Math.trunc(Math.abs(value));
  if (v === 0) return 'zero';
  const scales: [number, string][] = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1000, 'thousand']];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    if (v >= size) {
      parts.push(`${below1000(Math.floor(v / size))} ${name}`);
      v %= size;
    }
  }
  if (v) parts.push(below1000(v));
  return parts.join(' ');
}

const AMOUNT_RE =
  /^(moins )?([a-zàâçéèêëîïôûùü\- ]+?) (?:de )?dollars? américains?(?: et ([a-zàâçéèêëîïôûùü\- ]+?) centimes?)?$/i;
const CENTS_ONLY_RE = /^(moins )?([a-zàâçéèêëîïôûùü\- ]+?) centimes?$/i;

/** "Cent vingt-cinq dollars américains et cinquante centimes" → English, or null. */
function frenchAmountToEnglish(text: string): string | null {
  const s = text.trim();
  let dollars = 0;
  let cents = 0;
  let negative = false;
  let m = s.match(AMOUNT_RE);
  if (m) {
    negative = !!m[1];
    const d = parseFrenchInt(m[2]);
    if (d === null) return null;
    dollars = d;
    if (m[3]) {
      const c = parseFrenchInt(m[3]);
      if (c === null) return null;
      cents = c;
    }
  } else if ((m = s.match(CENTS_ONLY_RE))) {
    negative = !!m[1];
    const c = parseFrenchInt(m[2]);
    if (c === null) return null;
    cents = c;
  } else {
    return null;
  }
  let out: string;
  if (dollars === 0 && cents > 0) {
    out = `${integerToEnglishWords(cents)} cent${cents === 1 ? '' : 's'}`;
  } else {
    out = `${integerToEnglishWords(dollars)} US dollar${dollars === 1 ? '' : 's'}`;
    if (cents > 0) out += ` and ${integerToEnglishWords(cents)} cent${cents === 1 ? '' : 's'}`;
  }
  if (negative) out = `minus ${out}`;
  return /^[A-ZÀ-Ý]/.test(s) ? capFirst(out) : out;
}

/* ------------------------------------------------------------------ */
/* Sentences built at runtime                                           */
/* ------------------------------------------------------------------ */

const LEASES = (c: string) => pl(c, 'lease', 'leases');

/** Each regex must match the whole (whitespace-collapsed) string. */
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  // ---- counters
  [/^Revenu brut (\d{4}) des baux des locataires sélectionnés \(loyer mensuel × mois loués\)\.$/,
    (_, y) => `${y} gross income of the selected tenants' leases (monthly rent × months let).`],
  [/^(\d+) notes de perception de démonstration ajoutées, dont (\d+) payées\.$/, (_, a, b) => `${a} demo notes de perception added, ${b} of them paid.`],
  [/^(\d+) notes? de perception sur (\d+)$/, (_, a, b) => `${a} of ${b} ${pl(b, 'note', 'notes')} de perception`],
  [/^Aucune note de perception enregistrée ne correspond à « (.+) »\.$/, (_, x) => `No registered note de perception matches “${x}”.`],
  [/^(\d+) impôts? sur (\d+)$/, (_, a, b) => `${a} of ${b} ${pl(b, 'tax', 'taxes')}`],
  [/^Aucun impôt de la nomenclature ne correspond à « (.+) »\.$/, (_, x) => `No tax in the nomenclature matches “${x}”.`],
  [/^(\d+) impôts? dans la nomenclature — recherchez par article budgétaire, libellé ou titre\.$/,
    (_, c) => `${c} ${pl(c, 'tax', 'taxes')} in the nomenclature — search by budget article, label or title.`],
  [/^Taux : (.+)$/, (_, x) => `Rate: ${x}`],
  [/^Cet article budgétaire est déjà utilisé sous le titre « (.+) »\. Les impôts qui partagent un article doivent avoir le même titre\.$/, (_, x) => `This budget article is already used under the title “${x}”. Taxes that share an article must have the same title.`],
  [/^Affiché : (.+)$/, (_, x) => `Shown as: ${x}`],
  [/^Article budgétaire (.+) modifié\.$/, (_, x) => `Budget article ${x} updated.`],
  [/^Modifier l'article (.+)$/, (_, x) => `Edit article ${x}`],
  [/^Article budgétaire (.+) supprimé de la nomenclature\.$/, (_, x) => `Budget article ${x} deleted from the nomenclature.`],
  [/^Supprimer l'article (.+)$/, (_, x) => `Delete article ${x}`],
  [/^Article budgétaire (.+) ajouté à la nomenclature\.$/, (_, x) => `Budget article ${x} added to the nomenclature.`],
  [/^(\d+) impôts?$/, (_, c) => `${c} ${pl(c, 'tax', 'taxes')}`],
  [/^taxée le (.+)$/, (_, d) => `taxed on ${d}`],
  [/^Aucune note de perception de (.+) n'attend de paiement\.$/, (_, x) => `No note de perception for ${x} is awaiting payment.`],
  [/^Contribuable : (.+?) · NIF (.+)$/, (_, a, b) => `Taxpayer: ${a} · NIF ${b}`],
  [/^Contribuable : (.+)$/, (_, a) => `Taxpayer: ${a}`],
  [/^Chèque bancaire n° (.+) — Banque : (.+) — Date du chèque : (\S+)$/, (_, n, b, d) => `Bank check No. ${n} — Bank: ${b} — Check date: ${d}`],
  [/^Chèque bancaire n° (.+) — Banque : (.+)$/, (_, n, b) => `Bank check No. ${n} — Bank: ${b}`],
  [/^Chèque bancaire n° (.+)$/, (_, n) => `Bank check No. ${n}`],
  [/^Chèque postal n° (.+)$/, (_, n) => `Postal check No. ${n}`],
  [/^Avis de crédit n° (.+)$/, (_, n) => `Credit advice No. ${n}`],
  [/^Paiement de (.+) enregistré pour la note de perception (.+) — quittance n° (.+)\.$/, (_, amt, num, q) => `Payment of ${amt} recorded for note de perception ${num} — receipt No. ${q}.`],
  [/^Paiement enregistré — note de perception (.+) : (.+), quittance n° (.+), (.+), bureau comptable (.+), comptable (.+), le (\S+)\.$/,
    (_, num, amt, q, mode, bc, who, d) => `Payment recorded — note de perception ${num}: ${amt}, receipt No. ${q}, ${t(mode)}, accounting office ${bc}, accountant ${who}, on ${d}.`],
  [/^(\d+) paiements? de note de perception enregistrés?$/, (_, c) => `${c} note de perception ${pl(c, 'payment', 'payments')} recorded`],
  [/^Reprendre le montant taxé : (.+)$/, (_, x) => `Use the taxed amount: ${x}`],
  [/^(\d+) notes? de perception enregistrées?$/, (_, c) => `${c} ${pl(c, 'note', 'notes')} de perception recorded`],
  [/^Note de perception (.+) enregistrée\.$/, (_, x) => `Note de perception ${x} recorded.`],
  [/^Note de perception (.+?) enregistrée — (?:contribuable (.+?), )?article budgétaire (.+), (\d+) acte\(s\), arrêté n° (.+), montant (.+), agent taxateur (.+) \((.+)\)\.$/,
    (_, num, tp, art, c, arr, amt, agent, q) =>
      `Note de perception ${num} recorded — ${tp ? `taxpayer ${tp}, ` : ''}budget article ${art}, ${c} ${pl(c, 'act', 'acts')}, decree No. ${arr}, amount ${amt}, taxation officer ${agent} (${q}).`],
  [/^Contribuable : (.+)$/, (_, x) => `Taxpayer: ${x}`],
  [/^(\d+) déclarations? à payer$/, (_, c) => `${c} ${pl(c, 'declaration', 'declarations')} to pay`],
  [/^(\d+) sur (\d+) calculs?$/, (_, a, b) => `${a} of ${b} ${pl(b, 'calculation', 'calculations')}`],
  [/^(\d+) calculs? enregistrés?$/, (_, c) => `${c} ${pl(c, 'calculation', 'calculations')} recorded`],
  [/^(\d+) calculs? locatifs?$/, (_, c) => `${c} rental ${pl(c, 'calculation', 'calculations')}`],
  [/^(\d+) calculs? fonciers?$/, (_, c) => `${c} property tax ${pl(c, 'calculation', 'calculations')}`],
  [/^(\d+) sur (\d+) transferts?$/, (_, a, b) => `${a} of ${b} ${pl(b, 'transfer', 'transfers')}`],
  [/^(\d+) transferts? enregistrés?$/, (_, c) => `${c} ${pl(c, 'transfer', 'transfers')} recorded`],
  [/^(\d+) propriétés? déclarées?$/, (_, c) => `${c} declared ${pl(c, 'property', 'properties')}`],
  [/^(\d+) locataires? déclarés?$/, (_, c) => `${c} declared ${pl(c, 'tenant', 'tenants')}`],
  [/^(\d+) contribuables?$/, (_, c) => `${c} ${pl(c, 'taxpayer', 'taxpayers')}`],
  [/^(\d+) (?:bail|baux|bails) — exercice (\d{4})$/, (_, c, y) => `${c} ${LEASES(c)} — fiscal year ${y}`],
  [/^(\d+) lignes?(.*)$/, (_, c, rest) => `${c} ${pl(c, 'line', 'lines')}${rest}`],
  [/^(\d+) commune\(s\)$/, (_, c) => `${c} commune(s)`],
  [/^(\d+) quartier\(s\)$/, (_, c) => `${c} neighborhood(s)`],
  [/^([\d\s  .,]+) unités?$/, (_, c) => `${c.trim()} ${pl(c, 'unit', 'units')}`],
  [/^(\d+) déclarations?$/, (_, c) => `${c} ${pl(c, 'declaration', 'declarations')}`],
  [/^(\d+) mois$/, (_, c) => `${c} ${pl(c, 'month', 'months')}`],
  [/^(\d+) mois en (\d{4})$/, (_, c, y) => `${c} ${pl(c, 'month', 'months')} in ${y}`],
  [/^(\d+) propriétés? sélectionnées?$/, (_, c) => `${c} ${pl(c, 'property', 'properties')} selected`],
  [/^(\d+) locataires? sélectionnés?$/, (_, c) => `${c} ${pl(c, 'tenant', 'tenants')} selected`],
  [/^les (\d+) baux$/, (_, c) => `the ${c} leases`],
  [/^Ses (\d+) baux suivront$/, (_, c) => `Its ${c} leases will follow`],
  [/^(\d+) bailleurs? · (\d+) locataires?$/, (_, a, b) => `${a} ${pl(a, 'landlord', 'landlords')} · ${b} ${pl(b, 'tenant', 'tenants')}`],

  // ---- searches / empty states
  [/^Pour : (.+)$/, (_, x) => `For: ${x}`],
  [/^Aucune déclaration ne correspond à « (.+) »\.$/, (_, q) => `No declaration matches ${quote(q)}.`],
  [/^Aucun calcul locatif pour un bailleur ou un locataire correspondant à « (.+) »\.$/, (_, q) => `No rental calculation for a landlord or tenant matching ${quote(q)}.`],
  [/^Aucun calcul foncier pour un bailleur ou un locataire correspondant à « (.+) »\.$/, (_, q) => `No property tax calculation for a landlord or tenant matching ${quote(q)}.`],
  [/^Aucune notification ne correspond à « (.+) »\.$/, (_, q) => `No notification matches ${quote(q)}.`],
  [/^Aucun transfert pour « (.+) »\.$/, (_, q) => `No transfer for ${quote(q)}.`],
  [/^Aucune propriété n’est déclarée au nom de (.+)\.$/, (_, x) => `No property is declared in the name of ${x}.`],
  [/^Aucune propriété de (.+) n’est donnée en location\.$/, (_, x) => `None of ${x}’s properties is rented out.`],
  [/^Aucun calcul d’impôt foncier pour (.+)\.$/, (_, x) => `No property tax calculation for ${x}.`],
  [/^Aucun calcul d’impôt locatif pour (.+)\.$/, (_, x) => `No rental tax calculation for ${x}.`],
  [/^pour « (.+) »$/, (_, q) => `for ${quote(q)}`],

  // ---- notifications
  [/^aujourd’hui à (.+)$/, (_, x) => `today at ${x}`],
  [/^hier à (.+)$/, (_, x) => `yesterday at ${x}`],
  [/^(\d{1,2}\/\d{1,2}\/\d{4}) à (.+)$/, (_, d, x) => `${d} at ${x}`],
  [/^Déclaration d’impôt foncier — (.+)$/, (_, x) => `Property tax declaration — ${t(x)}`],
  [/^Déclaration d’impôt locatif — (.+)$/, (_, x) => `Rental tax declaration — ${t(x)}`],
  [/^Paiement confirmé — (.+)$/, (_, x) => `Payment confirmed — ${t(x)}`],
  [/^(.+) • Réf\. (.+)$/, (_, a, b) => `${t(a)} • Ref. ${b}`],
  [/^Transfert de propriété — (.+) → (.+)$/, (_, a, b) => `Property transfer — ${a} → ${b}`],

  // ---- taxpayer profile / print
  [/^Imprimer le dossier de (.+)$/, (_, x) => `Print the file of ${x}`],
  [/^Dossier de (.+)$/, (_, x) => `File of ${x}`],
  [/^Précision sur les propriétés données en location — exercice (\d+)$/, (_, y) => `Details of rented properties — fiscal year ${y}`],

  // ---- toasts and confirmations
  [/^Paiement de (.+) confirmé pour (.+) — réf\. (.+?)\. Reçu (\S+) ajouté à l’historique des paiements\.$/,
    (_, a, b, r, n) => `Payment of ${a} confirmed for ${b} — ref. ${r}. Receipt ${n} added to the payment history.`],
  [/^Paiement de (.+) confirmé pour (.+) — réf\. (.+)\.$/, (_, a, b, r) => `Payment of ${a} confirmed for ${b} — ref. ${r}.`],
  [/^Calcul foncier enregistré pour (.+) — total impôt dû (.+)\.$/, (_, a, b) => `Property tax calculation saved for ${a} — total tax due ${b}.`],
  [/^Calcul enregistré pour (.+) — solde à payer (.+)\.$/, (_, a, b) => `Calculation saved for ${a} — balance due ${b}.`],
  [/^Date (de début|de fin) invalide — ce jour n’existe pas dans le calendrier \(ex\. 31\/04\)\.$/, (_, w) => `Invalid ${w === 'de début' ? 'start' : 'end'} date — this day does not exist in the calendar (e.g. 31/04).`],
  [/^Bail enregistré pour (.+?) — (.+)\.$/, (_, a, b) => `Lease recorded for ${a} — ${b}.`],
  [/^Période et loyer enregistrés pour (.+)\.$/, (_, a) => `Period and rent saved for ${a}.`],
  [/^Nouveau bail créé pour (.+) : (.+) → (.+)\. Le bail précédent reste inchangé\.$/, (_, a, b, c) => `New lease created for ${a}: ${b} → ${periodEnd(c)}. The previous lease stays unchanged.`],
  [/^Locataire retiré de cette propriété(?: — départ le (.+?))?(?: \((.+)\))?$/, (_, d, r) => `Tenant removed from this property${d ? ` — left on ${d}` : ''}${r ? ` (${r})` : ''}`],
  [/^(.+) retirés? de la propriété\. Le bail reste au registre, marqué clôturé\.$/, (_, a) => `${a} removed from the property. The lease stays in the register, marked closed.`],
  [/^\(départ le (.+)\)$/, (_, d) => `(left on ${d})`],
  [/^— départ le (.+)$/, (_, d) => `— left on ${d}`],
  [/^Locataire parti · (.+)$/, (_, d) => `Tenant left · ${d}`],
  [/^Propriété transférée de (.+) à (.+)\.$/, (_, a, b) => `Property transferred from ${a} to ${b}.`],
  [/^La référence « (.+) » a déjà été utilisée pour un autre paiement\.$/, (_, r) => `The reference ${quote(r)} has already been used for another payment.`],
  [/^Cette propriété n’appartient plus à (.+) — elle a déjà été transférée\. Actualisez la page\.$/, (_, a) => `This property no longer belongs to ${a} — it has already been transferred. Refresh the page.`],
  [/^Ligne (\d+) : sélectionnez le rang\.$/, (_, l) => `Line ${l}: select the rank.`],
  [/^Ligne (\d+) : sélectionnez l’usage\.$/, (_, l) => `Line ${l}: select the use.`],
  [/^Ligne (\d+) : choisissez superficie ou nombre\.$/, (_, l) => `Line ${l}: choose area or count.`],
  [/^Ligne (\d+) : le nombre doit être un entier\.$/, (_, l) => `Line ${l}: the count must be a whole number.`],
  [/^Ligne (\d+) : (superficie|nombre|taux) invalide\.$/, (_, l, w) => `Line ${l}: invalid ${w === 'superficie' ? 'area' : w === 'nombre' ? 'count' : 'rate'}.`],
  [/^Trop-perçu : (.+)$/, (_, a) => `Overpayment: ${frenchAmountToEnglish(a) ?? a}`],

  // ---- audit log entries written in French
  [/^Calcul d'impôts enregistré — (bailleur|locataire) (.+) : revenu brut (.+) × (.+) % = (.+), retenues (.+), solde (.+) \((.+)\)\.$/,
    (_, who, name, rb, rate, due, ret, bal, mode) =>
      `Tax calculation saved — ${who === 'bailleur' ? 'landlord' : 'tenant'} ${name}: gross income ${rb} × ${rate}% = ${due}, withholdings ${ret}, balance ${bal} (${t(mode)}).`],
  [/^Calcul d'impôt foncier enregistré pour (.+) — (\d+) lignes?, total impôt dû (.+) \((.+)\)\.$/,
    (_, a, c, due, mode) => `Property tax calculation saved for ${a} — ${c} ${pl(c, 'line', 'lines')}, total tax due ${due} (${t(mode)}).`],
  [/^Paiement confirmé par la banque — (.+?), (.+) : (.+?), référence (.+?)(?:, reçu (\S+))?\.$/,
    (_, kind, who, amt, ref, rec) =>
      `Payment confirmed by the bank — ${t(kind)}, ${who}: ${amt}, reference ${ref}${rec ? `, receipt ${rec}` : ''}.`],
  [/^Transfert de propriété \((.+?)\) — (.+?) \((.*?)\) : (.+) → (.+), le (\d{4}-\d{2}-\d{2})(?:, (\d+) bail\(aux\) transféré\(s\))?\.$/,
    (_, kind, parcel, place, a, b, d, c) =>
      `Property transfer (${t(kind)}) — ${parcel.replace(/^parcelle /, 'parcel ')} (${place}): ${a} → ${b}, on ${d}${c ? `, ${c} ${LEASES(c)} transferred` : ''}.`],
  [/^Bail enregistré — locataire\(s\) (.+) sur parcelle (.+?) \((.+)\) — (.+?)(?:, bailleur (.+?))?(?: Loyer mensuel (.+)\.| Loyer non encore chiffré\.)$/,
    (_, ten, parcel, place, nat, bail, rent) =>
      `Lease recorded — tenant(s) ${ten} on parcel ${parcel} (${place}) — ${t(nat)}${bail ? `, landlord ${bail}` : ''}${rent ? `. Monthly rent ${rent}.` : '. Rent not yet priced.'}`],
  [/^Bail verrouillé — (.+) : période (.+) → (.+), loyer mensuel (.+)\.$/,
    (_, ten, a, b, r) => `Lease locked — ${ten}: period ${a} → ${periodEnd(b)}, monthly rent ${r}.`],
  [/^Ajustement de période — nouveau bail pour (.+) sur parcelle (.+) : (.+) → (.+), loyer mensuel (.+)\. Suite du bail (.+) \((.+) → (.+)\), laissé inchangé\.$/,
    (_, ten, parcel, a, b, r, prev, pa, pb) =>
      `Period adjustment — new lease for ${ten} on parcel ${parcel}: ${a} → ${periodEnd(b)}, monthly rent ${r}. Continues lease ${prev} (${pa} → ${periodEnd(pb)}), left unchanged.`],
  [/^Locataire retiré — (.+) retiré de la parcelle (.+?) \((.+?)\)(?:, bailleur (.+?))?(?:, départ le (.+?))?(?:\. Motif : (.+?))?\. Le bail reste au registre comme pièce de la déclaration\.$/,
    (_, ten, parcel, place, bail, d, why) =>
      `Tenant removed — ${ten} removed from parcel ${parcel} (${place})${bail ? `, landlord ${bail}` : ''}${d ? `, left on ${d}` : ''}${why ? `. Reason: ${why}` : ''}. The lease stays in the register as a declaration record.`],

  // ---- short labels carrying a value
  [/^(?:[A-Z]{2,6} )?Parcelle [^,]+(?:, (?:[A-Z]{2,6} )?Parcelle [^,]+)*$/, (m) => m.replace(/Parcelle/g, 'Parcel')],
  [/^(Bailleur|Locataire) · Pour : (.+)$/, (_, w, x) => `${w === 'Bailleur' ? 'Landlord' : 'Tenant'} · For: ${x}`],
  [/^N° (.+)$/, (_, x) => `No. ${x}`],
  [/^(.+), Parcelle (.+)$/, (_, a, x) => `${a}, Parcel ${x}`],
  [/^Parcelle (.+)$/, (_, x) => `Parcel ${x}`],
  [/^parcelle (.+)$/, (_, x) => `parcel ${x}`],
  [/^• Rang (.+)$/, (_, x) => `• Rank ${x}`],
  [/^Rang (.+)$/, (_, x) => `Rank ${x}`],
  [/^Registered rangs \((\d+)\)$/, (_, c) => `Registered ranks (${c})`],
  [/^(.*)\bfor bailleur (.+)$/, (_, a, x) => `${a}for landlord ${x}`],
  [/^Bailleur (.+)$/, (_, x) => `Landlord ${x}`],
  [/^locataire (.+)$/, (_, x) => `tenant ${x}`],
  [/^bailleur (.+)$/, (_, x) => `landlord ${x}`],
  [/^(.+) — Parcelle (.+), (.+) \((.+)\)$/, (_, a, b, c, d) => `${a} — Parcel ${b}, ${c} (${d})`],
  [/^(.+) → (.+) \((\d+) mois\)$/, (_, a, b, c) => `${a} → ${periodEnd(b)} (${c} ${pl(c, 'month', 'months')})`],
  [/^le (\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} \S+ \d{4})$/, (_, d) => `on ${d}`],
  [/^par (.{1,60})$/, (_, x) => `by ${x}`],
];

/** Text that reads as French — used to refuse a partial (segment) translation. */
const LOOKS_FRENCH =
  /[àâçéèêëîïôûùüœ’]|\b(le|la|les|des|du|de|et|un|une|pour|par|aucun|aucune|est|sont|au|aux|sur|dans|avec|sans|ce|cette|ces|ne|pas|vous|votre|en)\b/i;

/**
 * Last resort: split on separators (" — ", " · ", " / ", ": "…) and translate
 * the pieces, e.g. "EC — Etage et Chalet" or "Rang / usage". Only used when
 * every piece is either translated or plainly not French.
 */
function translateSegments(key: string): string | null {
  const parts = key.split(/( — | – | · | • | \/ | › |: | : |, )/);
  if (parts.length < 3) return null;
  let changed = false;
  const out = parts.map((p, i) => {
    if (i % 2 === 1) return p; // separator
    const whole = translateWhole(p);
    if (whole !== null) {
      changed = true;
      return whole;
    }
    return p;
  });
  if (!changed) return null;
  // Refuse if any untranslated piece is still French.
  for (let i = 0; i < parts.length; i += 2) {
    if (out[i] === parts[i] && LOOKS_FRENCH.test(parts[i])) return null;
  }
  // French puts a space before a colon; English does not.
  return out.join('').replace(/ : /g, ': ');
}

/** Dictionary, then runtime sentences, then amounts in words — on the whole string. */
function translateWhole(raw: string): string | null {
  const key = norm(raw);
  if (!key || !/\p{L}/u.test(key)) return null;
  const hit = lookup(key);
  if (hit !== undefined) return hit;
  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) return fn(...m).replace(/→ en cours\b/g, '→ ongoing');
  }
  return frenchAmountToEnglish(key);
}

/** Returns the English text for a French string, or null when it has none. */
export function translateToEn(raw: string): string | null {
  const key = norm(raw);
  if (!key || !/\p{L}/u.test(key)) return null;
  return translateWhole(key) ?? translateSegments(key);
}
