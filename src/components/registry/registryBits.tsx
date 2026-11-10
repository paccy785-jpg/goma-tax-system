import { formatMoney } from '../../utils/money';
import React from 'react';
import { BadgeCheck, CircleAlert, Clock, Ban, TriangleAlert, FileQuestion } from 'lucide-react';
import { Badge } from '../ui';
import { TaxpayerComplianceState } from '../../types';
import { COMPLIANCE_STATE_LABELS } from '../../services/taxpayerService';

/** Badge variant backing each derived fiscal state. */
export const COMPLIANCE_VARIANT: Record<TaxpayerComplianceState, 'sage' | 'warn' | 'danger' | 'neutral' | 'accent'> = {
  compliant: 'sage',
  outstanding: 'warn',
  overdue: 'danger',
  suspended: 'neutral',
  closure: 'danger',
  unassessed: 'accent',
};

export const ComplianceBadge: React.FC<{ state: TaxpayerComplianceState; size?: 'sm' | 'md' }> = ({
  state,
  size = 'md',
}) => (
  <Badge variant={COMPLIANCE_VARIANT[state]} size={size} dot>
    {COMPLIANCE_STATE_LABELS[state]}
  </Badge>
);

export const COMPLIANCE_ICON: Record<TaxpayerComplianceState, React.ReactNode> = {
  compliant: <BadgeCheck className="w-3 h-3" />,
  outstanding: <Clock className="w-3 h-3" />,
  overdue: <CircleAlert className="w-3 h-3" />,
  suspended: <Ban className="w-3 h-3" />,
  closure: <TriangleAlert className="w-3 h-3" />,
  unassessed: <FileQuestion className="w-3 h-3" />,
};

/** Stable initials for the registry avatar tile. */
export function initialsOf(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Deterministic tint for an avatar tile, so a taxpayer keeps one colour. */
const TINTS = ['accent', 'sage', 'navy', 'warn'] as const;
export function tintFor(seed: string): (typeof TINTS)[number] {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum += seed.charCodeAt(i);
  return TINTS[sum % TINTS.length];
}

export const TINT_CLASS: Record<(typeof TINTS)[number], string> = {
  accent: 'bg-accent-soft text-accent',
  sage: 'bg-sage/12 text-sage',
  navy: 'bg-navy/10 text-navy',
  warn: 'bg-warn/15 text-warn',
};

/**
 * Money on the registry and dossier — the system-wide "105$" format.
 * `decimals` is kept for existing callers; cents now show only when present.
 */
export function usd(amount: number, _opts: { decimals?: boolean } = {}): string {
  return formatMoney(amount);
}

/** Pretty YYYY-MM-DD for display, tolerating ISO timestamps. */
export function prettyDate(value?: string): string {
  if (!value) return '—';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const date = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
