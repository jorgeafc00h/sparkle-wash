import React from 'react';
import {
  Controller,
  Control,
  FieldPath,
  FieldValues,
  RegisterOptions,
} from 'react-hook-form';
import { Input } from '../common/Input';
import { Select, SelectOption } from '../common/Select';

export interface FormFieldProps<T extends FieldValues> {
  name: FieldPath<T>;
  control: Control<T>;
  label?: string;
  rules?: RegisterOptions<T, FieldPath<T>>;
  type?: 'text' | 'email' | 'number' | 'select';
  options?: SelectOption[];
  placeholder?: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
}

export function FormField<T extends FieldValues>({
  name,
  control,
  label,
  rules,
  type = 'text',
  options = [],
  placeholder,
  helperText,
  disabled,
  required,
}: FormFieldProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;

        if (type === 'select') {
          return (
            <Select
              label={label}
              error={error}
              options={options}
              placeholder={placeholder}
              disabled={disabled}
              required={required}
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
            />
          );
        }

        return (
          <Input
            label={label}
            error={error}
            helperText={helperText}
            type={type}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            value={field.value ?? ''}
            onChange={field.onChange}
            onBlur={field.onBlur}
            name={field.name}
          />
        );
      }}
    />
  );
}

export default FormField;
