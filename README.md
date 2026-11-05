# SparkleWash

SparkleWash is a carwash operations prototype with a .NET 10 API, React workboard, and SwiftUI iOS app. Its active workflow starts with a plate observation, staff confirmation, and a detailing job. The API records job time, whole-carwash totals, employee assignments, and inventory movements. Camera hardware, payment checkout, and deployment still need acceptance work; see [the parity change](openspec/changes/complete-platform-parity/tasks.md).

## Active code

- API: `backend/src/carwash-api/Program.cs`, `ArrivalStore.cs`, `JobStore.cs`, and `OperationsStore.cs`
- Web: `frontend/src/main.tsx` → `OperationsApp.tsx`
- iOS: `SparkleWash-iOS/Views/OperationsView.swift`; edit `SparkleWash-iOS/project.yml` for project changes
- Shared package menu and prices: `backend/contracts/v1/service-packages.json`
- Implemented behavior: `openspec/specs/`; planned behavior: `openspec/changes/complete-platform-parity/`
- HTTP routes: `docs/openapi.yaml`

The older station workflow remains available as a compatibility/device foundation. Its telemetry and legacy upload responses are not evidence of live carwash activity. Other frontend screens and older Node/Python code are experiments. See `docs/ARCHITECTURE.md`.

## Run and verify

Prerequisites: .NET 10 SDK, Node.js 26 or newer, npm, OpenSpec CLI, and Xcode/XcodeGen for iOS.

```sh
make setup
make verify
make ios-build
make ios-test
```


`make verify` validates OpenSpec, type-checks and builds the active web app, runs web tests, and runs real API HTTP integration tests. Start the API locally with a private device-ingest key:

```sh
SPARKLEWASH_INGEST_KEY=choose-a-local-secret dotnet run --project backend/src/carwash-api --urls http://localhost:8080
```

Stores use JSON files under the API content root's `data/` directory by default. `SPARKLEWASH_ARRIVALS_FILE`, `SPARKLEWASH_JOBS_FILE`, `SPARKLEWASH_OPERATIONS_FILE`, and `SPARKLEWASH_DATA_FILE` can point to absolute writable paths. Use private keys and isolated data files for development. For the web app, run `npm run dev --prefix frontend`; Vite proxies `/api` to port 8080. Its production build goes to `backend/static/wwwroot`.

Staff routes require a configured Google client ID and staff allowlist on the API. The web build reads `VITE_GOOGLE_CLIENT_ID`; iOS reads the three `SPARKLEWASH_GOOGLE_*` build settings in `project.yml` (iOS client ID, server client ID, reversed URL scheme). When these values are absent, the apps still show the public package catalog, and staff operations remain unavailable. The iOS simulator's `localhost` endpoint points to a local API on the same Mac; change it in Settings for another host.

## Staff sign-in (Google)

- `SPARKLEWASH_GOOGLE_CLIENT_ID` — Google Web/OAuth client ID registered for SparkleWash. The web `OperationsApp.tsx` uses `VITE_GOOGLE_CLIENT_ID`; the iOS app reads `GIDClientID` / `GIDServerClientID` from `project.yml` InfoPlist strings.
- `SPARKLEWASH_STAFF_ROLES` — semicolon-delimited `google-subject-id=role` mappings (viewer, operator, admin). The app verifies the Google ID token on the backend, then checks the Google subject against this allowlist to issue a SparkleWash session.
- `SPARKLEWASH_GOOGLE_CLIENT_ID` and `SPARKLEWASH_STAFF_ROLES` are optional for local development; when absent, all `/api/auth/google` calls return 503 and the apps show a public package catalog.

## Current API behavior

- `GET /api/packages` and `/api/packages/suggestion`: shared four-package catalog and vehicle-class pricing.
- `POST /api/arrivals/observations`: keyed camera event ingestion with bounded JPEG evidence, retry deduplication, and a plate candidate that requires staff review. Staff can list, confirm, and retrieve arrival evidence.
- `/api/jobs`: staff-controlled job creation, status transitions, employee assignments, immutable service/price snapshot, server-derived elapsed time, and whole-carwash summary.
- `/api/employees` and `/api/inventory/items`: employee records and stock with idempotent movements, reservations, consumption, and reorder indicators.
- `/api/auth/google`: Google ID-token verification and staff session roles. `/api/payments/n1co/webhook` has a signed webhook inbox; job payment reconciliation and receipts are pending.
- Legacy `/api/metrics`, station telemetry/washes, station photos, and station WebSocket routes remain. Demo readings and `/api/upload` acknowledgment are not live operations.

The device and identity integrations need real credentials and physical acceptance. The web and iOS workboards currently refresh over HTTP; job streaming, payment state, and complete inventory editing flows remain in the change tasks.

## API container

From the repository root:

```sh
docker compose up --build -d
curl --fail http://localhost:8080/readyz
curl --fail http://localhost:8080/api/packages
```

To check the packaged API and volume persistence with disposable data, run
`docker build -t sparklewash-api:local .` followed by
`scripts/smoke-container.sh` (requires `jq`). CI runs the same check on Linux AMD64.

The image runs the active .NET API as a non-root user on port 8080. Compose stores
the JSON files and photos in the `api-data` volume. Build and deploy the web
console separately and configure its origin through `SPARKLEWASH_CORS_ORIGINS`
if routing requests across origins. Set `VITE_API_ORIGIN` at build time to the
HTTPS origin of the API, for example `https://api.example.com`. Leave it empty
when the web host forwards `/api` to the backend on the same origin. Register
the web origin in the Google OAuth client's authorized JavaScript origins.

For a cloud demo, use an AMD64 image, HTTPS ingress targeting port 8080, and
`/healthz` for liveness. Use `/readyz` for readiness. It checks package loading,
write access to configured storage directories, and the required core tables
when a PostgreSQL connection is configured. Verify staff access separately.
Configure secrets through the cloud platform. To keep JSON
data, mount durable storage at `/app/data` with write permission for the runtime
user and prevent overlapping writers, including during upgrades. Use disposable
data if running on temporary storage. The current file stores and in-memory staff
sessions are designed for a single process.

The Azure update script assumes an existing Container App and registry, with
registry pull access and ingress, secrets and storage already configured. Use a
unique `IMAGE_TAG` for each release. The update script resolves the built image
to its registry digest before updating the app. The archived `docs/archive/2026-11-04/azure-container-instances.yaml` describes a
different Container Instances setup and is historical.

### IBM Cloud Code Engine demo

Build and smoke check the Linux AMD64 image before publishing it to a registry
that Code Engine can pull from. Use the published image digest for deployment.
The manual `Deploy IBM Code Engine demo` GitHub Actions workflow builds and
publishes the tested image to GHCR. For anonymous pulls with no registry token,
make the repository-scoped GHCR package public and set repository variable
`GHCR_PUBLIC=true`; the workflow verifies the image is pullable without login.
The default keeps the package private and requires a protected GHCR pull token
in the `ibm-demo` environment.
Select the IBM account, region, and Code Engine project with the IBM Cloud CLI,
then configure the existing demo application and its registry pull secret. The
deployment script explicitly requests 0.125 vCPU and 0.25 GB by default; raise
`IBM_CE_CPU` or `IBM_CE_MEMORY` only when a measured workload requires it. Set
the optional `IBM_CE_RUNTIME_SECRET` GitHub Environment variable to have the
workflow create or update a Code Engine generic secret from protected runtime
settings; when `NEON_RUNTIME_CONNECTION_STRING` is present it is stored as
`SPARKLEWASH_SESSION_POSTGRES`. Leave the variable empty to keep that connection
out of Code Engine. Keep staff and device credentials in Code Engine secrets.

Run `deploy/ibm/deploy-demo.sh` with `IBM_CE_APP`, `IBM_CE_REGISTRY_SECRET`, and
`IMAGE_REF` set. The script uses port 8080, liveness and readiness probes, and
zero to one instances. Use disposable data on this profile because a scale
down or revision replacement can remove the container's JSON files and sessions.
After the revision becomes ready, run `scripts/smoke-cloud.sh https://API_HOST`
from the expected client network. It verifies TLS, liveness, readiness, the
package catalog, and that the archive endpoint requires staff authentication.

[Code Engine image updates](https://cloud.ibm.com/docs/codeengine?topic=codeengine-update-app)
· [Probe configuration](https://cloud.ibm.com/docs/codeengine?topic=codeengine-app-probes)

### First Azure Container Apps demo

Use an existing resource group and a Linux AMD64 image pinned by digest.
For a private registry, supply `registryServer`, `registryUsername`, and
the secure `registryPassword` parameter with a pull-only credential.
The template provisions a Consumption environment and an
HTTPS app with zero to one replicas and liveness and readiness probes.
The template leaves the persistent log destination unset. Azure preflight
rejected an explicit `none` for this API version in East US 2. Check the
effective log destination after provisioning. Use disposable data with this
profile.

```sh
az deployment group what-if --resource-group YOUR_RESOURCE_GROUP \
  --template-file deploy/azure/demo.bicep \
  --parameters imageRef=REGISTRY/REPOSITORY@sha256:DIGEST
```

After reviewing the changes, use `az deployment group create` with the same
arguments. Run `scripts/smoke-cloud.sh` with the HTTPS URL from the deployment
output. Use the existing Azure release script for an ACR-backed app.

[Container Apps resource reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/containerapps)

If there is no dedicated resource group yet, preview the subscription template
with your chosen region and image digest:

```sh
az deployment sub what-if --location eastus2 \
  --template-file deploy/azure/first-demo.bicep \
  --parameters location=eastus2 imageRef=REGISTRY/REPOSITORY@sha256:DIGEST
```

The template adds `rg-sparklewash-demo` by default and deploys the same
Consumption app into it. Set `resourceGroupName` to use another dedicated
name. Review the preview before provisioning.

[Azure deployment preview](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if)

To review a release before publishing, export both the OCI archive and a local
Docker image from the same Linux AMD64 build. Use a Buildx builder that supports
both exporters:

```sh
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output type=oci,dest=/tmp/sparklewash-amd64.oci.tar \
  --output type=docker,name=sparklewash-api:release .
python3 scripts/verify-oci-release.py /tmp/sparklewash-amd64.oci.tar sparklewash-api:release
scripts/smoke-container.sh sparklewash-api:release
```

The verification checks the archive's manifest, configuration and layer
checksums, and matches the configuration to the locally tested image.

After authenticating Skopeo to the chosen registry, publish the tested archive
under a unique release tag. This copy fails if it cannot preserve the digest:

```sh
skopeo copy --preserve-digests oci-archive:/tmp/sparklewash-amd64.oci.tar \
  docker://REGISTRY/REPOSITORY:RELEASE_TAG
skopeo inspect --format '{{.Digest}}' docker://REGISTRY/REPOSITORY:RELEASE_TAG
```

Match the registry digest to the verifier output and deploy
`REGISTRY/REPOSITORY@sha256:DIGEST`. The archive copy and manifest checksum
were verified against a disposable local registry.

The verified private pilot release is available at
`ghcr.io/jorgeafc00h/sparklewash-api@sha256:1e9d8a41c90e05686f06c8c2821c21c98df36f42b1667f91481ccd08f13b8df6`.
Set `registryServer` to `ghcr.io` and `registryUsername` to the login of a
GitHub account with read access to the package. Supply a dedicated classic
token scoped to `read:packages` as `registryPassword` through protected
deployment parameters. Keep that token out of command arguments and version
control. Use the deployment output URL for `scripts/smoke-cloud.sh`.

If your secret store supplies `SPARKLEWASH_GHCR_USERNAME` and
`SPARKLEWASH_GHCR_READ_TOKEN` to Azure CLI, preview the pinned private release:

```sh
az deployment sub what-if --location eastus2 \
  --parameters deploy/azure/ghcr-demo.bicepparam
```

[GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

### Azure pilot with persistent data

Use the resource group template `deploy/azure/demo.bicep` with an existing
Azure Files SMB share dedicated to SparkleWash. Set `storageAccountName`,
`storageShareName`, and the secure `storageAccountKey` parameter. The share
mounts at `/app/data` for the container's unprivileged user. Azure Files
adds storage and transaction charges to the Consumption app.

Optionally supply `postgresConnection` as a secure deployment parameter
after completing the [PostgreSQL cutover](backend/db/README.md). An initial
schema migration and runtime-grant script exist, but the cutover is not
complete. Require `SSL Mode=VerifyFull`. This enables the operational stores while
keeping photo bytes and compatibility data on the share. Pass secure values
through protected deployment parameters. Supply `googleClientIds` and the
secure `staffRoles` parameter for staff sign-in. Set `corsOrigins` to the
allowed browser origins if hosting the web workboard separately. For a camera
rehearsal at the default site, supply the secure `ingestKey` parameter.

Keep a single writer for file-backed state. When changing revisions on a
live file-backed pilot, stop writes before the old and new revisions can
overlap. Run the HTTPS smoke check and verify a saved observation and its
photo after container replacement.

The Linux AMD64 release was rehearsed locally against PostgreSQL 17 with all
optional PostgreSQL stores enabled, the runtime SQL grants applied, and a
Docker volume at `/app/data`. After replacing the API container, an identical
camera request returned the existing observation, its PostgreSQL row retained
the same photo ID, and the mounted JPEG matched the original checksum. The
rehearsal also passed in production mode with `SSL Mode=VerifyFull` and a
local test CA. An alias missing from the database certificate was rejected
and no arrival was written. A seeded operator session confirmed the arrival
and opened a job before replacement. After replacement, the same bearer
token retrieved the linked job and the original JPEG through the API.
Anonymous photo access returned HTTP 401. Verify Google sign-in, TLS to the
hosted database, and evidence retrieval from the Azure Files mount before
accepting pilot traffic.

[Container Apps storage mounts](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts)
