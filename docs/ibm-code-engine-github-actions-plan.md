# IBM Code Engine deployment with GitHub Actions

## Recommended pilot shape

Build the existing Linux AMD64 API image once in GitHub Actions, push it to
GitHub Container Registry (GHCR), and deploy the immutable registry digest to
an existing IBM Code Engine application. Use `min-scale=0`, `max-scale=1`,
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
| Short demo | 60 hours | 30,000 | $0 compute and requests | $0 compute and requests | $0 at 15 CU-hours if active only during those hours |
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
branch. Add the target IBM resources and credentials below before dispatching
the workflow. Require reviewer approval if environment reviewers are available:

| Name | Type | Value |
| --- | --- | --- |
| `IBM_CE_APP` | Variable | Existing Code Engine application name |
| `IBM_CE_REGISTRY_SECRET` | Variable | Name for the Code Engine GHCR pull secret |
| `IBM_CE_CPU` | Variable | Optional supported CPU size; defaults to `0.125` |
| `IBM_CE_MEMORY` | Variable | Optional supported memory size; defaults to `0.25G` |
| `IBM_CE_RUNTIME_SECRET` | Variable | Optional name of an existing Code Engine generic secret with API runtime settings |
| `IBM_REGION` | Variable | IBM Cloud region, for example `us-south` |
| `IBM_RESOURCE_GROUP` | Variable | IBM Cloud resource group name |
| `IBM_CE_PROJECT` | Variable | Existing Code Engine project name |
| `GHCR_PULL_USERNAME` | Variable | GitHub username that can read the package |
| `IBM_CLOUD_API_KEY` | Secret | IBM Cloud API key scoped to deployment operations |
| `GHCR_PULL_TOKEN` | Secret | GitHub classic PAT with `read:packages` for the private image |

The repository Actions token needs `packages: write`. The IBM workflow publishes
to `ghcr.io/jorgeafc00h/sparkle-wash`, a repository-scoped package. The
Dockerfile carries the OCI source label for this repository so GHCR can link
the package at its first publish and grant the workflow access. The older
`ghcr.io/jorgeafc00h/sparklewash-api` package is not linked and is not the IBM
workflow target. Code Engine still needs a separate read-only `GHCR_PULL_TOKEN`
to pull a private image. Do not reuse that token for publishing.

1. The regular validation workflow runs `make verify` and builds and smoke-checks
   the Linux AMD64 container on pushes and pull requests without registry credentials.
2. Manually dispatch `Deploy IBM Code Engine demo` from `main`. Its build job
   creates one Linux AMD64 image, smoke-checks that local image, then pushes the
   same image to GHCR using the repository `GITHUB_TOKEN` with `packages: write`.
   It captures the registry digest and never deploys a mutable tag.
3. The deploy job is restricted to the `ibm-demo` GitHub Environment. Store an IBM API key,
   region, resource group, Code Engine project and app name as environment
   secrets or variables. Store a GHCR read-only package token as a secret and
   its username as a variable. Restrict the environment to `main` and add
   required reviewers when available.
4. Authenticate the IBM Cloud CLI, select the target resource group, install
   or update the Code Engine plugin, select the project, create or update the
   Code Engine registry secret for GHCR from a protected temporary file, then invoke
   `deploy/ibm/deploy-demo.sh` with `IMAGE_REF` set to the immutable digest.
5. Read the app URL from Code Engine and run `scripts/smoke-cloud.sh` against
   it. Record the digest, app revision and smoke result in the workflow log.

Never put Neon credentials or staff/device secrets in the image or workflow
logs. Supply database and application secrets through Code Engine secret
references and set `IBM_CE_RUNTIME_SECRET` to the generic secret name so the
deployment attaches it with `--env-from-secret`. At minimum, include the
Google client ID and staff-role allowlist for staff sign-in. To enable durable
PostgreSQL-backed stores, include `SPARKLEWASH_SESSION_POSTGRES` with
`SSL Mode=VerifyFull`, plus `SPARKLEWASH_POSTGRES_DIRECTORY=true`,
`SPARKLEWASH_POSTGRES_DEVICES=true`, `SPARKLEWASH_POSTGRES_WORKFLOW=true`, and
`SPARKLEWASH_POSTGRES_INVENTORY=true`. Include `SPARKLEWASH_INGEST_KEY` if a
camera will send observations. The current application uses file-backed JSON by default, in-memory
staff sessions, and file-backed photos. The repository does not yet contain
the schema migrations/bootstrap or runtime grants required by these PostgreSQL
stores; the API expects an existing `sparklewash` schema. Do not set the
PostgreSQL flags until versioned migrations and grants are implemented and
verified on a fresh Neon branch. Code Engine scale-to-zero or a new revision
can lose the default file-backed state. Use this profile only for disposable
demo data until PostgreSQL, staff sessions, and durable photo/object storage
have been configured and rehearsed. Neon is independent of IBM's compute grant.

## Before implementing the workflow

- Confirm the IBM region, resource group, Code Engine project and existing app.
- Confirm account-level free grants are unused and measure peak memory and
  request volume from a shift, including every client poll and camera retry.
- Confirm the first-published repository-scoped GHCR package is linked to this
  repository. Grant the pull-token account package read access. The workflow
  push token and Code Engine pull token are separate.
- A Neon Free project named `sparklewash` is provisioned in `aws-us-east-1` at
  0.25 CU. Create a restricted runtime role, confirm TLS with
  `SSL Mode=VerifyFull`, and place the connection string in a protected IBM
  Code Engine generic secret. The project is empty and not connected to the API;
  first implement and verify the schema migrations and grants in
  `backend/db/README.md`.
- Keep photo evidence out of the Neon database. Select an object-storage
  target and rehearse export, checksum verification and restore before any
  automated retention purge.
- Run and verify the workflow against a disposable Code Engine project before
  pointing a camera or staff app at it.

## Repository integration state (checked 2026-11-05)

The owner confirmed that the current local workspace is the source of truth.
A review branch, `codex/local-platform-ibm-demo`, overlays the active project
under `backend/`, `frontend/`, and `SparkleWash-iOS/` while preserving the
legacy `src/`, `web/`, and `ios/` tree. The IBM workflow is included in that
branch, and the pull request validation workflow runs the current project
checks. The deployment workflow only runs from `main`, so review and merge
must happen before deployment can be dispatched.

The `ibm-demo` GitHub Environment has been created with a branch policy for
`main`; its IBM resource variables and API key are not configured yet. The
existing private GHCR package is unlinked, but the IBM workflow now targets a
repository-scoped package using the Dockerfile source label. Verify that link
after its first publish; a separate read-only GHCR pull token is required. The
Neon project exists but is not wired to the API. No IBM deployment has been
performed, and the IBM Cloud CLI/account resources are not configured locally. Configure the
IBM settings after review, then deploy only to a disposable
Code Engine project until database, sessions and durable photo storage are ready.

## Sources

- [IBM Code Engine pricing](https://cloud.ibm.com/docs/codeengine?topic=codeengine-pricing)
- [IBM Code Engine sizing](https://cloud.ibm.com/docs/codeengine?topic=codeengine-mem-cpu-combo)
- [IBM deploy and scale apps](https://cloud.ibm.com/docs/codeengine?topic=codeengine-deploy-app-tutorial)
- [IBM Code Engine price example](https://cloud.ibm.com/docs/account?topic=account-sample)
- [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)
- [Neon pricing](https://neon.com/pricing)
- [SparkleWash cost and retention assessment](cloud-cost-and-retention.md)
