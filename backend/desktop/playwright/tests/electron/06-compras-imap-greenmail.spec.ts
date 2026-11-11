import { expect, test } from '@playwright/test';
import { closeElectron, launchElectron, type ElectronAppHandle } from '../../fixtures/electron-launch';
import { GREENMAIL, getInboxCounts, prepareGreenMailInbox } from '../../fixtures/greenmail';

test.describe('Electron Compras IMAP — GreenMail', () => {
  test.skip(
    process.env.RUN_IMAP_GREENMAIL_E2E !== '1',
    'Set RUN_IMAP_GREENMAIL_E2E=1 to run the Docker/GreenMail round-trip test.',
  );

  let handle: ElectronAppHandle | undefined;
  /** Inbox as seeded — GreenMail in this setup stores every seeded email twice (3 sent → 6 in INBOX). */
  let seeded = { messages: 0, unseen: 0 };

  test.beforeEach(async () => {
    // 3 messages (not 1) — gives the compras.syncProgressBar determinate
    // phase (below) enough real per-message IPC round-trips (dedup checks,
    // DB inserts) to be reliably observable by Playwright, instead of a
    // single-message pass that could resolve inside one render tick.
    await prepareGreenMailInbox({ limit: 3 });
    seeded = await getInboxCounts();
    expect(seeded.messages).toBeGreaterThanOrEqual(3);
    expect(seeded.unseen).toBe(seeded.messages);
    handle = await launchElectron({ mock: true });
    await handle.window.addInitScript(() => {
      localStorage.setItem('__skip_compra_auto_verify', 'true');
    });
    await handle.window.reload();
    await handle.window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (handle) await closeElectron(handle);
    handle = undefined;
  });

  test('connects to GreenMail IMAP, saves credentials, and imports DTE attachments', async () => {
    const page = handle!.window;

    await page.getByTestId('sidebar-compras').click();
    await expect(page.getByTestId('compras-list')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Configuración de compras').click();

    await expect(page.getByTestId('compras-settings-imap-card')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('compras-settings-imap-start').click();
    await page.getByTestId('compras-settings-imap-email-input').fill(GREENMAIL.to);
    await page.getByTestId('compras-settings-imap-password-input').fill(GREENMAIL.pass);
    await expect(page.getByTestId('compras-settings-imap-save')).toBeDisabled();

    await page.getByTestId('compras-settings-imap-toggle-advanced').click();
    await page.getByTestId('compras-settings-imap-host-input').fill(GREENMAIL.imapHost);
    await page.getByTestId('compras-settings-imap-port-input').fill(String(GREENMAIL.imapPort));
    await expect(page.getByTestId('compras-settings-imap-save')).toBeDisabled();

    await page.getByTestId('compras-settings-imap-test').click();
    await expect(page.getByTestId('compras-settings-imap-result-success')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('compras-settings-imap-save')).toBeEnabled();

    await page.getByTestId('compras-settings-imap-save').click();
    await expect(page.getByTestId('compras-settings-imap-email')).toContainText(GREENMAIL.to);

    await page.getByTestId('compras-settings-imap-sync').click();
    await expect(page.getByRole('status').filter({ hasText: /IMAP .*3 importadas/i })).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('sidebar-compras').click();
    await page.getByTestId('compras-sync-range').selectOption('all');
    await expect(page.getByText(/SUPER REPUESTOS EL SALVADOR/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Email').first()).toBeVisible();

    // Extended coverage (progress UX): the List page's unified "Sincronizar"
    // button (IMAP-preferred, Gmail-fallback resolution — see
    // ComprasSyncManager.syncPreferred) drives the shared compras.* progress
    // banners. This re-sync re-fetches the same 3 GreenMail messages (now
    // deduped/skipped), which still exercises the full fetch + per-message
    // loop and gives the determinate bar (total=3) a real, observable window.
    await page.getByTestId('compras-sync-button').click();
    await expect(page.getByTestId('compras.syncingBanner')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('compras.syncProgressBar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('compras.syncingBanner')).toBeHidden({ timeout: 30_000 });

    // The previously-imported row is still there after the re-sync.
    await expect(page.getByText(/SUPER REPUESTOS EL SALVADOR/i)).toBeVisible();

    // Read-only guarantee: after TWO full syncs that downloaded and parsed every
    // message, all 3 must still be UNREAD in the real mailbox. Compras opens the
    // box with EXAMINE and fetches with BODY.PEEK[]; a regression to SELECT /
    // BODY[] would mark the user's actual mail as read — invisible to every
    // UI-level assertion, and a direct breach of the "solo lectura" promise the
    // settings screen makes.
    // Compared with the inbox as seeded (not a hard-coded 3): the fixture's
    // double delivery made this fail on every run although nothing was
    // deleted or marked read.
    const counts = await getInboxCounts();
    expect(counts.messages).toBe(seeded.messages);
    expect(counts.unseen).toBe(seeded.messages);
  });
});
