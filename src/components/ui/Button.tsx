import React from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'secondary' | 'danger' | 'navy';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  className = '',
  disabled,
  // A bare <button> inside a <form> defaults to type="submit", so an in-form
  // action button used to run its onClick AND submit the form — two writes for
  // one click. Buttons opt into submitting with an explicit type="submit".
  type = 'button',
  ...props
}) => {
  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 rounded-[10px] min-h-[34px]',
    md: 'text-sm px-4 py-2 rounded-[10px] min-h-[40px]',
    lg: 'text-sm px-5 py-2.5 rounded-[10px] min-h-[44px]',
  }[size];

  const variantClasses = {
    primary:
      'bg-accent hover:bg-accent-dark text-white font-medium shadow-[0_4px_12px_oklch(57%_0.16_36/0.25)] border border-transparent',
    ghost:
      'bg-surface hover:border-accent hover:text-accent text-ink font-medium border border-line shadow-xs',
    secondary:
      'bg-surface2 hover:bg-line text-ink font-medium border border-transparent',
    danger:
      'bg-danger hover:opacity-90 text-white font-medium border border-transparent shadow-[0_4px_12px_oklch(57%_0.16_24/0.25)]',
    navy:
      'bg-navy hover:bg-navy2 text-white font-medium border border-transparent',
  }[variant];

  const disabledClass = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer active:scale-[0.98]';

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 transition-premium font-sans ${sizeClasses} ${variantClasses} ${disabledClass} ${className}`}
      type={type}
      disabled={disabled}
      {...props}
    >
      {icon && iconPosition === 'left' && <span className="shrink-0">{icon}</span>}
      {children}
      {icon && iconPosition === 'right' && <span className="shrink-0">{icon}</span>}
    </button>
  );
};
