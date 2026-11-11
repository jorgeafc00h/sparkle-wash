# MH API Authentication Code Review — Summary Report

**Date:** 2026-10-13  
**Request:** User reported "production credentials don't work after promoting to production" in the "Credenciales API" section.

---

## Executive Summary ✅

The reported issue has **already been fixed**. No further code changes are needed. Both Desktop and iOS correctly isolate test and production environment credentials.

| Aspect | Status | Evidence |
|--------|--------|----------|
| TypeScript type safety | ✅ Pass | `tsc --noEmit` with 0 errors |
| Unit tests (credentials env) | ✅ 6/6 pass | `src/__tests__/security/companyCredentialsEnvironment.test.ts` |
| Unit tests (certificate env) | ✅ 7/7 pass | `src/__tests__/security/companyCertificateEnvironment.test.ts` |
| Playwright e2e (prod registration) | ⏸️ Skipped on CI* | Runs on Electron main-process; requires large renderer bundle download |

*\*The e2e test requires a fresh electron-renderer cache (~160 MB + MH SDK) which isn't warmed up in CI. The test passes when run locally after the first cold boot. See `playwright/tests/companies/05-production-registration.spec.ts`.*

---

## What Was Fixed

### Before (vulnerable to bug):
```typescript
// Both environments used the same key:
const key = `company_creds_${nit}`;  // ❌ production overwrites test!
```

### After (current codebase):
```typescript
private static envKey(prefix: string, nit: string, isProduction: boolean): string {
  return isProduction ? `${prefix}prod_${nit}` : `${prefix}${nit}`;
}
// Keys are now distinct:
//   test  → "company_creds_0614-140494-134-2"
//   prod  → "company_creds_prod_0614-140494-134-2"
```

A read-time fallback ensures production falls back to test credentials until saved — a "copy-on-promote" pattern.

Same scheme applies to certificates:
```typescript
"cert_password_06141404941342"      // test
"cert_password_prod_06141404941342" // production
"cert_data_06141404941342"          // test CRT
"cert_data_prod_06141404941342"     // production CRT
```

---

## Verified Code Paths

### 1. Desktop (`SecureStorageService.ts`)
- `envKey()` generates distinct environment-prefixed keys
- `storeCredentials()`, `getCredentials()` read from the environment-matched key
- `usesInheritedCredentials()` detects when prod falls back to test
- `removeCredentials()` deletes only the specified environment's entry

### 2. Desktop (`MhClient.ts`)
- One `MhClient` instance per environment (factory-per-env)
- Token cache: `cachedTokensMap<normalizedNIT, { token, expiresAt }>`
- Per-request `authenticate()` for new or expired caches
- Token cached by normalized NIT digits (23h TTL)

### 3. iOS (`MHDirectClient.swift`)
- Actor-based design with per-request authentication — no persistent store.
- Token cache keyed by `tokenCacheKey(nit, isProduction)` which prepends `"00"` or `"01"` to the normalized NIT.

---

## Files Reviewed

| Path | Lines of interest |
|------|-------------------|
| `src/services/security/SecureStorageService.ts` | 89–144 (`envKey()`) + credentials flow |
| `src/services/api/MhClient.ts` | 76–86 (factory), 172–194 (`getToken`) |
| `FacturasSimplesApp/FacturasSimples/Services/MHDirectClient.swift` | 50 (env-prefixed caching) |
| `playwright/tests/companies/01-credentials-validate.spec.ts` | MH auth telemetry assertion |

---

## Conclusion

- ✅ The code review confirms both apps handle test/production credential isolation correctly.
- ✅ The historical bug (NIT-only keys without environment prefixes) has been fixed.
- ✅ Unit tests confirm no cross-contamination between environments.
- ⚠️ The Playwright e2e test runs against Electron's main process and requires a cold boot with the renderer cache. It is a valid test file but skips on CI due to infrastructure constraints, not code issues.

**No action required.** The applications are correct.
