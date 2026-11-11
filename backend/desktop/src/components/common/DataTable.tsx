import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Loader2 } from 'lucide-react';

export interface ColumnDef<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
}

type SortDir = 'asc' | 'desc';

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No hay datos disponibles.',
  loading = false,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = React.useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function SortIcon({ colKey }: { colKey: string }) {
    if (sortKey !== colKey) return <ChevronsUpDown size={14} className="text-brand-400" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={14} className="text-accent-600" />
    ) : (
      <ChevronDown size={14} className="text-accent-600" />
    );
  }

  // Skeleton-only render when we're loading AND there's no data yet (initial load).
  // Once we have rows, show them underneath an overlay so the user can see
  // the existing table while a sync/verify runs on top.
  const showSkeleton = loading && sorted.length === 0;

  return (
    <div
      data-testid="data-table"
      className="relative w-full overflow-auto rounded-lg border border-brand-100"
    >
      <table className="w-full text-sm">
        <thead className="bg-brand-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  'px-4 py-3 text-left font-semibold text-brand-600',
                  col.sortable && !loading ? 'cursor-pointer select-none hover:text-brand-800' : '',
                ].join(' ')}
                onClick={col.sortable && !loading ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && <SortIcon colKey={col.key} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showSkeleton ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-t border-brand-100">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <div className="h-4 rounded bg-brand-100 animate-pulse" />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-brand-400"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row, rowIdx) => {
              const isInteractive = !!onRowClick && !loading;
              return (
              <tr
                key={rowIdx}
                className={[
                  'border-t border-brand-100 transition-colors',
                  isInteractive
                    ? 'cursor-pointer hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-500'
                    : 'hover:bg-brand-50/50',
                ].join(' ')}
                onClick={isInteractive ? () => onRowClick(row) : undefined}
                role={isInteractive ? 'button' : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                onKeyDown={isInteractive ? (e) => {
                  if (e.key === 'Enter') {
                    onRowClick(row);
                  } else if (e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row);
                  }
                } : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-brand-800">
                    {col.render
                      ? col.render(row[col.key], row)
                      : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Overlay: shown only when loading AND rows exist. The rows stay visible
          underneath but mouse events are blocked and colors dimmed slightly. */}
      {loading && sorted.length > 0 && (
        <div
          className="pointer-events-auto absolute inset-0 flex items-start justify-center bg-white/60 backdrop-blur-[1px]"
          data-testid="data-table-loading-overlay"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="mt-8 flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-md border border-brand-100">
            <Loader2 size={18} className="animate-spin text-accent-600" />
            <span className="text-sm font-medium text-brand-700">Actualizando…</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
