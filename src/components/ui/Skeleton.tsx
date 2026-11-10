import React from 'react';

export interface SkeletonProps {
  className?: string;
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = 'h-4 w-full', count = 1 }) => {
  if (count <= 1) {
    return (
      <div
        className={`bg-surface2 animate-pulse rounded-[8px] ${className}`}
      />
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`bg-surface2 animate-pulse rounded-[8px] ${className}`}
        />
      ))}
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 5 }) => {
  return (
    <div className="w-full divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-4 px-6">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className={`h-4 bg-surface2 animate-pulse rounded-[6px] ${
                c === 0 ? 'w-48' : c === cols - 1 ? 'w-20 ml-auto' : 'w-28'
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
