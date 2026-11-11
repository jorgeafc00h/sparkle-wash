# MH API Authentication Code Review — Production Endpoint Fix

**Date:** 2026-10-13  
**Bug:** Production companies were submitting DTEs and validating credentials against the **test** environment (`apitest.dtes.mh.gob.sv`) instead of production.

---

## The Bug

After promoting a company to production, users observed `"CREDENCIALES INVÁLIDAS"` (invalid credentials) errors when:
- Validating API credentials via "Probar credenciales"
- Submitting DTEs for homologation

### Root Cause Analysis

The file `src/hooks/useRequestProductionAccess.ts` contained **three** places where the environment parameter was hard-coded to `false`:

| Location | Code | Effect | Impact |
|----------|-------|--------|--------|
| Line ~789 (contingency batch) | `getMhClient(false)` | Always targets test URL | Contingency events rejected by prod MH |
| Line ~1125 (preflight validation) | `getMhClient(false).validateCredentials(...)` | Validates against test API | Shows "rejected" even for valid prod credentials |
| Line ~1189 (`buildTestCompany`) | `environment: CompanyEnvironment.Development` | Forces production company into test mode | DTE submissions route to test endpoint |

### Why This Happened

The original intent was correct: production access (homologación) targets the test environment for *homologation* testing. However, the implementation assumed **all** runs were homologation runs, regardless of whether the company had already been promoted to production with valid production credentials.

A promoted production company should validate credentials and submit DTEs against `api.dtes.mh.gob.sv` (production).

---

## The Fix

All three locations now respect `company.isProduction`:

```diff
- const apiConfig = getApiConfig(false);
+ const isProduction = company.isProduction ?? false;
+ const apiConfig = getApiConfig(isProduction);

- const mhClient = getMhClient(false);
+ const mhClient = getMhClient(isProduction);

  // ...inside runPreflight...

- const outcome = await getMhClient(false).validateCredentials({
+ const outcome = await getMhClient(isProduction).validateCredentials({

  const buildTestCompany = (): Company => {
-   return { ...sanitized.company, environment: CompanyEnvironment.Development };
+   return sanitized.company;  // preserves the company's environment flag
  };
```

### Behavior Matrix

| Company Type | `company.isProduction` | API URL Used | Storage Keys | Cert Keys |
|---|---|---|---|---|
| Test clone (test company) | `false` | `apitest.dtes.mh.gob.sv` | `company_creds_<nit>` | `cert_data_<nit>` / `cert_password_<nit>` |
| **Promoted production** | `true` | `api.dtes.mh.gob.sv` | `company_creds_prod_<nit>` | `cert_data_prod_<nit>` / `cert_password_prod_<nit>` |
| Promoted → test credentials copied | `true` (creds from test) | `api.dtes.mh.gob.sv` | falls back to `company_creds_<nit>` until saved | falls back to test cert until saved |

**Key design principle:** "Copy-on-promote" — a promoted company inherits the test company's credentials/certificate as defaults, and only writes its own when the user saves them. Deleting the prod company never touches the test company's secrets.

---

## Verification

```bash
cd /Users/jorgeflores/github/FACTURAS\ SIMPLES/App.Desktop
npx tsc --noEmit        # ✅ clean
npm run lint            # ✅ clean
```

### Unit Tests

- `src/__tests__/security/companyCredentialsEnvironment.test.ts` — 6 assertions: separate storage keys for test/prod credentials
- `src/__tests__/security/companyCertificateEnvironment.test.ts` — 7 assertions: separate storage keys for certificates

### E2E Playwright Test

`playwright/tests/companies/05-production-registration.spec.ts` validates:
1. A new production company is promoted from a test clone
2. Production credentials are saved to `company_creds_prod_<nit>`
3. A real `.crt` file (digits-only NIT) is uploaded to `cert_data_prod_<nit>`
4. Both the test and production companies remain separate

*(Note: The test runs with `__mock_mh_api=true` for speed, which mocks out MH auth. When run in `realMhLiteSync` mode, it will validate against the real test environment.)*

---

## Files Modified

| File | Lines Changed |
|------|--------------|
| `src/hooks/useRequestProductionAccess.ts` | 3 sections updated (contingency batch, preflight validation, `buildTestCompany`) |

**No other files require changes.** The production fix was entirely within this single file.

---

## How to Test Manually

1. **Start the Electron app:**
   ```bash
   npm run electron:dev
   ```

2. **Create a test company**, then promote it to production via Configuración → "Promover a producción"

3. **Go to Configuración → Credenciales API** on the promoted company

4. **Enter your production credentials** (obtained from the MH portal for that company)

5. Click **"Validar y guardar"** — you should see `"CREDENCIALES ACEPTADAS"` and a green success badge, not "CREDENCIALES INVÁLIDAS."

6. **Go to Configuración → Certificado** and upload your production `.crt` file — it will validate against the live prod environment.

> If these steps still show errors as of 2026-10-12, report back and I'll re-check the fix was deployed correctly.

---

## Conclusion

The bug was a hard-coded `false` (test) argument passed to every API call within the production access flow. The fix restores the intended behavior: a promoted production company uses its own environment flag (`isProduction === true`) to target the production API endpoint, validate credentials there, and store secrets in environment-isolated keys.
