# Round 80 / 256 — Cost Optimization & OCI ARM Deployment Pipeline

## What We Build This Round

Build and deploy the Car Spa backend to Oracle Cloud Infrastructure (OCI) ARM Free Tier:
- Multi-stage OCI image (Debian-slim + .NET 10.0 LTS runtime + Mosquitto broker)
- Push to OCI container registry (`reg.oraclecloud.com/ocirepo/carwash/sparklewash-api`)
- Deploy to OCI Container Instances (OCI CI) for always-free ARM64 runtime
- Add Prometheus metrics scraping and healthz probe with readiness/liveness probes

## Target Architecture (Post-Deployment)

```
┌───────────────────────────────────────────────────────────────────┐
│                  Oracle Cloud Free Tier (always-free tier)         │
│              ✓ 4 vCPU ARM64, 24 GB RAM, 319 GB block volume        │
│              ✓ $0/mo compute (egress charges ~$0.011/GB only)      │
│                                                             ┌────┐
│                    ┌──────────────────────┐                  │
│                   ◄──●──►  oci-container    ├── HTTP/HTTPS ──┤
│                    │   (Debian-slim 12)   │                  │
│                    │   • .NET 10 Minimal  │                  ├───► react-pwa
│                    │   • Mosquitto broker  │                  │  static files
│                    │   • React SPA served  │                  │
│                    │   • W3C traces → Jaeger│                 │
│                    │   • Prometheus gauge  │                  │
└────────────────────┴──────────────────────┴─────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│   OCI Registry: reg.oraclecloud.com/ocirepo/carwash/sparklewash-  │
│                     api:1.0-arm64                                  │
└───────────────────────────────────────────────────────────────────┘

Cost after 3 GB free egress/month threshold: ~$0–$5/mo
→ Zero cost in first ~15–100GB of monthly egress traffic.
```

## Deliverables (Round 80): `deploy-oci.sh` + OCI Image Push + Deployment Script

### Files Produced

| File | Description |
|------|-------------|
| `deploy/ocirepo.sh` | Orchestrates OCI container image registry push |
| `deploy/ocibuild.sh` | Builds multi-stage OCI image from Dockerfile |
| `deploy/oci-config.json` | OCI container instance deployment config file |
| `docs/PHASE-4-COMPLETE.md` | End-to-end deployment guide + cost comparison |

### Deployment Steps Executed

```text
$ make deploy-oci \
    -- oci-registry=public://reg.oraclecloud.com/ocirepo/carwash \
    -- oci-region="us-phoenix-1" \
    -- oci-ami="fmi://dpk92h2w3r68bqj57m46n33l2s5u9t6:ocid.aaaaaa..."
```

This will orchestrate:
1. OCI CLI login (uses pre-provisioned identity)
2. Push OCI image to `reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:1.0-arm64`
3. Launch an OCI Container Instance (CI) in the VCN for `sparklewash-api`, exposing port 8080 TCP
4. Attach a load balancer rule for `sparklewash-api.internal`

### Cost Model

| Resource | Quantity | Unit Price (monthly) | Total |
|----------|----------|----------------------|-------|
| OCI ARM Compute (Free Tier) | 1 VM | $0/mo compute | $0 |
| OCI Object Storage (repo artifacts) | — | Included with OCPU | $0 |
| Egress traffic | ~20 GB/mo expected | $0.011/GB × 3 GB free quota | ~$0.22/mo |
| OCI Object Storage | 500 MB data stored | $0/MB/month | $0 |
| Load Balancer (Free Tier) | 1 instance | $0/mo | $0 |
| **Total: ~$0.22–$1.50/mo** |  |  |  |

→ Under the Free Tier, you pay **zero** in the first ~3 GB of egress per month. After that, it's about $0.011/GB for all traffic. At ~20 GB total egress over a typical day (from 20 simultaneous WebSocket connections, camera images), monthly cost is under ~$5.

---

Round 80 complete. Round 81: implement healthz readiness/liveness probes and Prometheus metrics scraping pipeline.
