import { montantPaiementUSD, NotePerception } from '../../services/notePerceptionService';
import { formatMoney } from '../../utils/money';
import { localDateFromIsoTimestamp } from '../../utils/date';
import { frDay } from './NpSectionTables';

/** Accents, case and spacing ignored, so "societe" finds "Société" and "kivu" finds "KIVU". */
export const foldSearch = (s?: string | number) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** The words of a search, folded — every one must appear in a note for it to match. */
export const searchTokens = (q: string) => foldSearch(q).trim().split(' ').filter(Boolean);

/**
 * Everything a note de perception can be found by: the taxpayer and the
 * taxateur's part (number, article, arrêté, amount, date, agent) and, once
 * paid, the agent bancaire's part (bureau, mode, quittance, comptable, date).
 */
export function noteSearchText(n: NotePerception): string {
  const t = n.taxateur;
  const c = n.comptable;
  const taxDay = localDateFromIsoTimestamp(t?.filledAt || n.createdAt);
  const parts: (string | number | undefined)[] = [
    t?.contribuableName,
    t?.contribuableNif,
    t?.numeroFacture,
    t?.articleBudgetaire,
    t?.arreteNumero,
    t?.nombreActes,
    t?.montantUSD,
    t ? formatMoney(t.montantUSD) : '',
    t?.montantEnLettres,
    t?.nomAgent,
    t?.qualite,
    taxDay,
    frDay(taxDay),
  ];
  if (c) {
    const paid = montantPaiementUSD(c);
    parts.push(c.bureauComptable, c.modePaiement, c.quittanceNumero, c.nomComptable, c.date, frDay(c.date), paid, formatMoney(paid));
  }
  return foldSearch(parts.filter((x) => x !== undefined && x !== '').join(' | '));
}

export const noteMatches = (n: NotePerception, tokens: string[]) => {
  if (tokens.length === 0) return true;
  const hay = noteSearchText(n);
  return tokens.every((tk) => hay.includes(tk));
};
