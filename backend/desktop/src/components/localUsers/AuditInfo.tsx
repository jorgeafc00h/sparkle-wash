import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, History, UserPen, UserPlus } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { useAppSelector } from '@/store';
import { selectAuditStamp, selectEntityAuditEvents } from '@/store/selectors/localUsersSelectors';
import type { AuditEntityType } from '@/types/localUsers';

const dateTime = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const format = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '');

/**
 * "Creado por / Modificado por" + the record's own history, on detail screens.
 * Records created before user tracking existed simply show no author.
 */
export function AuditInfo({
  entityType,
  entityId,
  className = '',
}: {
  entityType: AuditEntityType;
  entityId: string | undefined;
  className?: string;
}) {
  const stamp = useAppSelector(useMemo(() => selectAuditStamp(entityType, entityId), [entityType, entityId]));
  const events = useAppSelector(useMemo(() => selectEntityAuditEvents(entityType, entityId), [entityType, entityId]));
  const [open, setOpen] = useState(false);

  return (
    <Card className={`space-y-3 ${className}`} data-testid="audit-info">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2 text-brand-600" data-testid="audit-created-by">
            <UserPlus size={15} className="text-brand-400" />
            {stamp?.createdBy ? (
              <span>
                Creado por <strong className="text-brand-900">{stamp.createdBy.name}</strong>
                <span className="text-brand-400"> · {format(stamp.createdAt)}</span>
              </span>
            ) : (
              <span className="text-brand-400">Autor no registrado (anterior al control de usuarios)</span>
            )}
          </p>
          {stamp?.updatedBy && (stamp.updatedAt !== stamp.createdAt || !stamp.createdBy) && (
            <p className="flex items-center gap-2 text-brand-600" data-testid="audit-updated-by">
              <UserPen size={15} className="text-brand-400" />
              <span>
                Última modificación por <strong className="text-brand-900">{stamp.updatedBy.name}</strong>
                <span className="text-brand-400"> · {format(stamp.updatedAt)}</span>
              </span>
            </p>
          )}
        </div>
        {events.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            data-testid="audit-history-toggle"
            className="inline-flex items-center gap-1.5 text-sm text-accent-600 hover:text-accent-700"
          >
            <History size={15} />
            Historial ({events.length})
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {open && (
        <ol className="border-l-2 border-brand-100 pl-4 space-y-2" data-testid="audit-history">
          {events.map((event) => (
            <li key={event.id} className="text-sm">
              <span className="text-brand-800">{event.summary}</span>
              <span className="text-brand-400"> — {event.actor.name}, {format(event.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default AuditInfo;
