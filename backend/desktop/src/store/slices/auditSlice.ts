// Local audit trail — who created and who last modified each record, plus a
// capped activity log. Lives in its own persisted slice (never inside the
// entities), so it stays on this device: Device Sync payloads, the API and the
// DTE JSON never see it, and a relay write replacing an entity can't erase it.
// Written only by services/localUsers/auditCapture.ts.

import { createSlice, nanoid, PayloadAction } from '@reduxjs/toolkit';
import type { AuditEntityType, AuditEvent, AuditState } from '@/types/localUsers';

/** Keeps the persisted log bounded (newest first). */
export const AUDIT_EVENT_LIMIT = 3000;

const initialState: AuditState = {
  stamps: {},
  events: [],
};

export const auditKey = (entityType: AuditEntityType, entityId: string) => `${entityType}:${entityId}`;

export type AuditEventInput = Omit<AuditEvent, 'id' | 'at'> & { at?: string };

// Session events describe the user, not a change to a record.
const NON_STAMPING_ACTIONS = new Set<AuditEvent['action']>(['login', 'logout', 'login_failed']);

// POS tickets are high-volume (one per sale) and already carry their cashier
// (`cashierName`), so they appear in the log only — per-ticket stamps would grow
// the persisted slice without bound and nothing displays them. Cash closings are
// one-off events with no detail screen.
const LOG_ONLY_ENTITIES = new Set<AuditEntityType>(['ticket', 'closing']);

const auditSlice = createSlice({
  name: 'audit',
  initialState,
  reducers: {
    recordAuditEvents: {
      reducer(state, action: PayloadAction<AuditEvent[]>) {
        if (action.payload.length === 0) return;
        // Payload is oldest → newest; the log is newest first.
        for (const event of action.payload) {
          if (NON_STAMPING_ACTIONS.has(event.action) || LOG_ONLY_ENTITIES.has(event.entityType)) continue;
          const key = auditKey(event.entityType, event.entityId);
          if (event.action === 'delete') {
            delete state.stamps[key];
            continue;
          }
          const stamp = state.stamps[key] ?? {};
          if (event.action === 'create' && !stamp.createdBy) {
            stamp.createdBy = event.actor;
            stamp.createdAt = event.at;
          }
          stamp.updatedBy = event.actor;
          stamp.updatedAt = event.at;
          state.stamps[key] = stamp;
        }
        state.events = [...action.payload].reverse().concat(state.events).slice(0, AUDIT_EVENT_LIMIT);
      },
      prepare(events: AuditEventInput[]) {
        const now = new Date().toISOString();
        return {
          payload: events.map((event) => ({ ...event, id: `aud_${nanoid(10)}`, at: event.at ?? now })),
        };
      },
    },
  },
});

export const { recordAuditEvents } = auditSlice.actions;

export default auditSlice.reducer;
