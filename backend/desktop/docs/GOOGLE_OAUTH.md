# SparkleWash Desktop: Google OAuth

No secrets in this file. The client secret lives only in the git-ignored `desktop/.env.local`
(`VITE_GOOGLE_CLIENT_SECRET`), next to `VITE_GOOGLE_CLIENT_ID`.

| Item | Value |
| --- | --- |
| Google Cloud project | SparkleWash (`beaming-answer-514221-b0`, number `678796243598`) |
| Client name | SparkleWash Desktop |
| Client type | Desktop app |
| Client ID | `678796243598-12nn62ea16r8btjmgfa0rk6rlojn2ro5.apps.googleusercontent.com` |
| Redirect model | System browser, one-shot loopback `http://127.0.0.1:<random port>/auth/callback`, PKCE plus client secret |
| Scopes (Data Access) | `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.file` (requested on first use, Drive backup) |
| Audience | External, publishing status **Testing** (100 user cap); test user: `jorgeafc00h@gmail.com` |
| APIs enabled | Google Drive API |
| Branding | App name "SparkleWash", support email `jorgeafc00h@gmail.com`; no logo or domains set |

Console: https://console.cloud.google.com/auth/overview?project=beaming-answer-514221-b0

## Rules

- The API's `SPARKLEWASH_GOOGLE_CLIENT_ID` (comma-separated list) must list this client id, otherwise
  ID tokens from the desktop app are rejected.
- While the app is in Testing, only listed test users can sign in. Add more under Audience, or publish
  (and verify, if required) before real customers use it.
- Verified 2026-11-11: token from this client accepted by the real API (`/api/tenants/register` 201,
  `/api/auth/google` 200).

## Deployed API (IBM Code Engine)

`.github/workflows/deploy-ibm-code-engine.yml` merges the optional, non-secret repository/environment
variable `SPARKLEWASH_GOOGLE_EXTRA_CLIENT_IDS` (comma-separated) into the API's
`SPARKLEWASH_GOOGLE_CLIENT_ID` when it writes the Code Engine settings secret. The protected
`SPARKLEWASH_APP_CONFIG_ENV` secret keeps only the web client. To allow the desktop app:

```sh
gh variable set SPARKLEWASH_GOOGLE_EXTRA_CLIENT_IDS --env ibm-demo \
  --body "678796243598-12nn62ea16r8btjmgfa0rk6rlojn2ro5.apps.googleusercontent.com"
```

Then run the deploy workflow. For a local API add the id to `SPARKLEWASH_GOOGLE_CLIENT_ID`, e.g.
`SPARKLEWASH_GOOGLE_CLIENT_ID=<web id>,678796243598-12nn62ea16r8btjmgfa0rk6rlojn2ro5.apps.googleusercontent.com`.

## Upstream Facturas Simples services

The carwash sign-in (`signInCarwash`) uses this client directly and does not touch Invoices.Api.
DTE submission uses the Invoices.Api key and keeps working. The upstream **account** features
(Facturas Simples login, subscription entitlements, cloud mirror, Device Sync relay) validate the
Google audience against Facturas Simples' own client ids, so they reject tokens from this client until
Invoices.Api's provider audiences include it. That is a change in the Facturas Simples deployment.
