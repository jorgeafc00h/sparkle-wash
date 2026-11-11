// InvoiceStatusTracker — Real-time tracking of DTE submission lifecycle.
// Uses in-memory Map for fast reads + a simple pub/sub pattern for React integration.

export enum TrackingStatus {
  Pending = 'pending',
  Signing = 'signing',
  Submitting = 'submitting',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Retrying = 'retrying',
}

export interface TrackingEntry {
  invoiceId: string;
  status: TrackingStatus;
  startedAt: string;
  updatedAt: string;
  attempt: number;
  maxAttempts: number;
  error?: string;
  mhResponse?: unknown;
}

type StatusListener = (entry: TrackingEntry) => void;

const DEFAULT_MAX_ATTEMPTS = 3;

export class InvoiceStatusTracker {
  private static entries = new Map<string, TrackingEntry>();
  private static listeners = new Map<string, Set<StatusListener>>();

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a new invoice for tracking. Returns the initial entry.
   */
  static startTracking(invoiceId: string): TrackingEntry {
    const now = new Date().toISOString();
    const entry: TrackingEntry = {
      invoiceId,
      status: TrackingStatus.Pending,
      startedAt: now,
      updatedAt: now,
      attempt: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    };
    InvoiceStatusTracker.entries.set(invoiceId, entry);
    InvoiceStatusTracker._notify(invoiceId, entry);
    return entry;
  }

  /**
   * Update the status (and optional extra fields) of an invoice being tracked.
   * Safe to call even if the invoice was not previously registered — will create
   * a minimal entry on the fly.
   */
  static updateStatus(
    invoiceId: string,
    status: TrackingStatus,
    details?: Partial<TrackingEntry>
  ): void {
    const existing = InvoiceStatusTracker.entries.get(invoiceId);
    const now = new Date().toISOString();

    const updated: TrackingEntry = {
      ...(existing ?? {
        invoiceId,
        startedAt: now,
        attempt: 1,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
      }),
      ...details,
      invoiceId,
      status,
      updatedAt: now,
    };

    InvoiceStatusTracker.entries.set(invoiceId, updated);
    InvoiceStatusTracker._notify(invoiceId, updated);
  }

  /**
   * Get the current tracking entry for an invoice, or undefined if not tracked.
   */
  static getStatus(invoiceId: string): TrackingEntry | undefined {
    return InvoiceStatusTracker.entries.get(invoiceId);
  }

  /**
   * Returns all entries that are NOT in a terminal state (Completed or Failed).
   */
  static getActiveEntries(): TrackingEntry[] {
    const terminal = new Set<TrackingStatus>([
      TrackingStatus.Completed,
      TrackingStatus.Failed,
    ]);
    return Array.from(InvoiceStatusTracker.entries.values()).filter(
      e => !terminal.has(e.status)
    );
  }

  /**
   * Subscribe to status changes for a specific invoice.
   * Returns an unsubscribe function — call it in component cleanup.
   *
   * @example
   * const unsub = InvoiceStatusTracker.subscribe(id, entry => setStatus(entry.status));
   * // later:
   * unsub();
   */
  static subscribe(invoiceId: string, callback: StatusListener): () => void {
    let set = InvoiceStatusTracker.listeners.get(invoiceId);
    if (!set) {
      set = new Set();
      InvoiceStatusTracker.listeners.set(invoiceId, set);
    }
    set.add(callback);

    // Immediately call with current value if already tracking
    const current = InvoiceStatusTracker.entries.get(invoiceId);
    if (current) {
      callback(current);
    }

    return () => {
      const s = InvoiceStatusTracker.listeners.get(invoiceId);
      if (s) {
        s.delete(callback);
        if (s.size === 0) {
          InvoiceStatusTracker.listeners.delete(invoiceId);
        }
      }
    };
  }

  /**
   * Remove all entries in terminal states (Completed / Failed).
   * Call periodically to keep memory usage in check.
   */
  static clearCompleted(): void {
    const terminal = new Set<TrackingStatus>([
      TrackingStatus.Completed,
      TrackingStatus.Failed,
    ]);
    for (const [id, entry] of InvoiceStatusTracker.entries) {
      if (terminal.has(entry.status)) {
        InvoiceStatusTracker.entries.delete(id);
        InvoiceStatusTracker.listeners.delete(id);
      }
    }
  }

  /**
   * Reset all state — primarily useful in tests.
   */
  static reset(): void {
    InvoiceStatusTracker.entries.clear();
    InvoiceStatusTracker.listeners.clear();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private static _notify(invoiceId: string, entry: TrackingEntry): void {
    const set = InvoiceStatusTracker.listeners.get(invoiceId);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(entry);
      } catch (e) {
        console.error('[InvoiceStatusTracker] Error en listener:', e);
      }
    }
  }
}

export default InvoiceStatusTracker;
