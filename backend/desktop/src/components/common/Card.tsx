import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  id?: string;
}

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
};

export function Card({ children, className = '', padding = 'md', id, ...rest }: CardProps) {
  return (
    <div
      id={id}
      className={[
        'bg-white rounded-lg shadow-sm border border-brand-100',
        paddingClasses[padding],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
