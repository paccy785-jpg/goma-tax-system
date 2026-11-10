import React from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={`border border-dashed border-line rounded-[18px] p-10 text-center bg-surface2/30 flex flex-col items-center justify-center my-4 ${className}`}
    >
      {icon && (
        <div className="w-12 h-12 rounded-[14px] bg-accent-soft text-accent flex items-center justify-center mb-3.5 shadow-xs">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-bold text-ink tracking-tight">
        {title}
      </h3>
      <p className="text-sm text-muted max-w-sm mx-auto mt-1 leading-relaxed font-sans">
        {description}
      </p>
      {actionLabel && onAction && (
        <div className="mt-5">
          <Button variant="ghost" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
};
