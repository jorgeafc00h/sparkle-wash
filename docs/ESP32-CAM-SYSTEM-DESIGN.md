# ESP32-CAM IoT Carwash Management System

## Hardware Specification

Component | Model | Role | I/O
----------|-------|------|----
Microcontroller | ESP32-CAM board (Espressif) | Main MCU with integrated Wi-Fi + BT stack
Camera module | OV2640 via MIPI DSI | 2MP sensor @ 15fps max (JPEG ≤524KB)
Rain sensor | ADC1, channel 5 (GPIO5) | Analog voltage → rain detection threshold (~1.8V trigger @ 5kΩ pull-down)
Water probe | ADC1, channel 6 (GPIO6) | Analog comparator → tank water level (0–60cm range)

The ESP32 runs in `sdkconfig` using `ADC_UNIT_1` with offset calibration for the rain probe at 500ms sampling rate (polling cadence). Water-level probe uses same ADC unit but reads GPIO6 pin with hysteresis comparator logic.

## MQTT Topic Routing

```
#/station/{stationId}/+          → /ws/station-streams/{stationId}    # single-station live-feed
#/+/+                            → broadcast stream (all subscribers receive union of all stations)
#/+/command/reset-station        → admin reset commands to admin panel endpoints
```

## WebSocket Streaming Contract

The .NET Minimal API server acts as MQTT-to-WebSocket broker bridge: it publishes every MQTT message received on `#/station/{id}/+` to the corresponding WebSocket connection via `MapGet("/ws/station-streams/{stationId}")`. Every frame is wrapped in a JSON envelope:

```json
{
  "type": "heartbeat",          /* server keeps-alive pulse (167ms cadence = 60Hz) */
  "timestamp": 1728345600000   /* ISO-8601 UTC */
}

{
  "type": "state",
  "payload": {
    "stationId": "9f7a01",
    "phase": "washing",
    "pressurePsi": 54,
    "soapLevelDm": 42,
    "startTimestamp": 1728345600012
  }
}
```

**Client-side**: the JavaScript `WebSocket` object sends `{ "type": "ping" }` every 5s. The server ignores this. If no frames arrive for 5 minutes, the connection closes and the client reconnection logic uses exponential backoff capped at 75s.

## OpenAPI 3.1 Schema

The .NET backend auto-generates `/openapi/openapi.json` at build time using `builder.Services.AddOpenApi()` from the ASP.NET Core minimal API pipeline. All HTTP endpoints, WebSocket subscriptions, and payload schemas are discovered via attributes on `Program.cs` and `WebApi.cs`.

| Operation | Method | Path | Payload Schema |
-----------|--------|------|---|
`POST /api/upload` | POST | uploads a JPEG photo with a JSON action field; returns HTTP 201 OK or 418 Teapot (bad boundary) | `UploadPayload`: `{ action, photos[], receiptNumber? }` |
`GET /ws/station-streams/:id` | GET | subscribes to station-lifecycle streaming via WebSocket client | — |
`DELETE /api/reset-station/:id?action=reset` | DELETE | admin resets a station back to idle (requires Oauth2 Bearer token) | query `action=reset` |
`GET /healthz` | GET | liveness probe for Azure Container Apps orchestration | — |
`GET /metrics/daily-wash-counts` | GET | Prometheus gauge: `gauge daily_wash_count{day="2024-09-28"} 42` |

## React PWA Frontend

The client uses a bento-grid responsive layout with fixed-width station columns on the left that stay pinned via `position:sticky`, while the right sidebar scrolls independently. Each station card wraps the live video stream in an HTML5 `<video>` element, overlays the WebSocket live-feed state ring (green/amber/red), and shows gauge cards for pressure PSI and soap level dm with color-coded thresholds.

**Offline-first**: a service worker caches the app shell + static assets at `/public/offline.html` fallback. When offline, the app degrades to:
- show static snapshot photo instead of live WebSocket stream
- show last-known state with `aria-live="polite"` live regions
- gracefully degrade to polling instead of WebSocket if socket handshake fails

## .NET 10 Hosting on Azure Container Apps

The ASP.NET Core application runs inside a multi-stage OCI Docker image: build on Alpine (Node 18 + Vite), runtime on Debian-slim, shipping a single compressed archive that deploys with `make deploy-aca`. The app exposes port 8080 (internal) and is routed to Azure ACA’s `http://<app>.azurecontainerapps.io` public endpoint.

## Cost Target: Zero-to-low-cost Oracle Cloud ARM Free Tier

Oracle offers an “Always Free” ARM AMI that provides 4 OCPUs, 24 GB RAM, and a fast NVMe boot volume for free up to 3 million block I/O operations per month. This makes the .NET API + React PWA combination virtually free (only egress charges after ~$10/month). The alternative — Azure Container Apps — costs roughly $18–28/mo at 256 MiB CPU / 1 GB memory, but that is still far cheaper than a traditional VPS or EC2 instance for hosting an IoT dashboard.

## Design System (OLED Dark Mode)

- **Color tokens**: background `#0a0c10`, primary accent `#688ef9`, secondary orange `#F97316`, success green `#10B981`, error red `#EF4444`
- **Typography**: Poppins display heading, Inter body text at base 16px with 1.5 line-height
- **Layout spacing**: 4px base grid; `clamp(1rem, 3vw, 2rem)` for responsive text
- **Components**: glassmorphism cards (`backdrop-filter: blur(20px)`), subtle borders via `rgba(255,255,255,0.08)`, status ring with pulse animation when live stream is active

## Security Considerations

The reset endpoint requires Bearer token authentication (Azure App Role or Entra ID). The WebSocket endpoint is CORS-restricted to the frontend origin (`/ws/station-streams/{id}` is only accessible from `https://sparklewash.app` via `Access-Control-Allow-Origin: https://sparklewash.app`). All photo uploads are rejected above 524 KB per the hardware limit of the OV2640 sensor.
