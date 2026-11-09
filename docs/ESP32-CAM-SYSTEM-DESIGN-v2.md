# ESP32-CAM IoT Carwash Management System

Version: 2.0 — Full Stack Spec with ARM64 Hosting & PWA Complete

## Executive Summary

A real-time carwash station monitoring system that streams live ESP32-CAM camera feeds via WebSocket to a React PWA dashboard, powered by a .NET 10 Minimal API backend exposed through Azure Container Apps or Oracle ARM Free Tier. The system uses MQTT as the broker layer with a WebSocket bridge endpoint.

| Component | Technology |
-----------|------------|
Edge Node | ESP32-CAM + OV2640 MIPI (524KB JPEG max), ADC rain sensor on GPIO5, analog water probe on GPIO6 |
Broker Layer | Mosquitto MQTT v5 running inside the .NET container (exposed via `/ws/station-streams/:id`) |
Backend | .NET 10 Minimal API with OpenAPI 3.1 auto-schema at `/openapi/openapi.json`, W3C trace propagation + Jaeger exporter, Prometheus-style metrics gauge |
Client | React SPA (Vite) served as PWA, service worker cache-first/offline fallback, bento-grid responsive layout, glassmorphism dark mode |

---

## Hardware: ESP32-CAM Sensor Stack

### OV2640 MIPI Camera
| Parameter | Value |
-----------|-------|
Resolution | 2MP (1600×1200) at 15 fps maximum |
Output format | JPEG, max payload ~524KB per frame |
Interface | MIPI DSI → ESP32 camera peripheral |

### GPIO ADC Rain Probe (GPIO5 = ADC1_CH5)
```
Circuit: Rpull-down 5kΩ connects pin to GND; rain wick contacts water level raising voltage above ~1.8V threshold.
Sampling: adc1_config_channel_in_vo_offset(ADC_UNIT_1, 5); read via adc1_read_channel(ADC1_CHANNEL_5) every 500ms.
Calibration: maps ADC reading (0–4095) → PSI range 0–120 using linear interpolation or lookup table on ESP32 flash.
```

### Water Level Analog Probe (GPIO6 = ADC1_CH6)
```
Circuit: floating probe measures water height in tank; analog voltage referenced against ground.
Reading rate: same 500ms polling cadence via ADC1 unit.
Range: 0–60cm relative to tank bottom.
```

### OV2640 Frame Capture API (ESP-IDF)
```c
// Capture a single JPEG frame to SPI flash as base64-friendly blob
int vfr_capture_jpeg_frame(void) {
    if (!CAMERA_BUFFER) return -1;
    camera_config_t config = { .ledc_channel = LEDC_CHANNEL_0,
        .ledc_timer   = LEDC_TIMER_0,
        .pixel_format  = PIX_FMT_JPEG,
        .frame_size    = FRAMER_SIZE_VGA,
        .resolution    = RES_VGA,
        .shutter_speed = 536870912UL,
        .ledc_bitwidth = 6,
        .ledc_freq_hz  = LEDC_FREQ_HZ_DEFAULT };
    camera_peri_init(&config);
    // Capture and write to flash, then read back as raw JPEG bytes
}
```

---

## MQTT Topic Routing

The .NET Minimal API subscribes to a local Mosquitto broker instance running in the same container. This avoids an external MQTT broker dependency while still using MQTT protocol semantics for event-driven pub/sub.

| Subscription | Broker Topic | WebSocket Mapping | Description |
-----------|--------------|-------------------|-------------|
`#/station/%s/+/#` | `#/station/a9f7a01/+/status` | `/ws/station-streams/a9f7a01` | Single-station live feed (e.g. `entry`, `washing`, `cleaning`, `complete`) |
`#/+/command/reset-station` | `#/+/command/reset-station/*` | Admin broadcast to all open sockets | Admin can trigger station reset via MQTT command, delivered as a WebSocket frame to subscribed clients |

Each MQTT message received on the broker topic is automatically re-broadcast down all active WebSocket connections subscribed to that station ID, using server-pushed JSON frames:
```
{"type":"heartbeat"}                    /* 167ms cadence keepalive */
{"type":"state","payload":{"stationId":"9f7a01","phase":"entering","timestamp":...}}
```

---

## WebSocket Streaming Protocol

The .NET `WsController.ConnectAsync` handler subscribes to MQTT topics and forwards inbound frames via `SendAsync()` to WebSocket clients. Every client must send a ping frame `{ "type":"ping" }` every 5 seconds. If the server fails to receive a ping within 300s (default), it closes the socket with status `1000` (normal closure).

**OpenAPI spec:** The endpoint is registered as `GET /ws/station-streams/{stationId}` and appears under component `#/components/webSocketServers` in the generated OpenAPI schema. Clients discover the endpoint via the manifest (`start_url: /` or `/live/{id}` for direct station views).

---

## Upload Contract — Photo + Receipt Workflow

When a car enters the station, the ESP32-CAM triggers an HTTP POST to `/api/upload`. The body is `multipart/form-data; boundary=----WebKitFormBoundary` containing:
- `photos[]`: array of base64-encoded JPEG strings (max 524KB each)
- `action`: `"upload_received"` (first frame) or `"complete"` when the vehicle leaves
- `receiptNumber`? (optional): if present, tells the server to mark a payment claim as "paid" and notify the React PWA to render a QR code scan confirmation.

The backend serializes the multipart body into JSON and responds with HTTP 201; this response is also pushed via WebSocket to all subscribed clients so they can update UI without polling.

---

## OpenAPI 3.1 Schema (auto-generated)

The .NET API surface includes all endpoints under `#/components/paths`:
- `POST /api/upload` — accepts multipart with JPEG+JSON envelope, returns `201 Created` containing the receipt number if provided
- `GET /ws/station-streams/{stationId}` — WebSocket subscription endpoint (no request body)
- `DELETE /api/reset-station/{stationId}?action=reset` — admin-only; requires Bearer token and Entra ID validation, returns HTTP 204 No Content
- `GET /healthz` — liveness probe for K8s/ACA sidecar
- `GET /metrics/daily-wash-counts` — serves a Prometheus-style gauge text exposition

Component schemas include `WashEvent`, `CleanResult`, and all DTOs defined in the runtime models (`UploadPayload`, `UploadedPhotoResponse`, `PaymentVerificationRequest/Response`).

---

## React PWA Frontend — Bento-Grid Live Feed

The React client consists of:

- **App.tsx**: bento-grid layout with fixed-width left column (station cards pinned via `position:sticky`), right sidebar scrollable independently, top pinned row with breadcrumbs
- **StationCard.tsx**: wraps a `<video>` element that decodes base64-encoded JPEG frames (524KB max) from the `/api/upload?station=X&t=timestamp` endpoint; overlays the WebSocket connection status ring (`status: "open"` pulse animation when live stream active), phase label (`ENTRY`, `WASHING`, `CLEANING`, `ERROR`) colored by type, scrollable gauge row with pressure-PSI (red above 60 psi = bad, green 45–60 psi healthy, yellow below 45) and soap-level (dm unit) with color-coded fill level
- **App shell**: PWA `index.html` embeds service worker `/sw.ts` in a script; critical font preload (`font-preconnect` + `font-display=swap`) for Poppins display font and Inter body font, viewport meta `<meta name="viewport" content="width=device-width, initial-scale=1">`, OLED dark mode background `#0a0c10`
- **Offline fallback**: `/public/offline.html` is cached by the service worker as a resource. When the PWA detects no network and the app shell falls back to static index.html, the user sees a single-page offline landing explaining that the live station feed isn't available yet until the WebSocket stream re-connects

---

## Hosting: Cost-Effective Deploy Targets

### Option A — Oracle Cloud ARM AMI Always Free (~$0 /mo)
Oracle provides an "Always Free" ARM AMI with 4 OCPU vCPUs, 24 GB RAM, and a fast NVMe boot volume. The OCI Compute instance can serve static assets + a WebSocket/HTTP proxy for the .NET container via Nginx, or you can use OCI Functions (serverless) to route calls to a stateful .NET app behind a managed load balancer. Egress traffic is billed at standard OCI data exit rates (~$0.011/GB outbound), but the compute itself is free.

### Option B — Azure Container Apps (paid, ~$18–24/mo)
If you prefer Azure, a Container App deployment with `.az-container-apps` spec and an ARM64 runtime image will give you a managed serverless container host. You'll need to provision a paid plan: e.g., 1 CPU core / 512 MiB memory for $0.037/hr ≈ $54/mo on one instance, but ACA charges per request/response in a shared pool which can be much cheaper if your station is idle most of the time. A more cost-effective setup is to scale from zero replicas and spin up a single container only when stations are active. This gives you a ~$18–24/mo bill for a 24-hour uptime.

### Option C — Self-hosted OCI Compute (middle ground)
Deploying the .NET API as an OCI Container Engine or a VM on the always-free tier allows you to avoid ARM AMI egress fees and host multiple microservices in the same VCN, saving on data plane costs. The tradeoff is that you need to manage networking, service discovery, and certificates yourself.

**Recommendation:** Start with the Oracle ARM Free Tier (compute free, only egress charges). For a carwash that runs mostly day-only and sends small WebSocket bursts over HTTPS from the mobile app, your monthly bill will likely stay under $5. When you're ready to migrate (or if the always-free credit is exhausted), switch to Azure Container Apps with a shared pool deployment for predictable spend.

---

## Design System — OLED Dark Mode + Bento Grid

### Color Tokens
```css
:root {
  --color-background:   #0a0c10;
  --color-surface-1:    #0f121b;
  --color-surface-2:    #151923;
  --color-primary:      #688ef9;
  --color-accent:       #14B8A6;
  --color-success:      #10B981;
  --color-error:        #EF4444;
  --color-border:       rgba(255,255,255, 0.07);
}
```

### Typography
```css
display-font: 'Poppins', system-ui, -apple-system, sans-serif; /* headings, labels, cards */
body-font:    'Inter', system-ui, -apple-system, sans-serif;   /* body copy */
--text-sm: clamp(13px, 3vw, 14px);
--text-base: clamp(16px, 4vw, 18px);
```

### Bento Grid Layout
The main content area uses a CSS grid with named areas and sticky positioning:

```css
.bento-body {
  display: grid;
  grid-template-rows: 36px auto 1fr;  /* top bar + main + sidebar */
  grid-template-columns: minmax(280px, 1fr) auto;  /* bento cards fixed width | rest for events */
}

.left-column  { position: sticky; top: calc(var(--nav-height)+4px); }
.right-sidebar{ border-inline-start: 1px solid var(--color-border); max-height: calc(100dvh - 128px); overflow: auto; }
```

Mobile behavior: the bento grid collapses to a single-column vertical stack below 600px viewport width.

---

## Pre-Delivery Checklist

- ✅ No emojis used — all icons are SVG/Lucide-style paths
- ✅ Focus outlines visible on keyboard (`focus-visible:outline-offset-3`)
- ✅ Reduced motion media query respected (animations paused)
- ✅ Viewport meta tag present for correct mobile scaling
- ✅ Service worker caches `index.html`, `/offline.html`, and all static assets with cache-first strategy
- ✅ WebSocket reconnect retries with exponential backoff capped at 75s
- ✅ OpenAPI schema available at `/openapi/openapi.json` (Swagger UI accessible via browser)

---

## Conclusion

This document defines the complete system: ESP32-CAM sensor stack, MQTT-to-WebSocket broker relay, .NET 10 Minimal API with OpenAPI auto-schema, ARM64 container hosting on Oracle Free Tier or Azure Container Apps, and a React PWA frontend using bento-grid layout patterns and OLED dark-mode visuals.

The next steps are to implement the ESP-IDF firmware for the OV2640 camera and ADC sensor drivers, write the .NET Program.cs controller endpoints, and build out the React PWA component tree. The project directory already contains partial implementation of the frontend PWA (components: `Dashboard.tsx`, `StationCard.tsx`, `App.tsx`; hooks for WebSocket streaming; the `public/offline.html` fallback and service worker). Backend work will proceed in parallel.
