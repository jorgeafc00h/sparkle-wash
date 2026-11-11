// useInvoiceStatusTracking — React hook for DTE submission status tracking.
// Subscribes to InvoiceStatusTracker and re-renders when status changes.

import { useState, useEffect, useCallback } from 'react';
import {
  InvoiceStatusTracker,
  TrackingEntry,
  TrackingStatus,
} from '@/services/tracking/InvoiceStatusTracker';

export interface InvoiceStatusTrackingResult {
  /** Current tracking entry, or undefined if not yet tracked */
  entry: TrackingEntry | undefined;
  /** Shorthand for entry?.status */
  status: TrackingStatus | undefined;
  /** True while the invoice is in a non-terminal in-progress state */
  isTracking: boolean;
  /** Error message if status is Failed */
  error: string | undefined;
  /** True when status is Completed */
  isCompleted: boolean;
  /** True when status is Failed */
  isFailed: boolean;
}

const ACTIVE_STATUSES = new Set<TrackingStatus>([
  TrackingStatus.Pending,
  TrackingStatus.Signing,
  TrackingStatus.Submitting,
  TrackingStatus.Processing,
  TrackingStatus.Retrying,
]);

/**
 * Subscribe to real-time DTE submission status for a single invoice.
 *
 * @param invoiceId - The invoice ID to track. Pass undefined/null to opt out.
 *
 * @example
 * const { status, isTracking, error } = useInvoiceStatusTracking(invoice.id);
 */
export function useInvoiceStatusTracking(
  invoiceId: string | undefined | null
): InvoiceStatusTrackingResult {
  const [entry, setEntry] = useState<TrackingEntry | undefined>(() =>
    invoiceId ? InvoiceStatusTracker.getStatus(invoiceId) : undefined
  );

  const handleUpdate = useCallback((updated: TrackingEntry) => {
    setEntry(updated);
  }, []);

  useEffect(() => {
    if (!invoiceId) {
      setEntry(undefined);
      return;
    }

    // Sync with latest state in case it changed between render and effect
    const current = InvoiceStatusTracker.getStatus(invoiceId);
    setEntry(current);

    const unsubscribe = InvoiceStatusTracker.subscribe(invoiceId, handleUpdate);
    return unsubscribe;
  }, [invoiceId, handleUpdate]);

  const status = entry?.status;
  const isTracking = status !== undefined && ACTIVE_STATUSES.has(status);
  const isCompleted = status === TrackingStatus.Completed;
  const isFailed = status === TrackingStatus.Failed;
  const error = isFailed ? entry?.error : undefined;

  return {
    entry,
    status,
    isTracking,
    error,
    isCompleted,
    isFailed,
  };
}

export default useInvoiceStatusTracking;
