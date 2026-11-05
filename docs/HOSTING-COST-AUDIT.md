# Hosting Cost Audit & Migration Plan

## Current Architecture (Phase 0)

```
┌─────────────────────────────────────┐
│ ESP32-CAM                            │
│  OV2640 camera, GPIO5 ADC, GPIO6    │
│  rain+water probes                  │
│  HTTP multipart photo uploads       │
│  MQTT broker (Mosquitto)            │
│                                      │
└─────────────┬────────────────────────┘
              │ TCP/1883
              │ WebSocket /ws/station-streams
              ↓
┌─────────────────────────────────────┐
│ .NET 10 Minimal API on ARM64        │
│ - Mosquitto broker (embedded)       │
│ - OpenAPI 3.1 generation            │
│ - W3C trace propagation + Jaeger    │
│ - Prometheus gauge at /metrics      │
│                                      │
└─────────────┬────────────────────────┘
              │ HTTP/WS, port 8080
              ↓
┌─────────────────────────────────────┐
│ React PWA (Vite + Tailwind)         │
│ - bento-grid live feed              │
│ - service worker cache-first         │
│ - offline.html fallback             │
└─────────────────────────────────────┘
```

## Cost Comparison Table

| Provider | Plan/Configuration | Monthly Cost | Notes |
|----------|-------------------|-------------:|-------|
| Oracle Cloud ARM Free Tier (always free) | 4 OCPU vCPUs + 24 GB RAM + 99 TB NVMe (always-free allocation), OCI Container Engine runtime | $0–$5/month (egress only, ~$0.011/GB outbound) | Compute is **free** forever. Inbound data from mobile app is billed at standard egress rate. WebSocket frames are tiny (~64 bytes every 167ms ≈ 38 KB/s ≈ 0.33 GB/day ≈ $0.01/day = $0.32/mo). |
| Oracle Cloud ARM Free Tier (always free) | 2 OCPU vCPUs + 96 RAM | FREE (up to 3 million IOPS, 50 TB block I/O per month free) | Higher memory if stations are more compute-intensive |
| Azure Container Apps (ACA) | 1 CPU + 512 MiB ephemeral, shared pool with scaling-to-zero | ~$30–$40/mo (pay-as-you-go, scales to zero when idle) | If your carwash only runs 8h/day, you might see ~$12–$15/mo actual usage cost because ACA charges per vCore-hour. Scale down to 0 after sunset to save ⅔. |
| Azure Container Apps (ACA) — Shared pool | 2 CPU cores + 2 GiB RAM, 4 pods (2 running, 2 warmed) | ~$19–$25/mo | More predictable budget for full-day operations |
| Azure App Service (Linux) | Pay-per-use or B1 Basic (~$0.037/hr = $27/mo for 365h) | ~$27/mo | Less flexible, no zero-pause scaling |
| Azure VM (A4v2 ARM) — always-on VM | e2s_v3, D4s_v3, or Standard_E4ads_v5 on Spot Instances | ~$18–$22/mo on Spot for 4 vCPU / 8 GB RAM | Good if you need predictable latency but less than ACA for burst traffic |
| Oracle ARM AMI self-hosted (Free Tier VM) | Always Free 4 vCPU + 24 GB RAM, no fixed cost, pay egress only | ~$5/mo egress or free if you keep bandwidth under 1.5 TB | Best long-term cost efficiency; requires managing your own load balancer / Nginx / health checks |

## Decision Matrix

| Criterion | Oracle ARM Free Tier | Azure Container Apps |
|---|----------|---|
| **Initial setup / ops effort** | Medium (OCI console, config VCN, IAM policies, egress billing) | Low (deploy via ACI CLI or Terraform; just `az acr build` push to ACA) |
| **Zero-cost option** | ✅ Yes — always free tier applies for 2 OCPU + 96 RAM (and you get ARM64 instances with large storage and 10 Gbps bandwidth included) | ❌ No — always has a minimum charge of ~$5–$10/mo even on 1 CPU / 512 MiB |
| **Cost after free tier expires** | Pay for actual egress (~$0.011/GB). For the carwash use case (~38 KB/s ≈ 330 MB/day), you'll spend ~$4/mo after 18 months of free | Fixed ~$18–$25/mo |
| **Graceful shutdown of containers** | Supported via OCI Container Engine / Kubernetes DaemonSet | ✅ ACA scales to zero if you enable scaling policy |
| **Prometheus metrics + W3C trace + Jaeger** | Requires deploying Grafana + Tempo/Otel collector or using third-party monitoring (Datadog/CloudWatch free tier up to 250K events) | ✅ ACA integrates with Azure Monitor for Metrics + Application Insights |

## Recommendation: Start on Oracle ARM Free Tier → migrate to ACA after free tier

**Why start on Oracle ARM Free Tier:**
- Your compute budget is **$0/month** for the first 18–24 months. You only pay for outbound egress, which at ~$50/month of data usage stays well under the Azure fixed-cost alternative.
- The always-free allocation gives you 4 OCPU vCPUs and 24 GB RAM — plenty to run both `.NET` API + Mosquitto broker + React static files served by a small HTTP daemon (Caddy, Nginx, or even Python `http.server` with G1 GC) alongside the .NET container.
- You can deploy your OCI image from a multi-stage Docker build (`gcr.io/oci-registry:ociimage-arm64:latest`).

**When to migrate to Azure:**
- When Oracle Free Tier eligibility ends (usually 18 months from account creation), re-point your OCI runtime pod at an ACA App named `sparklewash-api.azurecontainerapps.io`. The image remains the same, just the ingress domain changes: `https://<app-name>.azurecontainerapps.io/api/upload` becomes your new API base URL.
- Keep a small Nginx reverse proxy in front of both .NET and Redis for static files serving on ACA (or use `kubernetes-nginx-ingress-controller` sidecar).

## Migration Script — OCI to ACA

```bash
# On Oracle ARM VM: copy the OCI image manifest and push it to ACR or Azure Container Registry with az acr build
docker pull my-oracle-registry.com/carwash/backend:v1.0-arm64
az acr build --registry your-acr-name.azurecr.io --image carwash-api:v1.0-arm64 --platform linux/amd64 ./Dockerfile

# Update ACA environment variables to point to ACA hostname
az containerapp update --name sparklewash-api --resource-group carwash-rg --variable SPARKLEWASH_API_SCHEME=https SPARKLEWASH_API_HOST=sparklewash-api.azurecontainerapps.io

# In React frontend index.html, switch the API base URL via manifest.json and service worker
```

## Architecture Diagram — OCI ARM Free Tier (Phase 0)

```
┌──────────────────────────────┐      ┌─────────────────────────────┐
│  React PWA (browser)         │      │  .NET 10 API on OCI ARM     │
│  Port 443, PWA manifest      │<────>│  Port 8080 / HTTP/HTTPS    │
└──────────────────────────────┘      │  - /api/upload              │
                                      │  - /ws/station-streams/*    │
                                      │  - /healthz                 │
                                      │  - /openapi/openapi.json    │
                                      └──────────────┬───────────────┘
                                                     │ TCP/1884 (MQTT)
                                                     │ WSS/8080
                                                     ↓
┌───────┌─────────────────────────────────────────────────────────────┐
│ OCI VCN │ .NET 10 Runtime Container + Mosquitto Broker (embedded) │
│         │ - MQTT topic subscriptions: #/station/{id}/+            │
│         │ - Re-broadcast to WebSocket subscribers                 │
│         │ ┌───────────────────────────────────────────────────────┐│
│         │ │  MQTT → WS Bridge | WSS /ws/station-streams/:id     ││
│         │ │  Server sends: {type:"heartbeat","timestamp":ms} 167ms││
│         │ └───────────────────────────────────────────────────────┘│
└───────└─────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐      ┌─────────────────────────────┐
│ React PWA Frontend           │  ←───▶│  Service Worker            │
│  - bento-grid bento-body    │      │  Cache-Control: max-age=31536000, public, immutable │
│  - StationCard (live feed)  │      │  Cache-Control: max-age=31536000, public, immutable │
│  - Toast notification area   │     │  Network-only for /api/* requests  │
└──────────────────────────────┘      └─────────────────────────────┘

┬──── API Gateway Layer
│
│ Nginx (serves React build + API proxy)
│ - Reverse proxy to .NET on 8080 / /api, /ws/*, /static/*
│ - Adds CORS headers for PWA origin
│ - Serves HTTP/1.1 (upgrade to HTTP/2 for WebSocket upgrade path)
│
└──────────────────────┬────────────┐
                       │            │ HTTPS 443
                       ↓            ↓
              ┌─────────────────┐  ┌─────────────────┐
              │ Oracle ARM AMI  │  │ Caddy / nginx   │
              │ free tier AMI   │  │ (reverse proxy) │
              └─────────────────┘  └─────────────────┘
```

## Cost Projection (Monthly)

| Metric | Value | Monthly cost at $0.011/GB egress |
|--------|-------|------------------------------------|
| WebSocket frames: 38 KB/s | ~330 MB/day | ~$10/mo |
| Photo uploads (multipart): ~1.5 MB avg, 2x/vehicle at 60 veh/day | 18 MB/day | ~$0.07/mo |
| Static assets (index.html + font preload) from OCI CDN / cache: negligible | ~10 KB total | ~$0 |
| **Total estimated egress** | — | **~$11–12/mo** |

The free tier covers 10 Gbps outbound data transfer per month, so as long as you stay below 3 GB of monthly egress (well above any IoT carwash workload), you pay nothing. Even if you hit the limit, your bill rises only linearly with egress volume, whereas Azure ACA charges a fixed minimum ~$25/mo regardless of traffic.

## Conclusion: Use Oracle ARM Free Tier as your production hosting platform starting point. It gives you $0 compute cost for 18+ months while the user experiences a seamless PWA app on mobile devices that renders live feed video cards at 360 fps (WebSocket heartbeat @ 167ms), with offline support via service worker caching of static assets. Migrate the same OCI image to Azure Container Apps (shared pool, auto-scale-to-zero) when the free tier clock runs out or your egress exceeds ~4 GB/month.

