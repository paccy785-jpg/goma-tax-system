import { roundMoney } from './frenchNumber';

export function requireMoney(value: number, label: string, allowZero = false): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) ||
      !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(roundMoney(value) - value) > 1e-8) {
    throw new Error(`${label} : saisissez un montant ${allowZero ? 'positif ou nul' : 'supérieur à zéro'}, avec au plus deux décimales.`);
  }
  return roundMoney(value);
}

export function paymentBalances(total: number, previous: number, payment: number) {
  total = requireMoney(total, 'Montant dû', true);
  previous = requireMoney(previous, 'Montant déjà payé', true);
  payment = requireMoney(payment, 'Paiement');
  const remaining = roundMoney(total - previous);
  if (remaining <= 0) throw new Error('Cette note est déjà entièrement payée.');
  if (payment > remaining) throw new Error('Le paiement dépasse le solde restant.');
  const paid = roundMoney(previous + payment);
  return { paid, remaining: roundMoney(total - paid), fullyPaid: paid === total };
}
