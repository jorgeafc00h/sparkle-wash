# IBM Code Engine deployment with GitHub Actions

## Recommended pilot shape

Build the Linux AMD64 API image once in GitHub Actions, push it to
GitHub Container Registry (GHCR), and deploy the immutable registry digest to
an IBM Code Engine application. The first approved deployment creates the
project and application if they do not exist; later runs update that app.
Use `min-scale=0`, `max-scale=1`,
the current `/healthz` and `/readyz` probes. Start with 0.125 vCPU and 0.25 GB
(`IBM_CE_CPU` and `IBM_CE_MEMORY` workflow variables) and raise the allocation
only if the constrained smoke and measured peak memory require it.
Code Engine requires a Pay-as-you-Go IBM account even when metered app use
stays inside its zero-cost grant. Code Engine defaults new apps to 1 vCPU and
4 GB, so set sizing explicitly. Its smallest supported app size is 0.125 vCPU
and 0.25 GB.
[Supported CPU and memory combinations](https://cloud.ibm.com/docs/codeengine?topic=codeengine-mem-cpu-combo)

## Cost estimate

The base case assumes one site, free grants unused elsewhere in the account, a
0.25 vCPU / 0.5 GB replica, no persistent minimum replica, no long-lived
streams, and request counts including polling, camera traffic, probes and
retries. The 240- and 720-hour request rows model one web client polling five
routes every 15 seconds; one active iOS client adds about half as many requests.
The table also shows the 0.125 vCPU / 0.25 GB IBM option.

| Monthly profile | Replica activity | API requests | Azure Container Apps | IBM Code Engine | Neon |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short demo | 60 hours | 72,000 | $0 compute and requests | $0 compute and requests | $0 at 15 CU-hours if active only during those hours |
| Regular shifts | 240 hours | 288,000 | about $1.08 compute; requests remain in grant | about $4.91 total at 0.25/0.5, or $0.43 at 0.125/0.25 | $0 at 60 CU-hours on Free |
| Always active | 720 hours | 864,000 | about $14.04 active-rate compute; requests remain in grant | about $23.12 total at 0.25/0.5, or $9.69 at 0.125/0.25 | about $19.43 on Launch at 180 CU-hours and 1 GB |

IBM compute uses (total allocated vCPU-seconds minus the 100,000-second free
grant) at $0.00003431 per vCPU-second, plus (allocated GB-seconds minus the
200,000-second free grant) at $0.00000356 per GB-second. Subtract the
100,000 included requests before applying $0.538 per million requests. At 240
hours, the base size contributes about $3.98 CPU, $0.83 memory and $0.10
requests. At 720 hours it contributes about $18.81 CPU, $3.90 memory and
$0.41 requests. The estimates exclude Azure Files, object storage, logs, ingress or egress,
database restore history, taxes and any account-level grant already consumed.
Rates and Neon grant values change. Recheck official price pages and the IBM
estimator for the target region before launch. Azure ACA's monthly subscription
grant is larger than Code Engine's, which makes it more forgiving if app
activity or request polling grows.

## GitHub Actions sequence

The `ibm-demo` GitHub Environment is created and restricted to the `main`
branch. Add the IBM region, resource group and credentials below before
dispatching the workflow. The workflow creates the project and public app if
they do not exist, at scale zero until requests arrive. Require reviewer
approval if environment reviewers are available:

| Name | Type | Value |
| --- | --- | --- |
| `IBM_CE_APP` | Variable | Code Engine application name (created on first deploy if missing) |
| `IBM_CE_REGISTRY_SECRET` | Variable | Name for the Code Engine GHCR pull secret |
| `IBM_CE_CPU` | Variable | Optional supported CPU size; defaults to `0.125` |
| `IBM_CE_MEMORY` | Variable | Optional supported memory size; defaults to `0.25G` |
| `IBM_CE_RUNTIME_SECRET` | Variable | Optional name for the workflow-managed Code Engine generic secret; leave empty until runtime DB injection is wanted |
| `IBM_CE_OFFLINE_SIGNING_SECRET` | Variable | Required name for the Code Engine generic secret that contains the offline entitlement signing key |
| `IBM_REGION` | Variable | IBM Cloud region, for example `us-south` |
| `IBM_RESOURCE_GROUP` | Variable | IBM Cloud resource group name |
| `IBM_CE_PROJECT` | Variable | Code Engine project name (created on first deploy if missing) |
| `VITE_GOOGLE_CLIENT_ID` | Variable | Public Google OAuth web client ID embedded in the workboard bundle |
| `IBM_CE_APP_CONFIG_SECRET` | Variable | Required name for the Code Engine generic secret containing runtime sign-in settings |
| `SPARKLEWASH_APP_CONFIG_ENV` | Secret | Multiline settings including the matching `SPARKLEWASH_GOOGLE_CLIENT_ID` and `SPARKLEWASH_STAFF_ROLES` allowlist |
| `IBM_CLOUD_API_KEY` | Secret | IBM Cloud API key scoped to deployment operations |
| `SPARKLEWASH_OFFLINE_SIGNING_PRIVATE_KEY` | Secret | Required PEM-encoded ECDSA P-256 private key; signs 24-hour offline history grants |
| `NEON_RUNTIME_CONNECTION_STRING` | Secret | Restricted runtime login with `SSL Mode=VerifyFull`; optional until database cutover |
| `GHCR_PULL_USERNAME` | Variable | Required only for a private GHCR package |
| `GHCR_PULL_TOKEN` | Secret | Required only for a private package; classic PAT with `read:packages` |

For the lowest-friction cross-cloud pull, publish this source-matched image as
a public GHCR package and set the repository variable `GHCR_PUBLIC=true`.
Because the repository is already public, this exposes the deployable image as
well as its source. Set package visibility to public after its first publish;
the workflow verifies an anonymous pull before deploying. Leave the registry
secret, pull username, and pull token unset in this mode. The default is
`GHCR_PUBLIC=false`, which keeps the image private and requires the protected
read-only token settings above.

The repository Actions token needs `packages: write`. The IBM workflow publishes
to `ghcr.io/jorgeafc00h/sparkle-wash`, a repository-scoped package. The
Dockerfile carries the OCI source label for this repository so GHCR can link
the package at its first publish and grant the workflow access. The older
`ghcr.io/jorgeafc00h/sparklewash-api` package is not linked and is not the IBM
workflow target. For a private package, Code Engine uses a separate read-only
`GHCR_PULL_TOKEN`; do not reuse that token for publishing. For a public package,
the workflow verifies an anonymous pull and Code Engine needs no GHCR secret.

1. The regular validation workflow runs `make verify` and builds and smoke-checks
   the Linux AMD64 container on pushes and pull requests without registry credentials.
2. Manually dispatch `Deploy IBM Code Engine demo` from `main`. Its build job
   creates one Linux AMD64 image, smoke-checks that local image, then pushes the
   same image to GHCR using the repository `GITHUB_TOKEN` with `packages: write`.
   It captures the registry digest and never deploys a mutable tag.
3. The deploy job is restricted to the `ibm-demo` GitHub Environment. Store an IBM API key,
   region, resource group, Code Engine project name and app name as environment
   secrets or variables. The workflow creates the project/app on first run if
   absent. For a private GHCR package, store its read-only token and username;
   for a public package, set `GHCR_PUBLIC=true` and omit those settings. Restrict
   the environment to `main` and add required reviewers when available.
4. Authenticate the IBM Cloud CLI, select the target resource group, install
   or update the Code Engine plugin, create/select the project, and (for a
   private GHCR package) create or update the Code Engine registry secret from
   a protected temporary file. Then invoke
   `deploy/ibm/deploy-demo.sh` with `IMAGE_REF` set to the immutable digest.
5. Read the app URL from Code Engine and run `scripts/smoke-cloud.sh` against
   it. Record the digest, app revision and smoke result in the workflow log.

Never put Neon credentials or staff/device secrets in the image or workflow
logs. When `IBM_CE_RUNTIME_SECRET` is nonempty, the workflow copies
`NEON_RUNTIME_CONNECTION_STRING` from the protected GitHub Environment secret
to a Code Engine generic secret key named `SPARKLEWASH_SESSION_POSTGRES`, then
attaches that secret with `--env-from-secret`. Leave `IBM_CE_RUNTIME_SECRET`
empty to keep the database connection out of Code Engine. PostgreSQL store
flags are passed as Code Engine app environment values and default to `false`;
the workflow checks their dependency order and requires this runtime secret if
any flag is enabled. The workflow requires `VITE_GOOGLE_CLIENT_ID`,
`IBM_CE_APP_CONFIG_SECRET`, and a multiline `SPARKLEWASH_APP_CONFIG_ENV` secret
containing `KEY=VALUE` lines. Preflight confirms the runtime Google client ID
matches the public client ID embedded in the web bundle and that a staff-role
allowlist is present. To enable durable
PostgreSQL-backed stores, include `SPARKLEWASH_SESSION_POSTGRES` with
`SSL Mode=VerifyFull`, plus `SPARKLEWASH_POSTGRES_DIRECTORY=true`,
`SPARKLEWASH_POSTGRES_DEVICES=true`, `SPARKLEWASH_POSTGRES_WORKFLOW=true`, and
`SPARKLEWASH_POSTGRES_INVENTORY=true`. Include `SPARKLEWASH_INGEST_KEY` if a
camera will send observations. The current application uses file-backed JSON by default, in-memory staff sessions, and file-backed photos. PostgreSQL migrations `001_core`, `002_immutable_arrival_evidence`, and `003_archive_revisions` plus the least-privilege runtime grants are checked in and applied to Neon `main`. The archive revision grant was verified to allow SELECT but not UPDATE; an attempted evidence rewrite was rejected by the database trigger. The GitHub `ibm-demo` environment now stores the rotated `NEON_RUNTIME_CONNECTION_STRING` and dedicated P-256 signing key as secrets, and has `IBM_CE_OFFLINE_SIGNING_SECRET` set. A local production-mode API passed `/readyz` against Neon with directory and archive flags on. The Neon secret has not been copied into Code Engine. Do not set PostgreSQL flags in cloud until all stores are integration-tested and import and restore are rehearsed. Code Engine scale-to-zero or
a new revision can lose the default file-backed state. Use this profile only
for disposable demo data until PostgreSQL, staff sessions, and durable
photo/object storage have been configured and rehearsed. Neon is independent
of IBM's compute grant.

Offline history requires `SPARKLEWASH_OFFLINE_SIGNING_PRIVATE_KEY` and
`IBM_CE_OFFLINE_SIGNING_SECRET`; both are now configured in the `ibm-demo`
GitHub environment. The deploy workflow syncs the protected P-256 key to a Code Engine generic
secret and mounts it as `SPARKLEWASH_OFFLINE_SIGNING_PRIVATE_KEY`. The API
returns only the corresponding public key over the authenticated HTTPS archive
index. Grants are bound to origin, tenant, staff subject, role, and archive
revision and expire after 24 hours. Local HTTP is accepted only for localhost
development.

## Before the first deployment

- Confirm the IBM region, resource group, and names for the Code Engine project and app.
- Confirm account-level free grants are unused and measure peak memory and
  request volume from a shift, including every client poll and camera retry.
- Confirm the first-published repository-scoped GHCR package is linked to this
  repository. For private visibility, grant the pull-token account package
  read access; for public visibility, set `GHCR_PUBLIC=true` and let the
  workflow validate anonymous image access. The workflow push token and private
  Code Engine pull token are separate.
- A Neon Free project named `sparklewash` is provisioned in `aws-us-east-1` at
0.25 CU. Its default `main` branch has migrations `001_core`,
`002_immutable_arrival_evidence`, and `003_archive_revisions`, plus the restricted
  runtime role, but the API is not yet using it. Verify the connection stored
  in GitHub and have the workflow sync it only when `IBM_CE_RUNTIME_SECRET` is
  set. Keep PostgreSQL flags off until store integration tests, role separation,
  import and restore are rehearsed.
- Keep photo evidence out of the Neon database. Select an object-storage
  target and rehearse export, checksum verification and restore before any
  automated retention purge.
- Run and verify the workflow against a disposable Code Engine project before
  pointing a camera or staff app at it.

## Neon archive workflow for IBM COS

Keep archive work separate from the Code Engine deploy workflow. The manual
`Verify and archive Neon history to IBM COS` workflow runs only from `main` in
the `ibm-archive` GitHub Environment. That environment now exists and is
restricted to `main`; add a second trusted reviewer before the first dispatch
if one is available. The workflow takes a tenant and date range, uses a
read-only Neon export login, restores the resulting batch into a disposable
PostgreSQL 18 service and rolls the restore back, then publishes and verifies
the digest-addressed batch in a private IBM COS bucket. It never purges Neon
rows. Do not store Neon or COS credentials in the image.

The `ibm-archive` environment is restricted to `main` and contains the verified
read-only Neon connection secret plus `NEON_ARCHIVE_TENANT_ID=default`. It still
needs `IBM_REGION`, `IBM_RESOURCE_GROUP`, `IBM_COS_BUCKET`, and
`IBM_COS_INSTANCE_ID` variables plus the `IBM_CLOUD_API_KEY` secret. The
requested tenant must exactly match the configured
`NEON_ARCHIVE_TENANT_ID=default` allowlist.
The Neon secret must be a read-only PostgreSQL URI for a dedicated archive
export login, limited to SELECT on the tables needed by
`export_closed_jobs.py`. The `sparklewash_archive_exporter` NOLOGIN group and
`sparklewash_archive_login` were created on Neon `main`. The login has no
elevated attributes, has a non-inheriting membership with SET access only to
the archive group, and was verified to read jobs and fail writes. Use
`backend/db/roles/archive_exporter_login.sql` for future setup; Neon CLI role
creation assigns elevated defaults, so create this login through SQL with
explicit role attributes. Keep the login URI in the environment secret. The
workflow uses
`PGOPTIONS` to `SET ROLE` to the SELECT-only role, set
`default_transaction_read_only=on`, and bound the query to 60 seconds. The
archive URI must use Neon’s direct, non-pooled endpoint because the pooler
rejects the startup `role` parameter in `PGOPTIONS`. The
`NEON_ARCHIVE_TENANT_ID` allowlist variable must identify the only tenant this
environment can export. The IBM API key should have
only the COS access needed to upload, HEAD, GET, and inspect bucket/object
configuration. Keep the `ibm-demo` runtime database secret separate.

`backend/db/publish_archive_ibm_cos.py` packages a validated batch and optional
evidence ZIP under a tenant-scoped SHA-256 key. It checks that the bucket
blocks all public access and has Object Lock enabled with a nonzero default
retention in COMPLIANCE or GOVERNANCE mode. The business must approve that
retention and mode before configuring the bucket; this is separate from the
90-day minimum storage duration of IBM Archive tier. The publisher uses
`object-head` to avoid overwriting an existing object, checks the object's
active retention, downloads the complete object, and compares its SHA-256 to
the local bundle. An ETag alone is not treated as a payload checksum. Run it after `export_closed_jobs.py` and, when applicable,
`export_archive_evidence.py`:

```sh
python3 backend/db/publish_archive_ibm_cos.py /path/to/archive \
  --bucket YOUR_PRIVATE_ARCHIVE_BUCKET --region us-south \
  --evidence /path/to/evidence.zip
```

The local fake-CLI rehearsal verifies upload, readback, checksum validation,
and idempotent reuse. A live IBM bucket publication and PostgreSQL restore are
still required before the batch is considered restorable. The script does not
manage row/legal holds or purge Neon data. Keep this independent from the
deploy job so a deployment failure cannot skip retention work. Use an online
COS tier until the approved access and retention period justify the cold tier;
IBM Archive bills a minimum 90 days and small objects as 128 KB. [IBM COS CLI reference](https://cloud.ibm.com/docs/cloud-object-storage?topic=cloud-object-storage-ic-cos-cli)

The future purge workflow must be separate and manually approved in a protected
GitHub Environment. It should require both a reviewed retention-policy ID and
an explicit purge switch, verify the COS copy and restore evidence, re-read
every current job version, and skip any job under an active hold. Keep purge
disabled until the retention periods and financial-record requirements are
approved. The repository now has export, transactional restore, and a COS
publisher; live publication, a hold registry, purge implementation, and an
actual populated archive restore are still outstanding.

## Repository integration state (checked 2026-11-05)

The owner confirmed that the current local workspace is the source of truth.
A review branch, `codex/local-platform-ibm-demo`, overlays the active project
under `backend/`, `frontend/`, and `SparkleWash-iOS/` while preserving the
legacy `src/`, `web/`, and `ios/` tree. The IBM workflow is included in that
branch, and the pull request validation workflow runs the current project
checks. The deployment workflow only runs from `main`, so review and merge
must happen before deployment can be dispatched.

## Deployment status (2026-11-10)

The demo is deployed to IBM Code Engine project `sparklewash-demo` (us-south),
app `sparklewash-api`, at
`https://sparklewash-api.2gynijrhlpdl.us-south.codeengine.appdomain.cloud`.
`/healthz` and `/readyz` return 200 and the workflow's endpoint check passes.
Staff Google sign-in was verified end to end in a browser.

What the first deploys taught us:

- Code Engine's default probes (1s timeout, one failure, no initial delay) kill
  a cold-starting .NET container on 0.125 vCPU, so revision 1 never became
  ready. `deploy-demo.sh` now sets a 10s initial delay (the maximum Code Engine
  allows), a 5s timeout and a failure threshold of 9 on both probes.
- `build-publish` must run in the `ibm-demo` environment. Without it
  `vars.VITE_GOOGLE_CLIENT_ID` is empty at build time and the web bundle ships
  with no Google sign-in button.
- Cold start after scale-to-zero measured 23 to 75 seconds on 0.125 vCPU
  (33, 75, 60, 23). The image is about 99 MB, so the pull is not the cause.
  `deploy-demo.sh` now keeps one instance warm (`IBM_CE_MIN_SCALE`, default 1),
  which costs roughly $13 a month at Code Engine's published rates for
  0.125 vCPU / 0.25 GB. Set `IBM_CE_MIN_SCALE=0` to return to scale-to-zero.

Current configuration:

- `IBM_CLOUD_API_KEY` in `ibm-demo` belongs to the Service ID
  `sparklewash-github-deploy`, which has only Code Engine Manager and Editor
  plus Viewer on the `Default` resource group. No account-wide user key is
  stored.
- The GHCR package is public (`GHCR_PUBLIC=true`), so no pull secret is used.
- The Google OAuth Web client lives in its own Google Cloud project. The
  deployed URL and `http://localhost:5173` are authorized origins. The consent
  screen is in testing mode, so each additional staff member must be added as a
  test user and to the `SPARKLEWASH_STAFF_ROLES` allowlist.
- The four `SPARKLEWASH_POSTGRES_*` flags are `false`. The Neon secret is stored
  in the environment but not wired into Code Engine, so data is not persisted in
  Neon yet. Do not enable the flags until all stores are integration-tested and
  import and restore are rehearsed.
- The `ibm-archive` environment and its COS bucket have not been created.

## Sources

- [IBM Code Engine pricing](https://cloud.ibm.com/docs/codeengine?topic=codeengine-pricing)
- [IBM Code Engine sizing](https://cloud.ibm.com/docs/codeengine?topic=codeengine-mem-cpu-combo)
- [IBM deploy and scale apps](https://cloud.ibm.com/docs/codeengine?topic=codeengine-deploy-app-tutorial)
- [IBM Code Engine CLI reference](https://cloud.ibm.com/docs/codeengine?topic=codeengine-cli)
- [IBM Code Engine secrets](https://cloud.ibm.com/docs/codeengine?topic=codeengine-secret)
- [IBM liveness and readiness probes](https://cloud.ibm.com/docs/codeengine?topic=codeengine-app-probes)
- [IBM Code Engine price example](https://cloud.ibm.com/docs/account?topic=account-sample)
- [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)
- [Neon pricing](https://neon.com/pricing)
- [SparkleWash cost and retention assessment](cloud-cost-and-retention.md)
