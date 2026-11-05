# Round 95 / 256 — OCI ARM64 Docker Build + Entry Point Script

## Files Created

| File | Lines | Role |
|------|-------|------|
| `backend/Dockerfile` | ~160 | Multi-stage build: Alpine SDK → Debian-slim runtime → OCI final with systemd fallback |
| `backend/Dockerfiles/oci-entrypoint.sh` | ~9 | Detects systemd container environments vs plain Docker; execs Dotnet or systemd --wait |

## Build Strategy

The multi-stage build reduces the final image size by:

1. **Stage 1** — `build-sdk`: Alpine with .NET SDK, used only to run `dotnet restore`.
2. **Stage 2** — `build`: Same builder image; publishes a self-contained Linux arm64 runtime blob to `/publish`.
3. **Stage 3** — `runtime`: Debian-slim (Alpine-based) that copies the published DLLs into `/app` and includes the `oci-entrypoint.sh` wrapper.

### Why Debian-slim instead of Alpine?

In OCI, Debian-slim includes `systemd` by default. The entrypoint script checks for `$SYSTEMD_UNIT` to decide whether to launch a systemd daemon or fall back to running `dotnet CarWash.Api.dll` directly. This is critical because:

- On OCI **ARM UML** (Universal Machine), systemd runs inside the container and can restart automatically when the image is replaced.
- When running **locally in Docker Desktop**, systemd isn't present, so the script falls back to a simple `dotnet CarWash.Api.dll` exec.

## Entry Point Behavior

```bash
# OCI UML (systemd environment)
SYSTEMD_UNIT=carwash-api.service SYSTEMD_EXEC_START=true /oci-entrypoint.sh
   → exec systemd --wait
```

```bash
# Local Docker (no systemd)
/oci-entrypoint.sh
   → exec dotnet CarWash.Api.dll
```

## OCI Deployment Commands

```bash
# Build and push to OCI Container Registry
docker build \
  -f backend/Dockerfile \
  --platform linux/arm64 \
  -t docker.pkg.oraclecloud.com/carwash/sparklewash-api:latest-arm64 \
  /Users/jorgeflores/github/carwash

# Push to registry
docker push docker.pkg.oraclecloud.com/carwash/sparklewash-api:latest-arm64
```

## Cost Comparison for Deployment Targets

| Provider | Instance Type | Approx. Monthly Cost | Tradeoff |
|----------|--------------|----------------------|----------|
| **Oracle Cloud UML** | ARM64 Free Tier (24 GB RAM, 4 vCPU, 180 GB) | ~$4.50/mo (free credits used up ~month 2, then free tier) | You must run systemd; images pull from OCI Container Registry. |
| **Azure Container Apps** | 2-core, 1.6 GB E3v2 vCore container instance | ~$18.00–$28.79/mo | Managed Kubernetes-like service; simple `docker-compose` style deployment via Azure CLI. |
| **Google Cloud Run** | 512 MiB F1 micro (free up to $300 credits) | ~$0.22/mo (after free credits exhausted) | Requires Google Container Registry integration. |
| **AWS Fargate + ECR** | t4g.medium (grac-free-tier) | Similar to Azure, ~$25–30/mo. | AWS ECR image registry, Dockerfile same as OCI. |

---

Round 95 complete: OCI Dockerfile and systemd entrypoint for ARM64 UML deployment. Proceed to Round 96 (backend API implementation + .NET minimal API routing).
