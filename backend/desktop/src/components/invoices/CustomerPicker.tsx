import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, UserPlus, User, ChevronDown, X } from 'lucide-react';
import { useAppSelector } from '@/store';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { Customer, CustomerType } from '@/types/customer';

export interface CustomerPickerProps {
  value?: string;
  onChange: (customerId: string, customer: Customer) => void;
  companyId: string;
  placeholder?: string;
  disabled?: boolean;
  onAddCustomer?: () => void;
}

const customerTypeLabel: Record<CustomerType, string> = {
  [CustomerType.Individual]: 'Persona Natural',
  [CustomerType.Business]: 'Empresa',
  [CustomerType.Government]: 'Gobierno',
};

const customerTypeBadgeClass: Record<CustomerType, string> = {
  [CustomerType.Individual]: 'bg-blue-100 text-blue-700',
  [CustomerType.Business]: 'bg-purple-100 text-purple-700',
  [CustomerType.Government]: 'bg-amber-100 text-amber-700',
};

function getDisplayName(customer: Customer): string {
  return customer.businessName ?? `${customer.firstName} ${customer.lastName}`.trim();
}

function getDocumentLabel(customer: Customer): string {
  return `${customer.documentType}: ${customer.nationalId}`;
}

export function CustomerPicker({
  value,
  onChange,
  companyId,
  placeholder = 'Buscar cliente...',
  disabled = false,
  onAddCustomer,
}: CustomerPickerProps) {
  const allCustomers = useAppSelector(selectAllCustomers);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const companyCustomers = allCustomers.filter(
    (c) => c.companyId === companyId && c.isActive
  );

  const filtered = search.trim()
    ? companyCustomers.filter((c) => {
        const term = search.toLowerCase();
        const name = getDisplayName(c).toLowerCase();
        return (
          name.includes(term) ||
          c.nationalId.toLowerCase().includes(term) ||
          c.nit?.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term)
        );
      })
    : companyCustomers;

  const selectedCustomer = value
    ? allCustomers.find((c) => c.id === value) ?? null
    : null;

  const open = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch('');
  }, []);

  const handleSelect = useCallback(
    (customer: Customer) => {
      onChange(customer.id, customer);
      close();
    },
    [onChange, close]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('', {} as Customer);
      close();
    },
    [onChange, close]
  );

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen, close]);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    if (isOpen) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, close]);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={open}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={[
          'w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-white transition-colors text-left',
          'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
          disabled
            ? 'opacity-50 cursor-not-allowed border-brand-300 bg-brand-50'
            : 'border-brand-300 hover:border-brand-400 cursor-pointer',
        ].join(' ')}
      >
        <User size={15} className="shrink-0 text-brand-400" />
        <span className={['flex-1 truncate', !selectedCustomer ? 'text-brand-400' : 'text-brand-900'].join(' ')}>
          {selectedCustomer ? getDisplayName(selectedCustomer) : placeholder}
        </span>
        {selectedCustomer && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 text-brand-400 hover:text-brand-600 transition-colors"
            aria-label="Limpiar selección"
          >
            <X size={14} />
          </button>
        )}
        <ChevronDown
          size={15}
          className={['shrink-0 text-brand-400 transition-transform', isOpen ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          role="listbox"
          className={[
            'absolute z-20 top-full left-0 right-0 mt-1',
            'bg-white rounded-lg border border-brand-200 shadow-lg',
            'flex flex-col max-h-64 overflow-hidden',
          ].join(' ')}
        >
          {/* Search input */}
          <div className="px-3 py-2 border-b border-brand-100 flex items-center gap-2">
            <Search size={14} className="shrink-0 text-brand-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, NIT o DUI..."
              className="flex-1 text-sm text-brand-900 placeholder:text-brand-400 focus:outline-none bg-transparent"
            />
          </div>

          {/* Options list */}
          <ul className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-brand-400 text-center">
                No se encontraron clientes
              </li>
            ) : (
              filtered.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={customer.id === value}
                    onClick={() => handleSelect(customer)}
                    className={[
                      'w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-brand-50 transition-colors',
                      customer.id === value ? 'bg-accent-50' : '',
                    ].join(' ')}
                  >
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center shrink-0 mt-0.5">
                      <User size={14} className="text-brand-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-brand-900 truncate">
                        {getDisplayName(customer)}
                      </p>
                      <p className="text-xs text-brand-500 truncate">{getDocumentLabel(customer)}</p>
                    </div>
                    <span
                      className={[
                        'shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium',
                        customerTypeBadgeClass[customer.customerType],
                      ].join(' ')}
                    >
                      {customerTypeLabel[customer.customerType]}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {/* Add customer footer */}
          {onAddCustomer && (
            <div className="border-t border-brand-100 p-1">
              <button
                type="button"
                onClick={() => {
                  close();
                  onAddCustomer();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-600 hover:bg-accent-50 rounded-md transition-colors"
              >
                <UserPlus size={14} />
                Agregar Cliente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CustomerPicker;
