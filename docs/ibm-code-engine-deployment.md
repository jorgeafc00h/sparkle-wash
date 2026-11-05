# IBM Code Engine deployment plan

## Image and deploy flow

The manual `Deploy IBM Code Engine demo` workflow on `main` builds the Linux AMD64 API image, runs `scripts/smoke-container.sh`, pushes the tested image to `ghcr.io/<owner>/<repository>`, captures its digest, deploys that digest to Code Engine, and runs `scripts/smoke-cloud.sh`. The workflow uses `min-scale=0`, `max-scale=1`, port 8080, `/healthz` and `/readyz`, and defaults to 0.125 vCPU / 0.25 GB. It does not deploy pull requests or run automatically.

GHCR is the image registry; GitHub Actions artifacts are not used for release images. The default keeps the package private and needs the Code Engine registry pull settings below. To allow anonymous pulls, publish the package, change its visibility to public, then set `GHCR_PUBLIC=true`; the workflow verifies an anonymous pull before deploy. Making the repository public does not make its package public.

## GitHub `ibm-demo` environment

Restrict the environment to `main`; add a reviewer if available.

Required variables:

- `IBM_REGION`, `IBM_RESOURCE_GROUP`, `IBM_CE_PROJECT`, `IBM_CE_APP`
- `IBM_CE_OFFLINE_SIGNING_SECRET` (Code Engine secret name)

Optional runtime variables: `IBM_CE_CPU` and `IBM_CE_MEMORY` (defaults `0.125` and `0.25G`), and `IBM_CE_USER` (defaults `1654`, matching the image's non-root UID). Code Engine's CLI defaults an unset UID to root and overrides the Dockerfile `USER`, so the workflow always passes the non-root UID explicitly.

Required secrets:

- `IBM_CLOUD_API_KEY`
- `SPARKLEWASH_OFFLINE_SIGNING_PRIVATE_KEY` (dedicated P-256 PEM key)

For private GHCR pulls, also set variable `IBM_CE_REGISTRY_SECRET`, variable `GHCR_PULL_USERNAME`, and secret `GHCR_PULL_TOKEN` scoped to package read. Keep the workflow push token (`GITHUB_TOKEN`) separate from this pull token. For public GHCR, set `GHCR_PUBLIC=true` and omit private-pull credentials.

To configure staff and device settings, set variable `IBM_CE_APP_CONFIG_SECRET` and secret `SPARKLEWASH_APP_CONFIG_ENV` containing newline-separated `KEY=VALUE` entries, for example Google client IDs, the staff role allowlist, allowed web origins, and the device ingest key. Do not commit this file or print its contents in logs.

## Optional Neon runtime connection

The `ibm-demo` environment now has the rotated `NEON_RUNTIME_CONNECTION_STRING` secret, the P-256 `SPARKLEWASH_OFFLINE_SIGNING_PRIVATE_KEY` secret, and its Code Engine secret-name variable. No IBM account key or target region, resource group, project, or app variables are configured yet. The Neon-backed API passed a local production-mode `/readyz` check using the pooled runtime role. Set variable `IBM_CE_RUNTIME_SECRET` to the Code Engine generic secret name to sync the connection as `SPARKLEWASH_SESSION_POSTGRES`.

PostgreSQL store flags are passed to the Code Engine app as booleans and default to `false`:

- `SPARKLEWASH_POSTGRES_DIRECTORY`
- `SPARKLEWASH_POSTGRES_DEVICES` (requires directory)
- `SPARKLEWASH_POSTGRES_WORKFLOW` (requires directory)
- `SPARKLEWASH_POSTGRES_INVENTORY` (requires workflow)

When any flag is `true`, deployment requires the Neon connection secret and `IBM_CE_RUNTIME_SECRET`. The current smoke and PostgreSQL integration tests do not prove full production cutover: photo bytes, compatibility telemetry, file import, backup restore, and an end-to-end cloud session replacement still need acceptance. Keep flags off for a disposable demo until those cutover checks pass. The API otherwise keeps file-backed JSON and can lose it when a Code Engine instance is replaced.

## Cost and retention

The current estimate puts a short 60-hour demo within IBM Code Engine and Neon Free grants, if the account-wide allowances remain available. Longer runtime can incur charges. GitHub currently lists Container registry image storage and bandwidth as free; the workflow keeps the package private by default, so Code Engine still needs a read-only package token. A public GitHub repository does not make its package public. Do not treat Neon point-in-time restore or a phone's SwiftData cache as an independent archive. Follow [cloud cost and retention guidance](cloud-cost-and-retention.md); the IBM COS archive workflow verifies a batch and isolated restore before upload and never purges Neon rows.

## First deployment gate

1. Confirm the IBM account can provision Code Engine, then choose its region, resource group, project and app names. IBM's current registration page advertises both a no-card 30-day trial (limited runtime/services) and a $200-credit signup; its account guide says Pay-As-You-Go receives full catalog access and requests a card for verification. The docs do not establish that the limited no-card trial can create Code Engine apps, so verify this in the new account before relying on it. The promotional credit and free usage are not a spending cap; set billing notifications and monitor usage.
2. Choose private GHCR pull credentials or explicitly make the package public.
3. Add the IBM API key and signing key to protected GitHub environment secrets.
4. Add the required IBM variables, then manually dispatch the workflow from `main`.
5. Check the digest, ready revision, HTTPS smoke result and one complete staff workflow before pointing clients at the service.
