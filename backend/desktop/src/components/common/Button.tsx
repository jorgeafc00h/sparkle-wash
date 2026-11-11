import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  'data-testid'?: string;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-accent-600 text-white hover:bg-accent-700 focus:ring-accent-500 border border-transparent',
  secondary:
    'bg-white text-brand-700 hover:bg-brand-50 focus:ring-accent-500 border border-brand-300',
  danger:
    'bg-error text-white hover:bg-red-600 focus:ring-red-400 border border-transparent',
  ghost:
    'bg-transparent text-brand-600 hover:bg-brand-100 focus:ring-accent-500 border border-transparent',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

const spinnerSizeMap: Record<NonNullable<ButtonProps['size']>, 'sm' | 'sm' | 'md'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className = '',
  'data-testid': testId,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      data-testid={testId}
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-offset-1',
        variantClasses[variant],
        sizeClasses[size],
        isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <LoadingSpinner size={spinnerSizeMap[size]} />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children}
    </button>
  );
}

export default Button;
