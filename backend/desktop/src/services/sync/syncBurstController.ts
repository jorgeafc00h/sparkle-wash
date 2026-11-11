// Burst session policy (Device Sync v2, Phase 2 — Azure cost optimization).
//
// The relay replica scales to zero; the old always-on autoSync kept a SignalR
// WebSocket open for as long as the app ran, which kept it warm 24/7. Sessions are
// now BURSTS that wake the relay only while there is work:
//   (a) an outbox change — one session debounced 3–5 s after the LAST change
//       (background: only while "Automático" is armed),
//   (b) the manual "Sincronizar ahora" button (always available),
//   (c) one pull shortly after start while signed in with a claimed company
//       (background: only while "Automático" is armed).
// When a burst settles (engine.startSession resolved: register + flush + pull done),
// a ~90 s linger counts outbox silence; when it expires the controller closes the
// session with stopSession({ flushViaRest: true }) so anything still queued goes out
// over REST before the WebSocket drops. Outbox activity while live resets the linger,
// so the session stays open while the user keeps working.
//
// Eligibility ("signed in with a claimed company") and the "Automático" arming are
// injected as callbacks — they read the Redux store at event time, never at
// construction time. Timers are injected the same way for the Jest fake-clock suite.

export interface SyncBurstEngineLike {
  startSession(): Promise<{ ok: boolean }>;
  stopSession(options?: { flushViaRest?: boolean }): Promise<void>;
  isLive(): boolean;
  activeCompanyKey(): string | null;
}

export interface SyncBurstControllerDeps {
  engine: SyncBurstEngineLike;
  /** Background triggers may run: signed in, company claimed, tier/entitlement OK. */
  isBackgroundEligible: () => boolean;
  /** The user enabled "Automático" AND more than one device is registered. */
  isAutoArmed: () => boolean;
  /** Capture seam notification: a local write entered the outbox. */
  onOutboxChanged: (listener: () => void) => () => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Debounce for opening a session after the LAST outbox change (spec: 3–5 s). */
export const BURST_OPEN_DEBOUNCE_MS = 4_000;
/** Outbox silence that closes a settled session (spec: ~90 s). */
export const BURST_LINGER_MS = 90_000;
/** Delay of the one startup pull (the relay may be cold; stay out of boot's way). */
export const STARTUP_PULL_DELAY_MS = 10_000;

export class SyncBurstController {
  private openTimer: unknown = null;
  private lingerTimer: unknown = null;
  private unsubscribeOutbox: (() => void) | null = null;
  private startupPullScheduled = false;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimerImpl: (handle: unknown) => void;

  constructor(private readonly deps: SyncBurstControllerDeps) {
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimerImpl = deps.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Wires the outbox listener (call once from the App shell). Idempotent. */
  start(): void {
    if (this.unsubscribeOutbox) return;
    this.unsubscribeOutbox = this.deps.onOutboxChanged(() => this.handleOutboxChanged());
  }

  /** Teardown: stops listening and clears every pending timer (the engine's own
   * lifecycle — sign-out, window close — still owns stopping a live session). */
  stop(): void {
    this.unsubscribeOutbox?.();
    this.unsubscribeOutbox = null;
    this.clearOpenTimer();
    this.clearLingerTimer();
  }

  /** (b) Manual "Sincronizar ahora" / company switch — immediate, always allowed. */
  syncNow(): Promise<{ ok: boolean }> {
    this.clearOpenTimer();
    return this.openSession();
  }

  /**
   * (c) One background pull per app run, `delayMs` after it is first requested. The
   * fire-time checks decide again: a user who signed out (or never armed "Automático")
   * gets no session, and the once-per-run chance is only spent on the schedule.
   */
  scheduleStartupPull(delayMs: number = STARTUP_PULL_DELAY_MS): void {
    if (this.startupPullScheduled || this.openTimer) return;
    this.startupPullScheduled = true;
    this.openTimer = this.setTimer(() => {
      this.openTimer = null;
      if (this.deps.engine.isLive()) return;
      if (!this.deps.isAutoArmed() || !this.deps.isBackgroundEligible()) return;
      void this.openSession();
    }, delayMs);
  }

  /** True while a linger is counting down towards closing the live session. */
  isLingering(): boolean {
    return this.lingerTimer !== null;
  }

  private handleOutboxChanged(): void {
    if (this.deps.engine.isLive()) {
      // The live session's own flush listener pushes the change; our job is only to
      // extend the session — the user is still working.
      this.armLinger();
      return;
    }
    if (!this.deps.isAutoArmed() || !this.deps.isBackgroundEligible()) return;
    this.clearOpenTimer();
    this.openTimer = this.setTimer(() => {
      this.openTimer = null;
      if (this.deps.engine.isLive()) return; // a manual sync raced the debounce
      if (!this.deps.isAutoArmed() || !this.deps.isBackgroundEligible()) return;
      void this.openSession();
    }, BURST_OPEN_DEBOUNCE_MS);
  }

  private async openSession(): Promise<{ ok: boolean }> {
    this.clearLingerTimer();
    const outcome = await this.deps.engine.startSession();
    // A settled burst (flush + pull complete) starts the linger; a failed open leaves
    // the engine idle — nothing to close.
    if (outcome.ok) this.armLinger();
    return outcome;
  }

  private armLinger(): void {
    this.clearLingerTimer();
    this.lingerTimer = this.setTimer(() => {
      this.lingerTimer = null;
      if (!this.deps.engine.isLive()) return; // already gone (relay restart, error, …)
      void this.deps.engine.stopSession({ flushViaRest: true });
    }, BURST_LINGER_MS);
  }

  private clearOpenTimer(): void {
    if (this.openTimer !== null) this.clearTimerImpl(this.openTimer);
    this.openTimer = null;
  }

  private clearLingerTimer(): void {
    if (this.lingerTimer !== null) this.clearTimerImpl(this.lingerTimer);
    this.lingerTimer = null;
  }
}
