import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Select } from '@/components/common/Select';
import { UserAvatar } from '@/components/localUsers/UserAvatar';
import { useAppSelector } from '@/store';
import { selectAuditEvents, selectLocalUsers } from '@/store/selectors/localUsersSelectors';
import { selectSelectedCompanyId } from '@/store/selectors/companySelectors';
import { AUDIT_EVENT_LIMIT } from '@/store/slices/auditSlice';
import type { AuditEntityType, AuditEvent } from '@/types/localUsers';

export const AUDIT_ENTITY_LABEL: Record<AuditEntityType, string> = {
  invoice: 'Documento',
  customer: 'Cliente',
  product: 'Producto',
  ticket: 'Ticket',
  closing: 'Cierre de caja',
  compra: 'Compra',
  company: 'Empresa',
  user: 'Usuario',
};

const ENTITY_VARIANT: Record<AuditEntityType, 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple'> = {
  invoice: 'info',
  customer: 'success',
  product: 'warning',
  ticket: 'purple',
  closing: 'purple',
  compra: 'neutral',
  company: 'neutral',
  user: 'purple',
};

const dateTime = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Where a log entry's record lives (null = no detail screen / record gone). */
export function auditEntityRoute(event: Pick<AuditEvent, 'entityType' | 'entityId' | 'action'>): string | null {
  if (event.action === 'delete') return null;
  switch (event.entityType) {
    case 'invoice':
      return `/invoices/${event.entityId}`;
    case 'customer':
      return `/customers/${event.entityId}`;
    case 'product':
      return `/products/${event.entityId}`;
    case 'compra':
      return `/compras/${event.entityId}`;
    case 'ticket':
      return '/pos/tickets';
    case 'closing':
      return '/pos/closing';
    case 'company':
      return `/companies/${event.entityId}`;
    default:
      return null;
  }
}

const PAGE_SIZE = 100;

/**
 * Configuración → Usuarios → Historial de actividad (admin only). The local activity log:
 * every create/edit/delete/void and every sign-in, credited to the local user
 * who did it. Kept on this computer only (last AUDIT_EVENT_LIMIT entries).
 */
export default function AuditLogPage() {
  const navigate = useNavigate();
  const events = useAppSelector(selectAuditEvents);
  const users = useAppSelector(selectLocalUsers);
  const selectedCompanyId = useAppSelector(selectSelectedCompanyId);

  const [actorId, setActorId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [scope, setScope] = useState<'company' | 'all'>('company');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Everyone who appears in the log (incl. deleted users and the pre-users owner).
  const actorOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const user of users) byId.set(user.id, user.displayName);
    for (const event of events) if (!byId.has(event.actor.id)) byId.set(event.actor.id, event.actor.name);
    return Array.from(byId, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [users, events]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((event) => {
      if (actorId && event.actor.id !== actorId) return false;
      if (entityType && event.entityType !== entityType) return false;
      // Users/sign-ins aren't company-scoped; company records follow the selected company.
      if (scope === 'company' && event.companyId && event.companyId !== selectedCompanyId) return false;
      if (term) {
        const haystack = `${event.summary} ${event.entityLabel ?? ''} ${event.actor.name}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [events, actorId, entityType, scope, search, selectedCompanyId]);

  const visible = filtered.slice(0, limit);

  return (
    <div data-testid="audit-log-page" className="space-y-4 max-w-6xl">
      <PageHeader
        title="Historial de actividad"
        subtitle={`Quién creó y modificó cada registro en esta computadora (últimos ${AUDIT_EVENT_LIMIT.toLocaleString('es-SV')} eventos)`}
        onBack={() => navigate('/settings/users')}
      />

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1 md:col-span-1">
            <label htmlFor="audit-search" className="text-sm font-medium text-brand-700">Buscar</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400" />
              <input
                id="audit-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(PAGE_SIZE);
                }}
                placeholder="Factura, cliente, acción…"
                data-testid="audit-search"
                className="w-full rounded-lg border border-brand-300 pl-9 pr-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            </div>
          </div>
          <Select
            label="Usuario"
            value={actorId}
            onChange={(e) => {
              setActorId(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            options={[{ label: 'Todos', value: '' }, ...actorOptions]}
            data-testid="audit-filter-user"
          />
          <Select
            label="Tipo de registro"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            options={[
              { label: 'Todos', value: '' },
              ...Object.entries(AUDIT_ENTITY_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            data-testid="audit-filter-type"
          />
          <Select
            label="Empresa"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'company' | 'all')}
            options={[
              { label: 'Empresa actual', value: 'company' },
              { label: 'Todas las empresas', value: 'all' },
            ]}
            data-testid="audit-filter-scope"
          />
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        {visible.length === 0 ? (
          <div className="py-12 text-center" data-testid="audit-empty">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-brand-50 text-brand-400 flex items-center justify-center">
              <History size={22} />
            </div>
            <p className="text-sm font-medium text-brand-700">Sin actividad registrada</p>
            <p className="text-xs text-brand-400 mt-1">Los cambios aparecerán aquí a medida que tu equipo trabaje.</p>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="bg-brand-50 text-left text-xs uppercase tracking-wider text-brand-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Usuario</th>
                <th className="px-4 py-3 font-semibold">Registro</th>
                <th className="px-4 py-3 font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {visible.map((event) => {
                const route = auditEntityRoute(event);
                return (
                  <tr key={event.id} data-testid="audit-row">
                    <td className="px-4 py-2.5 text-brand-500 whitespace-nowrap">{dateTime.format(new Date(event.at))}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar name={event.actor.name} size="sm" admin={event.actor.role === 'admin'} />
                        <span className="text-brand-800 truncate" data-testid="audit-row-actor">{event.actor.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant={ENTITY_VARIANT[event.entityType]} size="sm">{AUDIT_ENTITY_LABEL[event.entityType]}</Badge>
                        {route ? (
                          <button
                            type="button"
                            onClick={() => navigate(route)}
                            className="text-accent-600 hover:underline truncate"
                          >
                            {event.entityLabel ?? event.entityId}
                          </button>
                        ) : (
                          <span className="text-brand-700 truncate">{event.entityLabel ?? event.entityId}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-brand-700" data-testid="audit-row-summary">{event.summary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {filtered.length > visible.length && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setLimit((value) => value + PAGE_SIZE)} data-testid="audit-load-more">
            Ver más ({filtered.length - visible.length} restantes)
          </Button>
        </div>
      )}
    </div>
  );
}
