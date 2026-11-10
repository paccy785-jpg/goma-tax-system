import React from 'react';

export type BadgeVariant = 'sage' | 'warn' | 'danger' | 'neutral' | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  size = 'md',
  dot = false,
  className = '',
}) => {
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-[11px] px-2.5 py-1',
  }[size];

  const variantClasses = {
    sage: 'bg-sage/12 text-sage border-sage/25',
    warn: 'bg-warn/15 text-warn border-warn/30',
    danger: 'bg-danger/12 text-danger border-danger/25',
    neutral: 'bg-surface2 text-muted border-line',
    accent: 'bg-accent-soft text-accent border-accent/20',
  }[variant];

  const dotColorClasses = {
    sage: 'bg-sage',
    warn: 'bg-warn',
    danger: 'bg-danger',
    neutral: 'bg-muted',
    accent: 'bg-accent',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-bold uppercase tracking-wider rounded-full border ${sizeClasses} ${variantClasses} font-sans tabular-nums ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColorClasses} shrink-0`} />}
      {children}
    </span>
  );
};
