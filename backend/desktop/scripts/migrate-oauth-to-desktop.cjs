#!/usr/bin/env node
/**
 * Guided Playwright helper to create a Desktop OAuth client in Google Cloud
 * Console for the Facturas Simples project (facturas-simples-f6848).
 *
 * Run:    node scripts/migrate-oauth-to-desktop.cjs
 *
 * What it does:
 *   1. Launches a Chromium window pre-pointed at the Credentials page.
 *   2. Pauses while you log in to Google (incl. 2FA) — first time only;
 *      session is persisted at scripts/.oauth-helper-profile.
 *   3. Walks you through creating a new "Desktop app" OAuth client.
 *   4. Reads the new client_id back out of the resulting dialog.
 *   5. Prints the .env line you need to swap in.
 *
 * It does NOT click "Create" for you — you stay in control of the destructive
 * action. The script only navigates, pauses, and reads.
 */

const path = require('path');
const readline = require('readline');
const { chromium } = require('@playwright/test');

const PROJECT_ID = 'facturas-simples-f6848';
const CREDENTIALS_URL = `https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}`;
const PROFILE_DIR = path.join(__dirname, '.oauth-helper-profile');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function banner(msg) {
  const bar = '─'.repeat(Math.min(72, msg.length + 4));
  console.log(`\n${bar}\n  ${msg}\n${bar}`);
}

async function main() {
  banner('Google Cloud Console OAuth migration helper');
  console.log(`Project:     ${PROJECT_ID}`);
  console.log(`Target page: ${CREDENTIALS_URL}`);
  console.log(`Profile dir: ${PROFILE_DIR}  (session persisted here)\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(CREDENTIALS_URL, { waitUntil: 'domcontentloaded' });

  banner('STEP 1 — Sign in');
  console.log('In the Chromium window:');
  console.log('  1. Sign in with the Google account that owns the project.');
  console.log('  2. Complete 2FA if prompted.');
  console.log('  3. Wait until the "Credentials" page is fully loaded.');
  await prompt('\nPress ENTER once the Credentials page is visible… ');

  banner('STEP 2 — Create a Desktop OAuth client');
  console.log('In the Chromium window:');
  console.log('  1. Click  + CREATE CREDENTIALS  (top toolbar).');
  console.log('  2. Pick   OAuth client ID.');
  console.log('  3. Application type:  Desktop app');
  console.log('  4. Name:              facturas-simples-desktop');
  console.log('  5. Click  CREATE.');
  console.log('');
  console.log('A modal will appear with "OAuth client created".');
  console.log('Leave that modal open.');
  await prompt('\nPress ENTER once the "OAuth client created" modal is showing… ');

  banner('STEP 3 — Capture the new client_id');
  console.log('Trying to read the client_id from the modal automatically…');

  // The Cloud Console modal renders the client_id inside a copy field. Try a
  // few selectors — the markup changes occasionally.
  let newClientId = '';
  try {
    const candidates = [
      'input[aria-label*="Client ID" i]',
      'input[value$=".apps.googleusercontent.com"]',
      'text=/[0-9]{6,}-[a-z0-9]+\\.apps\\.googleusercontent\\.com/',
    ];
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        const val = (await loc.inputValue().catch(() => '')) || (await loc.textContent().catch(() => '')) || '';
        const match = val.match(/[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/i);
        if (match) { newClientId = match[0]; break; }
      }
    }
  } catch { /* fall through to manual */ }

  if (!newClientId) {
    console.log('Could not auto-read it. Copy the "Client ID" from the modal manually.');
    newClientId = await prompt('Paste the new Client ID here: ');
  } else {
    console.log(`Auto-detected: ${newClientId}`);
    const confirm = await prompt('Use this value? [Y/n] ');
    if (confirm.toLowerCase() === 'n') {
      newClientId = await prompt('Paste the correct Client ID: ');
    }
  }

  if (!newClientId.endsWith('.apps.googleusercontent.com')) {
    console.error(`\nThat doesn't look like a Google client_id. Aborting without writing anything.`);
    await context.close();
    process.exit(1);
  }

  banner('STEP 4 — Update your .env');
  console.log('Replace the VITE_GOOGLE_CLIENT_ID line in .env with:\n');
  console.log(`  VITE_GOOGLE_CLIENT_ID=${newClientId}`);
  console.log(`\nAlso DELETE the VITE_GOOGLE_CLIENT_SECRET line — Desktop OAuth clients`);
  console.log(`don't use a client secret. The PKCE migration handles that.`);

  banner('STEP 5 — (Optional) Delete the old Web OAuth client');
  console.log('Once the new Desktop client works end-to-end, come back to the');
  console.log('Credentials page and delete the old "facturas-simples-react-native"');
  console.log('Web OAuth client to fully retire the leaked secret.');

  await prompt('\nPress ENTER to close the browser… ');
  await context.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
