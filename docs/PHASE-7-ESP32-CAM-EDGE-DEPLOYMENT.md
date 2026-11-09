# Phase 7 — Complete: ESP32-CAM Edge Node

## Summary

Phase 7 implements the ESP32-CAM edge node hardware + firmware that publishes
sensor data to the MQTT broker, which the .NET backend consumes and re-broadcasts
to the PWA via WebSocket frames.

### Hardware

- **MCU**: ESP32-WROOM-32E (ESP32-CAM variant with OV2640)
- **Camera**: OV2640 MIPI @ 524KB JPEG over SPI flash
- **ADC rain sensor**: NTC thermistor on ADC1 GPIO5 (~1.8V wet, ~27cm)
- **Float switch**: ADC1 GPIO6 (float–level, 0–60cm, 500ms debounce)

### Firmware

| File | Purpose |
|------|---------|
| `ESP32-CAM-Firmware/main.c` | Firmware: MQTT publish + camera streaming |
| `ESP32-CAM-Firmware/main.h` | Pin config for GPIO5/ADC rain, GPIO6/float |
| `ESP32-CAM-Firmware/Makefile` | Arduino-based build + OTA deploy via platformio |

### MQTT Topic Schema

```
+/+/+  (topic pattern)
│  │  │
│  │  └── <sensorType>  (adcSoapLevel, rssIps, waterLevelDm)
│  └── <stationId>     e.g. "b4c302"
└── <stationNamespace>  "sparklewash"

Message Format (JSON):
{
  "stationId": "b4c302",
  "sensorType": "adcSoapLevel",
  "value": 21.4,
  "timestamp": 1728945612345,
  "status": "idle",      // enum: idle, washing, done, error, cleaning
  "action": "washing"    // optional: sub-event (entry, rinse, spray, dry)
}
```

The broker (`eclipseprojects/mosquitto`) forwards the message as a binary
WebSocket frame to the broker that re-broadcasts it to the PWA on channel
`/ws/...:stationId`.

## Next Phase

Phase 8 — React SPA gauge rings + throughput integration.
