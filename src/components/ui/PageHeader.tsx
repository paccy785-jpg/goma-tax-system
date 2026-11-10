import React from 'react';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 mb-8 border-b border-line">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-accent mb-1.5 font-sans">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-2xl sm:text-[35px] font-bold tracking-[-0.045em] text-ink leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted max-w-[62ch] mt-1.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap sm:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  );
};
