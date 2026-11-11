import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';

interface SyncLogEntry {
  id: string;
  timestamp: string;
  tipo: string;
  direccion: string;
  statusCode: number | null;
  error: string | null;
}

const STORAGE_KEY = 'facturas_simples_sync_logs';

function loadLogsFromStorage(): SyncLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as SyncLogEntry[];
    return [];
  } catch {
    return [];
  }
}

type LogRow = Record<string, unknown> & SyncLogEntry;

export default function SyncLogsPage() {
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [dateFilter, setDateFilter] = useState('');

  useEffect(() => {
    setLogs(loadLogsFromStorage());
  }, []);

  const filtered = logs.filter((log) => {
    if (!dateFilter) return true;
    return log.timestamp.startsWith(dateFilter);
  });

  const columns: ColumnDef<LogRow>[] = [
    {
      key: 'timestamp',
      label: 'Fecha / Hora',
      sortable: true,
      render: (val) => (
        <span className="font-mono text-xs">
          {new Date(String(val)).toLocaleString('es-SV')}
        </span>
      ),
    },
    {
      key: 'tipo',
      label: 'Tipo',
      render: (val) => <Badge variant="neutral">{String(val)}</Badge>,
    },
    {
      key: 'direccion',
      label: 'Dirección',
      render: (val) => <span className="text-xs font-mono break-all">{String(val)}</span>,
    },
    {
      key: 'statusCode',
      label: 'Código',
      render: (val) => {
        if (val == null) return <span className="text-brand-300">—</span>;
        const code = Number(val);
        return (
          <Badge variant={code >= 200 && code < 300 ? 'success' : code >= 400 ? 'error' : 'warning'}>
            {code}
          </Badge>
        );
      },
    },
    {
      key: 'error',
      label: 'Error',
      render: (val) =>
        val ? (
          <span className="text-xs text-red-600 line-clamp-2">{String(val)}</span>
        ) : (
          <span className="text-brand-300">—</span>
        ),
    },
  ];

  return (
    <div data-testid="sync-logs" className="space-y-4">
      <PageHeader
        title="Registros de Sincronización"
        subtitle="Historial de envíos al Ministerio de Hacienda"
      />

      <div className="flex items-end gap-4">
        <Input
          label="Filtrar por fecha"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="w-48"
        />
        {dateFilter && (
          <button
            onClick={() => setDateFilter('')}
            className="text-xs text-brand-400 hover:text-brand-600 mb-1"
          >
            Limpiar filtro
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={<RefreshCw size={28} />}
          title="Sin registros de sincronización"
          message="Los registros aparecerán aquí cuando envíes documentos al Ministerio de Hacienda."
        />
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-center text-brand-400 py-6">
            No hay registros para la fecha seleccionada.
          </p>
        </Card>
      ) : (
        <DataTable<LogRow>
          columns={columns}
          data={filtered as LogRow[]}
          emptyMessage="Sin registros."
        />
      )}
    </div>
  );
}
