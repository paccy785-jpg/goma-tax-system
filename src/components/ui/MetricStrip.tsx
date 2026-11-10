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
      className={`border-y border-line my-6 grid ${colGridClasses} divide-y sm:divide-y-0 sm:divide-x divide-line bg-surface/40 ${className}`}
    >
      {items.map((item, idx) => {
        const trendColorClass = {
          sage: 'text-sage bg-sage/10',
          danger: 'text-danger bg-danger/10',
          warn: 'text-warn bg-warn/10',
          muted: 'text-muted bg-surface2',
        }[item.trendType || 'muted'];

        return (
          <div key={idx} className="py-4.5 px-6 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[12px] font-bold uppercase tracking-wider text-muted font-sans">
                {item.label}
              </span>
              {item.icon && <span className="text-muted/70">{item.icon}</span>}
            </div>

            <div className="font-display text-[29px] font-bold text-ink leading-tight tabular-nums tracking-tight">
              {item.value}
            </div>

            {(item.trend || item.subline) && (
              <div className="mt-1.5 flex items-center gap-2 text-xs font-sans">
                {item.trend && (
                  <span
                    className={`inline-flex items-center font-bold px-1.5 py-0.5 rounded-full text-[11px] tabular-nums ${trendColorClass}`}
                  >
                    {item.trend}
                  </span>
                )}
                {item.subline && (
                  <span className="text-muted text-[12px] truncate">
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
