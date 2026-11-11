import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  rightAddon?: React.ReactNode;
}

export function Input({
  label,
  error,
  helperText,
  required,
  id,
  className = '',
  rightAddon,
  ...rest
}: InputProps) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-brand-700"
        >
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
          }
          className={[
            'w-full rounded-lg border px-3 py-2 text-sm text-brand-900 bg-white',
            'placeholder:text-brand-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
            error
              ? 'border-error focus:ring-error'
              : 'border-brand-300 hover:border-brand-400',
            rest.disabled ? 'opacity-50 cursor-not-allowed bg-brand-50' : '',
            rightAddon ? 'pr-10' : '',
            className,
          ].join(' ')}
          {...rest}
        />
        {rightAddon && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
            {rightAddon}
          </div>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-error">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="text-xs text-brand-500">
          {helperText}
        </p>
      )}
    </div>
  );
}

export default Input;
