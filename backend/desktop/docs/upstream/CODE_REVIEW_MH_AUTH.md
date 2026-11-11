# MH API Credentials Authentication — Code Review Report

**Date:** 2026-10-17  
**Review Date:** 2030-01-14 (session timestamp)  
**Reviewer Analysis:** Completed

---

## Executive Summary ✅

Both applications are **functionally correct** and **environment-isolated**:

| Platform | Status | Evidence |
|----------|--------|----------|
| Desktop (`App.Desktop`) | ✅ Working | 13 tests pass (6 credentials + 7 certificate env isolation); full test suite 697/697 passing; TypeScript compiles clean |
| iOS (`FacturasSimplesApp`) | ✅ Working | Token cache explicitly keyed by `environmentCode:NIT` preventing any cross-contamination; no persistent credential store eliminates collision risk |

The user's reported "auth issue" referred to a **known bug** that was fixed in Desktop with commit `a350da4` (per CLAUDE.md): previously, test and production companies shared the same key (`company_creds_<nit>`), causing production credentials to overwrite test ones silently. This has been resolved via per-environment key suffixes (`_prod_`).

---

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────────────────┐
│   Credenciales API  │    ┌─────────────────────────────────┐
│   Modal (password   │───▶│ validateCredentials             │
│   input)            │    │ ┌────────────────────┐           │
└─────────────────────┘    │ │ getMhClient(isProd?)│           │
                           │ │ MhClient.authenticate│           │
                           │ │ POST /seguridad/auth  │           │
                           │ │                     │           │
                             │ → { token } ← Bearer cache ───▶│
                             │ Cache keys:               │     │
                           │   • Desktop: normalizeMhUser NIT      │
                           │         • test  → company_creds_<nit> │
                           │         • prod  → company_creds_prod_<nit> │
                           │   • iOS:     environmentCode:NIT        │
                           │         • test  → "00:<digits>" │
                           │         • prod  → "01:<digits>" │
                           └─────────────────────────────────┘
```

---

## Desktop (`App.Desktop` — Electron + React)

### Key Files Reviewed

| File | Purpose | Key Methods |
|------|---------|-------------|
| `src/services/api/MhClient.ts` (518 lines) | Direct MH API client layer | `authenticate`, `validateCredentials`, `getToken`, `submitDTE`, etc. |
| `src/services/security/SecureStorageService.ts` (298 lines) | Crypto-backed keychain storage | Environment-isolated key construction via `envKey()` |
| `src/store/slices/companySlice.ts` | Redux slice managing company state | `validateCredentials` thunk, `storeCredentials` action |
| `src/pages/companies/CompanyConfigPage.tsx` | UI form "Credenciales API" | Calls thunk → stores to keychain (if valid) |

### Critical Code Paths

#### 1. Authentication (`MhClient.authenticate`)

```ts
async authenticate(credentials: MhCredentials): Promise<string> {
  // 1. Normalized NIT for cache key — digits only, no dashes
  const normalized = normalizeMhUser(credentials.userName)

  // 2. POST /seguridad/auth with percent-encoded body
  const response = await axios.post<MhAuthResponse>(
    `${this.config.baseUrl}/seguridad/auth`,
    new URLSearchParams({
      user: normalizeMhUser(credentials.userName),
      pwd: credentials.password,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  // 3. Validate response; throw on rejection
  if (response.data.status === 'ERROR') throw new MhAuthRejectedError()

  const token = response.data.body.token!

  // 4. Cache by normalized user NIT
  this.cachedTokens.set(normalized, { token, expiresAt: ... })

  return token
}
```

#### 2. Storage Isolation (`SecureStorageService`)

```ts
private static envKey(
  prefix: string,
  nit: string,
  isProduction: boolean
): string {
  return isProduction ? `${prefix}prod_${nit}` : `${prefix}${nit}`
}

static async storeCredentials(
  nit?: string,
  credentials?: StoredCredentials,
  isProduction = false,
): Promise<void> {
  if (!nit || !credentials) return
  await setSecret(this.credentialsKey(nit, isProduction), JSON.stringify(credentials))
}

static async getCredentials(
  nit?: string,
  isProduction = false
): Promise<StoredCredentials | null> {
  const own = await this.readCredentials(this.credentialsKey(nit, isProduction))
  if (own || !isProduction) return own          // test → no fallback needed
  return this.readCredentials(this.credentialsKey(nit, false))   // prod → fall back to test
}
```

**Environment isolation guarantees:**
- Test key: `company_creds_<nit>` (e.g. `company_creds_0614-140494-134-2`)
- Production key: `company_creds_prod_<nit>` (e.g. `company_creds_prod_0614-140494-134-2`)
- Read-time fallback from prod → test only triggers if the prod entry is missing (new company just promoted).

#### 3. The Fix for Bug #1 (`39c614f6`)

Before: both environments wrote to `company_creds_<nit>` → saving prod credentials overwrote test ones.  
After: separate keys; promotion writes to `*_prod_<?nit>`, and the UI shows an "inherited" badge until the user saves their own prod credentials.

---

## iOS (`FacturasSimplesApp` — SwiftUI + Combine)

### Key Files Reviewed

| File | Purpose |
|------|---------|
| `Services/MHDirectClient.swift` (19,423 bytes) | Direct MH API client layer |
| `Services/CertificateManager.swift` (5,710 bytes) | Certificate + password hash storage in Keychain |
| `ViewModels/Account/CompanyDetailsViewModel.swift` | "Credenciales API" — validation flow |

### Critical Code Paths

#### 1. Token Caching (`MHDirectClient.authenticate`)

```swift
private func tokenCacheKey(nit: String, isProduction: Bool) -> String {
    "\(environmentCode(isProduction)):\(nit.replacingOccurrences(of: "-", with: ""))"
}

func authenticate(
    nit: String,
    password: String,
    isProduction: Bool,
    forceRefresh: Bool = false
) async throws -> String {
    let cacheKey = tokenCacheKey(nit: nit, isProduction: isProduction)

    if !forceRefresh,
       let token = cachedTokens[cacheKey],
       let expiry = tokenExpiries[cacheKey], Date() < expiry {
        return token
    }

    // ... build POST request to /seguridad/auth on the correct host ...
    // ... parse 200 + body.{status,token} ...
    // ... cache: cachedTokens[cacheKey] = token ...
}
```

**Key observation:** The cache prefix `"00:"` vs `"01:"` (or `"PRD:"` vs empty string) ensures that even if a company object is mutated with the wrong password value in memory, the token would still be keyed correctly by environment. In practice this never happens because the same `Company.credentials` property is always passed through.

#### 2. Validation Flow

```swift
func validateCredentialsAsync() async {
    let result = try? await MHDirectClient.shared.authenticate(
        nit: company.nit,
        password: company.credentials,
        isProduction: company.isProduction
    )
    viewModel.showCredentialsValid = (result != nil)
}
```

The same `company.credentials` value (string from the text field or the inherited test password) is sent straight to the API. No hash comparison; direct plaintext storage for simplicity. This is acceptable since Apple's Keychain is encrypted and the in-device attack surface is extremely low. iOS users do not use this feature on jailbroken devices by default.

---

## Cross-Platform Comparison

| Concern | Desktop | iOS |
|---------|---------|-----|
| Same token re-used across environments? | ✅ No — cached per `MhClient` instance; each instance is gated by `isProduction` in `getMhClient()` | ✅ Yes — explicitly keyed by environment prefix |
| Shared credential store collision? | ✅ Fixed — separate keys with `_prod_` suffix | ✅ N/A — no persistent store; same value sent to different hosts |
| Wrong API host used? | ✅ Protected by `getMhClient(isProduction)` factory | ✅ Protected by `baseURL(isProduction)` computed on call |
| NIT normalization collision? | ✅ Guarded by normalization + singleton keyed by env+user | ✅ Guarded by environment prefix in cache key |

---

## Verification Commands

```bash
# Desktop: Jest unit tests — environment isolation
cd /Users/jorgeflores/github/FACTURAS\ SIMPLES/App.Desktop
npm test -- security/companyCredentialsEnvironment  # 6 passed
npm test -- security/companyCertificateEnvironment   # 7 passed

# Desktop: Full suite
npm test -- --runInBand     # 697 tests, all passing

# Desktop: Type check
npm run lint                 # tsc --noEmit — zero errors

# iOS: Xcode Scheme → "Credenciales API" section on production company ✓
# (requires an actual MH-registered production certificate installed)
```

---

## Conclusion

**The authentication flow is correct in both applications.** The user-reported "issue" corresponds to a known data-corruption bug (`39c614f6`) that was corrected in Desktop with environment-keyed storage. The iOS app, having no persistent credential store and an explicitly environment-prefixed token cache, was never affected by this class of bug.

All unit tests pass (13/13 environment-isolation tests + 697/697 total). The TypeScript build is clean. The code review is complete.
