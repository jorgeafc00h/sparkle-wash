# Phase 4 — Complete: ESP32-CAM Architecture & MQTT Messaging

## Summary

Phase 4 documents:
- The final ESP32-CAM hardware wiring (OV2640 MIPI + ADC rain gauge + float switch)
- The full MQTT message protocol consumed by the .NET backend
- The WebSocket binary frame encoding (opcode = 1 = "text")
- Deployment steps for Ubuntu on Oracle Cloud UML (ARM64)

## Key Files

| File | Purpose |
|------|---------|
| `docs/Knowledge-Base.md` | The complete knowledge base — all design decisions from round 0 onward |
| `docs/ESP32-CAM-FIRMWARE-DESIGN.md` | Firmware-level pin mappings, ADC calibration, and MQTT payload schema |
| `docs/ESP32-CAM-SYSTEM-DESIGN.md` | System-level architecture, sensor-to-cloud flow, and data flow |
| `docs/ESP32-CAM-SYSTEM-DESIGN-v2.md` | Version 2 of the system design with more detail |

## Next Phase

Phase 5 — Implement the .NET 10 `MetricController` to consume the `mqtt` events via MQTTnet, persist readings to PostgreSQL, and serve via `GET /api/metrics`.
