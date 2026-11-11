import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  'data-testid'?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Buscar...',
  debounceMs = 300,
  'data-testid': testId = 'search-bar',
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local value in sync with external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setLocalValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  function handleClear() {
    setLocalValue('');
    if (timerRef.current) clearTimeout(timerRef.current);
    onChange('');
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative flex items-center" data-testid={testId}>
      <Search
        size={16}
        className="absolute left-3 text-brand-400 pointer-events-none shrink-0"
      />
      <input
        type="search"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={placeholder}
        className={[
          'w-full rounded-lg border border-brand-300 bg-white py-2 text-sm',
          'text-brand-900 placeholder:text-brand-400',
          'pl-9 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
          'hover:border-brand-400',
        ].join(' ')}
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute right-3 text-brand-400 hover:text-brand-600 transition-colors"
          aria-label="Limpiar búsqueda"
          type="button"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export default SearchBar;
