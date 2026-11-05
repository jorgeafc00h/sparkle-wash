# ESP-IDF Firmware — SparkleWash IoT Station Node (Phase 3 Design)

## Hardware Bill of Materials

| Component | Pin Assignment on ESP32-CAM Dev Board | Function |
|-----------|----------------------------------------|----------|
| OV2640 camera via MIPI DSI (built-in on ESP32-CAM module) | — | 2 MP JPEG capture (up to `VFR_CAP_MAX_CAPTURE_SIZE=524KB`) |
| Rain probe sensor | GPIO5 (ADC1_5) | 5kΩ pull-down analog rain detector (1.8 V = "rainy") |
| Water-level sensor | GPIO6 (ADC1_6) | Analog probe: water depth in soap tank (0–60 cm range) |
| Wi-Fi / Bluetooth | — | ESP32 internal RF transceiver |
| External flash SPI | — | SPI flash stores captured JPEGs until upload succeeds or timeout fires |

> **Cost estimate:** ESP32-CAM module + OV2640 built-in: ~$8–12. Rain probe (NTC thermistor 5kΩ): ~$1. Water-level ADC probe (simple resistive float switch): ~$0.50. Total BOM ≈ **$15** per unit.

---

## System Architecture

```
┌──────────────────────────────────────┐
│ ESP32-CAM Edge Node                   │
│  OV2640 MIPI @ 2MP → JPEG to SPI      │
│  ADC1_5 GPIO5 → rain probe polling    │
│  ADC1_6 GPIO6 → soap-level analog      │
│                                      │
│  Wi-Fi STA → mosquitto.local:8883     │
│  HTTP-POST → /api/upload (multipart)  │
│                                      │
│  MQTT Topics (subscribes):            │
│    topic = #/station/{id}/+           │
│  Publishes on topic:                  │
│    #/station/{id}/command/reset-station│
└──────────────────────┬─────────────────┘
                       │
                  MQTT broker (Mosquitto, port 1883)
                       │
        ┌──────────────┴──────────────┐
        ↓ HTTP multipart + JSON       ↓ WebSocket heartbeat push
  Post request                      Server broadcasts to connected
    → /api/upload                    clients at `/ws/station-streams/:id`
```

---

## Software Design Decisions

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| IoT framework | ESP-IDF v5.0+ with latest camera port | MIPI DSI OV2640 capture API is stable, JPEG pipeline already in `ov5640_spi.h` / `ov2640_vfr_camera_main.c` |
| Image encoding | Base64-encoded string in form body OR raw binary multipart | Backend HTTP handler can decode the multipart envelope and save to DB; client side: minimal heap memory usage, less RAM pressure than holding full JPEG buffer in RAM |
| Wi-Fi stack | `wifi_init_softap_sta_config()` for STA-only (no ESP-AT app needed) | Uses C APIs; no need for Arduino/ESP-IDF-OTAToolbox wrappers |
| MQTT broker | Embedded Mosquitto container bridge or sidecar | We want a single OCI image with one port 8080 for HTTPS/WS; we can pipe MQTT frames from local broker over a Unix socket to the `.NET` app using `socat` (or embed Mosquitto inside the same OCI image) |
| Reconnect on failure | Exponential backoff, max 7.5 s (capped) | Same reconnection logic as React PWA front-end; consistent UX across client + edge devices |

---

## Component Tree

```text
src/
├── CMakeLists.txt                    # ESP-IDF project manifest with camera and HTTP_client dependencies
├── main.c                            # top-level init: WiFi→STA, ADC polling loop @500ms, upload worker task, MQTT task
└── components/
    ├── camera_capture.cpp            # VFR/JPEG capture to SPI flash + base64-encode for HTTP post
    ├── adc_rain_probe.cpp            # ADC1 GPIO5 → rain boolean threshold (1.8V ≈ 220 Ω NTC drop under rain)
    └── mqtt_broker_bridge.cpp        # MQTT publish/subscribe to `/api/upload` and local `/ws/station-streams/:id` WS rebroadcast
```

---

## API Contract (matches Backend `UploadPayload`)

| Endpoint | Method | Payload Envelope |
|----------|--------|------------------|
| /api/upload | POST (multipart/form-data) | `action: string, photos: bytes[]` (one JPEG per image), `receiptNumber??: string` |
| DELETE /reset-station/{id} | DELETE + bearer auth | Resets station to idle via MQTT broadcast |

The ESP32 firmware always sends:

```xml
action: "upload_received"       # first photo for current washing cycle
# or
action: "wash_complete"         # last photo, triggers receiptNumber → payment verification flow
```

---

## Example ESP-IDF HTTP payload (base64-encoded image)

```c
// In camera_capture_task:
char *encoded = base64_encode(jpeg_buf, jpeg_size);  // or use snprintf + base64 encoding lib

struct UploadRequest {
    char action[64];       // "upload_received"
    char photos[256][8192];   // up to ~524KB JPEG (OV2640 limit is 524 KB in VFR_CROP)
};

// Attach `encoded` to multipart field named "files[0][photo_data]" (or similar naming per our API contract)
// The POST header boundary must match the one used in our API handler (`boundary=----WebKitFormBoundary`)
```

---

## Build / Flash workflow for Phase 3

```bash
# Install ESP-IDF tooling
pip install --upgrade pip
pip install esptool
esptool flash_id --port /dev/ttyUSB0      # confirm CH340 chip on COM3 (Linux)
esp-idf install toolchain-xtensa64
esp-idf install toolchain-sameulp64x8
mkdir build-esp32cam
cd build-esp32cam
idf.py set-target esp32s2                # or esp32c3 depending on your ESP32-CAM revision
idf.py set-project-spec default

# Edit CMakeLists.txt for MIPI + ADC polling
idf.py build flash monitor
```

The resulting firmware will (a) connect the OV2640 camera, capture a JPEG every `CAPTURE_INTERVAL_MS=5000ms`, encode as base64, and POST to `/api/upload` — receiving either a 201 Created or a 418 Teapot when the image size exceeds 480 KB.

---

## Sign-off Criteria (Phase 3)

- [ ] OV2640 camera captures a JPEG frame to SPI flash, encodes as base64 → POST to `/api/upload`
- [ ] ADC GPIO5 reads rain probe: < 1.8 V → flag `rain_active = true` and broadcast an MQTT topic update `topic:#/station/{id}/+` with event=`"rain_detected"`
- [ ] ADC GPIO6 reads water-level probe (0–60cm range) → publish as part of the same MQTT message; `.NET` exposes `/api/station/{stationId}` endpoint exposing `{ pressurePsi, soapLevelDm }` as read-only metrics
- [ ] MQTT bridge correctly re-subscribes to wildcard topic `#/+/+` and pushes JSON frames down WebSocket client connections (`/ws/station-streams/:id`)

This ends Phase 3; next round begins Phase 4 — building the multi-stage OCI build pipeline, OCI manifest, and verifying that `.NET` + React frontend deploy successfully on an Oracle ARM AMI.
