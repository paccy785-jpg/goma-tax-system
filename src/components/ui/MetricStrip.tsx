import React from 'react';

export interface MetricItem {
  label: string;
  value: React.ReactNode;
  trend?: string;
  trendType?: 'sage' | 'danger' | 'muted' | 'warn';
  subline?: string;
  icon?: React.ReactNode;
}

export interface MetricStripProps {
  items: MetricItem[];
  className?: string;
  columns?: 1 | 2 | 3 | 4 | 5;
}

export const MetricStrip: React.FC<MetricStripProps> = ({
  items,
  className = '',
  columns = 4,
}) => {
  const colGridClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
  }[columns];

  return (
    <div
      className={`kpi-grid my-6 grid gap-4 ${colGridClasses} ${className}`}
    >
      {items.map((item, idx) => {
        const trendColorClass = {
          sage: 'text-sage bg-sage/10',
          danger: 'text-danger bg-danger/10',
          warn: 'text-warn bg-warn/10',
          muted: 'text-muted bg-surface2',
        }[item.trendType || 'muted'];

        return (
          <div key={idx} data-tone={item.trendType || 'muted'} className="kpi-card p-5 sm:p-6 flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between gap-4 mb-4">
              <span className="kpi-label text-[11px] font-bold uppercase tracking-[0.1em] text-muted font-sans leading-relaxed">
                {item.label}
              </span>
              {item.icon && <span className="kpi-icon shrink-0" aria-hidden="true">{item.icon}</span>}
            </div>

            <div className="kpi-value font-display text-[34px] font-bold text-ink leading-tight tabular-nums tracking-tight">
              {item.value}
            </div>

            {(item.trend || item.subline) && (
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-sans">
                {item.trend && (
                  <span
                    className={`kpi-trend inline-flex items-center font-bold px-2 py-1 rounded-full text-[11px] tabular-nums ${trendColorClass}`}
                  >
                    {item.trend}
                  </span>
                )}
                {item.subline && (
                  <span className="text-muted text-[12px] leading-relaxed">
                    {item.subline}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
