import React from 'react';
import { Input } from '../common/Input';

export interface DatePickerProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  error,
  required,
  disabled,
}: DatePickerProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  return (
    <Input
      type="date"
      label={label}
      value={value}
      onChange={handleChange}
      min={min}
      max={max}
      error={error}
      required={required}
      disabled={disabled}
    />
  );
}

export default DatePicker;
