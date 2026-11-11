import React from 'react';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  error,
  options,
  placeholder,
  id,
  className = '',
  ...rest
}: SelectProps) {
  const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-brand-700">
          {label}
          {rest.required && <span className="text-error ml-1">*</span>}
        </label>
      )}
      <select
        id={selectId}
        aria-invalid={!!error}
        aria-describedby={error ? `${selectId}-error` : undefined}
        className={[
          'w-full rounded-lg border px-3 py-2 text-sm text-brand-900 bg-white',
          'transition-colors appearance-none',
          'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
          error
            ? 'border-error focus:ring-error'
            : 'border-brand-300 hover:border-brand-400',
          rest.disabled ? 'opacity-50 cursor-not-allowed bg-brand-50' : '',
          className,
        ].join(' ')}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${selectId}-error`} className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export default Select;
