/**
 * useDesktopAdWait — shared rewarded-ad-gate countdown state machine.
 *
 * Extracted from InvalidationPage.tsx / InvoicePDFPreview.tsx, which had
 * byte-for-byte identical `adWaiting` / `adSecondsRemaining` state plus the
 * same countdown-then-resolve promise, differing only in which flag gated it
 * (invalidation submit vs. quote email send). One shared hook keeps both
 * flows' ad-gate timing in sync going forward instead of two copies that can
 * silently drift.
 */

import { useState } from 'react';
import { AD_CONFIG } from '@/config/subscriptionConfig';

export interface UseDesktopAdWaitReturn {
  /** true while the rewarded-ad overlay should be shown. */
  adWaiting: boolean;
  /** Seconds left in the countdown, for the "will continue automatically in Ns" label. */
  adSecondsRemaining: number;
  /** Runs the countdown when `needsAdWait` is true; resolves immediately otherwise. */
  waitForDesktopAdIfNeeded: () => Promise<void>;
  /**
   * Force the overlay closed outside the normal countdown — e.g. in a
   * submit handler's `finally` after an error, or when the host modal closes
   * mid-countdown. Does not cancel the underlying interval/timeout (they're
   * cheap no-ops against unmounted state), only hides the overlay.
   */
  resetAdWait: () => void;
}

export function useDesktopAdWait(needsAdWait: boolean): UseDesktopAdWaitReturn {
  const [adWaiting, setAdWaiting] = useState(false);
  const [adSecondsRemaining, setAdSecondsRemaining] = useState(0);

  async function waitForDesktopAdIfNeeded() {
    if (!needsAdWait) return;

    const durationMs = AD_CONFIG.desktop.DESKTOP_REWARDED_DURATION_MS;
    setAdWaiting(true);
    setAdSecondsRemaining(Math.ceil(durationMs / 1000));

    await new Promise<void>((resolve) => {
      const interval = window.setInterval(() => {
        setAdSecondsRemaining((current) => Math.max(0, current - 1));
      }, 1000);

      window.setTimeout(() => {
        window.clearInterval(interval);
        setAdWaiting(false);
        setAdSecondsRemaining(0);
        resolve();
      }, durationMs);
    });
  }

  function resetAdWait() {
    setAdWaiting(false);
    setAdSecondsRemaining(0);
  }

  return { adWaiting, adSecondsRemaining, waitForDesktopAdIfNeeded, resetAdWait };
}
