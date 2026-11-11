/**
 * N1CO sandbox test cards.
 * Source: https://n1-docs.pages.dev/en/docs/developer-tool/sandbox/test-cards
 *
 * All cards accept any future expiration date and any 3-digit CVV.
 * These numbers are inert outside the sandbox — they will be rejected by
 * production N1CO.
 *
 * N1CO sandbox can still require 3DS for cards documented as direct-success,
 * and those cards are not reliable for subscription success E2E. Use the
 * explicit 3DS success cards for live subscription activation tests.
 */

export interface N1COTestCard {
  number: string;
  brand: 'Visa' | 'Mastercard';
  scenario: string;
  /** Expected end state for a fully-completed purchase flow. */
  expectsSuccess: boolean;
  /** Whether N1CO returns AUTHENTICATION_REQUIRED for this card. */
  requires3DS: boolean;
}

export const N1CO_TEST_CARDS: Record<string, N1COTestCard> = {
  // ── Direct success cards; sandbox may still request 3DS ─────────────────────
  visaSuccessNo3DS: {
    number: '4000056655665556',
    brand: 'Visa',
    scenario: 'Sandbox success',
    expectsSuccess: true,
    requires3DS: false,
  },
  mastercardSuccessNo3DS: {
    number: '5267260000000001',
    brand: 'Mastercard',
    scenario: 'Sandbox success',
    expectsSuccess: true,
    requires3DS: false,
  },
  visaDeclinedNo3DS: {
    number: '4242424242424242',
    brand: 'Visa',
    scenario: 'Declined without 3DS',
    expectsSuccess: false,
    requires3DS: false,
  },
  mastercardDeclinedNo3DS: {
    number: '5555555555554444',
    brand: 'Mastercard',
    scenario: 'Declined without 3DS',
    expectsSuccess: false,
    requires3DS: false,
  },

  // ── With 3DS authentication ────────────────────────────────────────────────
  visaSuccess3DS: {
    number: '4000000000001000',
    brand: 'Visa',
    scenario: '3DS authentication success',
    expectsSuccess: true,
    requires3DS: true,
  },
  mastercardSuccess3DS: {
    number: '5200000000001005',
    brand: 'Mastercard',
    scenario: '3DS authentication success',
    expectsSuccess: true,
    requires3DS: true,
  },
  visaFailed3DS: {
    number: '4000000000001013',
    brand: 'Visa',
    scenario: '3DS authentication failed',
    expectsSuccess: false,
    requires3DS: true,
  },
  mastercardFailed3DS: {
    number: '5200000000001018',
    brand: 'Mastercard',
    scenario: '3DS authentication failed',
    expectsSuccess: false,
    requires3DS: true,
  },
  visaUnsupported3DS: {
    number: '4000000000001034',
    brand: 'Visa',
    scenario: '3DS not supported — auth bypassed',
    expectsSuccess: true,
    requires3DS: true,
  },
  visaVerifySuccess: {
    number: '4000000000001091',
    brand: 'Visa',
    scenario: 'Verification → success',
    expectsSuccess: true,
    requires3DS: true,
  },
  visaVerifyFail: {
    number: '4000000000001109',
    brand: 'Visa',
    scenario: 'Verification → failed',
    expectsSuccess: false,
    requires3DS: true,
  },
};

/** Default cardholder + expiry + CVV — any future date / 3-digit CVV is fine. */
export const DEFAULT_CARDHOLDER = {
  name: 'Test User',
  month: '12',
  year: '2030',
  cvv: '123',
  email: 'test@facturassimples.com',
};
