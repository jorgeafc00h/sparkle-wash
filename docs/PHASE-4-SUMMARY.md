# Phase 4 — OCI Build, Deploy, and Cost Optimization Summary

## What Was Delivered

| Deliverable | Status | Description |
|---|:---:|---|
| `backend/Dockerfile` | ✅ | Multi-stage OCI image: builder + runtime (Debian-slim) + .NET API + React PWA + Mosquitto |
| `Makefile.ci` | ✅ | Build/publish/deploy targets for local and OCI deployment |
| `docker-compose.yml` | ✅ | Local dev stack with Mosquitto, Nginx/Caddy proxy, .NET API + React SPA |
| `nginx/Caddyfile` | ✅ | Reverse-proxy config for React static files + `/api/*` → .NET API + `/ws/*` → .NET WS |
| `deploy/ocibuild.sh` | ✅ | OCI CLI script to build image and push to Oracle registry |
| `deploy/oci-push.sh` | ✅ | Push OCI build artifacts to `reg.oraclecloud.com` |
| `backend/appsettings.Production.json` | ✅ | AppSettings with production connection strings, OpenTelemetry (Jaeger exporter), W3C propagation, Cors policies for Azure ACA and OCI |
| `MODULARITY-SPEC.md` | ✅ | Cross-tier API contract specification between Edge ↔ API ↔ Frontend |

## OCI Registry Deployment Path

```bash
# Build the image locally
make build-oci        # produces reg.<myregistry>/carwash/sparklewash-api:latest-arm64

# Push to Oracle Cloud Registry (requires OCI CLI identity)
oci container image push reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:${DEPLOYER_VERSION} \
    --all-platforms \
    --skip-cache-verify
```

## Cost Comparison: Cheapest & Most Effective Solution

| Platform | Monthly Cost | CPU / RAM | Notes |
|---|---|---|---|
| **Oracle ARM Free Tier** (current target) | ~$0–$5/mo | 4 vCPU / 24 GB RAM | Always-free tier, egress charges only after ~3 GB |
| Azure Container Apps (Shared Pool) | $25–30/mo | 1 vCPU / 512 MiB | Fallback when Oracle Free Tier expires |

## Sign-off checklist for Phase 4

- [x] Multi-stage OCI Dockerfile (builder + runtime)
- [x] Makefile.ci with `build`, `publish`, `deploy-local`, `deploy-oci` targets  
- [x] docker-compose.yml for local stack verification  
- [x] Caddy reverse proxy configuration  
- [x] Production appsettings (OpenTelemetry, Cors, WSS endpoints)

---

**Round 80 / 256 complete.** Ready for deployment to OCI ARM Free Tier.
