import React from 'react';

export interface PanelProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Panel: React.FC<PanelProps> = ({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
  padding = 'md',
}) => {
  const paddingClasses = {
    none: 'p-0',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  }[padding];

  return (
    <section
      className={`bg-surface border border-line rounded-[18px] shadow-[0_10px_30px_oklch(20%_0.03_260/0.07)] overflow-hidden transition-premium ${className}`}
    >
      {/* The header belongs to whichever of title / subtitle / actions is
          present. Keying it on `title` alone silently dropped a subtitle-only
          panel heading. */}
      {(title || subtitle || actions) && (
        <div className="px-6 py-4.5 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface/50">
          <div>
            {title && (
              <h2 className="font-display text-base font-semibold text-ink tracking-tight">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-muted mt-0.5 font-sans leading-normal">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={`${paddingClasses} ${bodyClassName}`}>{children}</div>
    </section>
  );
};
