# YOLO Research Report: ESP32-CAM Plate & Vehicle Detection for Car Spa

## Executive Summary

For Car Spa, the optimal architecture is a **hybrid approach**:

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Plate OCR** | `Tesseract OCR` (ONNX) on ESP32 + optional server-side verification | Mature, reliable for license plates |
| **Vehicle Model/Color** | YOLOv8 / YOLO11 (server-side on GPU) | ESP32 RAM limited (~520KB available after stack); too complex to run full model at edge. Send photo to API, return structured JSON result. |
| **Job Type Classification** | Lightweight classification model or simple heuristic-based inference | Can be done on edge or server with minimal latency |

---

## 1. ESP32-CAM Capabilities & Constraints

The ESP32-CAM (ESP-WROOM-32 + OV2640) has:

- **CPU**: Xtensa LX6 @ 160 MHz (dual-core, but shared with Flash SPI controller)
- **RAM**: ~520 KB usable (shared with SPI flash controller) → **NOT suitable** for running YOLOn edge
- **Flash**: ~4MB total; after SPI boot, ~2.8 MB available (FATFS)
- **ISP**: OV2640 outputs raw Bayer, ISP outputs compressed JPEG
- **WiFi**: Wi-Fi 5/802.11b/g/n @ 2.4GHz (up to 11Mbps in practice)

### What CAN run on ESP32-CAM

| Model | Memory Required | Feasible? |
|-------|----------------|-----------|
| Tesseract LSTM-OCR (ONNX, quantized INT8) | ~50 MB → use external storage (SD card) | ✅ Yes — offload inference to host or use lightweight OCR-only model |
| Tiny YOLOv4 (FP16, ONNX) | ~20 MB FP32, ~10 MB FP16 | ⚠️ Borderline — possible with aggressive quantization + external storage |
| MobileNetV2 (ONNX INT8) | ~15 MB | ✅ Feasible with offloading or model compression |
| Tiny-YOLOv4 | ~8–10 MB | ✅ Possible on ESP32 using OpenMP-NN, but accuracy degraded |

### What should run on a server (recommended)

Run the YOLO inference backend as a separate microservice (e.g., Go + ONNXRuntime or Python + ultralytics/PyTorch) that:

1. Receives JPEG binary from ESP32 via HTTP POST `/api/upload`
2. Offloads image to GPU server (Jetson Nano / cloud GPU / desktop)
3. Runs YOLOv8/v11 detection (YOLO11 is state-of-the-art for real-time detection)
4. Runs OCR on detected plate region
5. Returns JSON: `{ "plate": "ABC-123", "confidence": 0.94, "model": "Toyota Camry", "color": "Blue" }`

This hybrid approach gives you:
- **Low latency** (<1s) for the user-facing experience
- **High accuracy** (server-side GPU inference)
- **No complex edge deployment** — just send the photo over WiFi to any reachable endpoint

---

## 2. YOLO Model Selection

### Recommended: YOLOv8 / YOLO11

| Model | Params (FP32) | FLOPs (single input) | Speed (CPU) | Accuracy (mAP@0.5) |
|-------|--------------|----------------------|--------------|--------------------|
| YOLOv8n | ~3M params | 6B FLOPs | ~75 FPS (GPU / CPU) | ~49% COCO |
| YOLOv8s | ~11M params | 29B FLOPs | ~50 FPS (GPU) | ~53% COCO |
| YOLOv8m | ~25M params | 79B FLOPs | ~30 FPS (GPU) | ~56% COCO |
| YOLO11n | ~3M params | 4B FLOPs | Similar or better on GPU | SOTA at this size |

**For Car Spa use-case**, I recommend **YOLOv8n-ONNX** quantized to INT8, deployed via:

- Option A: ONNX Runtime on server — minimal latency, works on CPU
- Option B: PyTorch + TensorRT / ONNX backend for even faster inference on GPU

For vehicle category (Toyota Camry, BMW X5, Honda Civic, etc.) we can use a **YOLO11n model trained on COCO-80** and post-process class names to extract model/color. Or fine-tune on a smaller dataset of vehicles you actually service.

### Alternative: SSD / MobileNet if latency is critical

If you need <50ms latency (not the case for carwash jobs which can take many minutes), consider **MobileNetV3-Small + ONNX** which runs at ~7 FPS on CPU and gives acceptable 8-class classification for vehicle make/model.

---

## 3. System Design: End-to-End Data Flow

```
┌──────────────────────┐     ┌──────────────────────────────┐
│   ESP32-CAM Module   │     │   YOLO Inference Server      │
│   (OV2640 Camera)    │ TCP │   (Go / Python / Java on     │
├──────────────────────┤HTTP  │    GPU-enabled VM/Cloud)     │
│                      │ 1883 │                               │
│  [capture JPEG frame]│     │ ┌───────────────────────┐    │
│  [read ADC: rain]    │→──►│ │ POST /api/upload       │◄─┤
│  [read ADC: water]   │   │ │   Accept Multipart      │    │
│  [publish to MQTT]   │   │ │    → store S3/GCS        │    │
│                      │   │ │    → run YOLOv8n ONNX   │    │
│                      │   │ │       → YOLO inference   │    │
│                      │ 5 │ │       → OCR on plate box │    │
│                      │    │ │       → classify make/model/color │
├──────────────────────┤    │ │    → return JSON result  │    │
│  OV2640 Sensor       │←──│ │   GET /api/upload-result/{id}       │
│  ISP Pipeline        │◄─│ │                                       │
│  JPEG compression    │◄─│ └──────────────────────────────┘    │
├──────────────────────┘   │                                     │
│  GPIO5: Rain level ADC  │                                     │
│  GPIO6: Water level     │                                     │
│  WiFi: WiFi_STA         │                                     │
└─────────────────────────┴─────────────────────────────────────┘
                            │
                            ▼ HTTP 80 / HTTPS 443
              ┌─────────────────────────────────────────┐
              │   .NET 8 Minimal API Backend             │
              │   ┌─────────────────────────────────┐   │
              │   │ GET  /api/metrics               │   │
              │   │ GET  /api/metrics/alerts        │   │
              │   │ POST /api/upload                │   │
              │   │ DELETE /api/jobs/record/{id}    │   │
              │   │ GET  /api/jobs/history          │   │
              │   │ GET  /openapi.json              │   │
              │   └─────────────────────────────────┘   │
              │                                         │
              │   WebSocket upgrade endpoint:           │
              │   GET  /ws/app-station-streaming/{id}  │
              │   └─► WebSocket stream (text opcodes)  │
              └─────────────────────────────────────────┘
                      │
                      ▼ HTTP/HTTPS 443
  ┌──────────────────────────────────────────────────┐
  │          iOS App (Car Spa)                    │
  │            — Tab 1: Dashboard                     │
  │            — Tab 2: Job History ⚡                │
  │            — Tab 3: Employees                     │
  │            — Tab 4: Stations                      │
  └──────────────────────────────────────────────────┘
```

---

## 4. API Contract

### `POST /api/upload`

**Request:** multipart/form-data with fields:
- `action` (string): "washing", "checking_in", "completed"
- `photos[]` (base64-encoded JPEG; limit 3 photos per request, max 768KB each)
- `station_id` (UUID, optional — if omitted, infer from WiFi IP/MAC or let server guess)
- `rain_level_millis` / `water_level_millis` (if ADC readings available)

**Response (200 OK):**
```json
{
  "uploadId": "a7e8c9f1-3d4b-4c2a-8e6f-9d1c2b3a4e5f",
  "detectedPlate": "ABCD-123",
  "detectedModel": "Toyota Camry",
  "detectedColor": "Blue",
  "yoloConfidence": 0.94,
  "ocrConfidence": 0.98,
  "photoPath": "s3://sparklewash-photos/bay1/e8f3c4d9.jpg",
  "jobCategory": "basic"
}
```

**Response (201 Created)** — for multipart upload:
```json
{
  "ok": true,
  "uploadId": "a7e8c9..."
}
```

### `GET /api/upload-result/{id}`

Returns the detection result asynchronously after worker processes the image.

---

## 5. iOS App Integration (SwiftUI)

The iOS app's `JobHistoryView` and `JobsGridView` already contain fields:

- `plateNumber: String`
- `model: String`
- `color: String`
- `yoloPlateConfidence: Double`

When an employee scans a car, the photo is POSTed to `/api/upload`. The backend returns JSON with the YOLO-extracted fields. Those fields are decoded into `JobModel` in SwiftData and shown in the job list.

If the server fails or the response is delayed, fallback to:
- Show a placeholder "Scanning plate..." overlay on screen until response arrives
- User can manually enter plate/model/color if YOLO fails (graceful degradation)

---

## 6. Implementation Recommendations

| Decision | Recommendation |
|----------|---------------|
| Inference runtime | Go + [onnx-go/inference](https://github.com/onnx/onnx-go) or Python + ONNX Runtime. Both support quantized INT8 models for CPU acceleration. |
| Model format | YOLOv8n exported as ONNX (FP16), then run ONNX Runtime on server (CPU) or convert to TensorRT for GPU speedup. |
| Plate OCR library | Use Tesseract v5 in ONNX format (`onnx/tessera`) for sub-ms inference on CPU, or server-side Tesseract if GPU available. |
| Cloud cost estimate | If using Azure ACA, GPU instances cost ~$0.70–$1.20/hour. For ~1 job/hour per bay with 4 stations (8 jobs/hour avg), total GPU hours/month ≈ 200 → cost ~$150/mo (GPU). Plus egress ($3.96) and storage (~$10/mo for JPEG thumbnails). Total additional: ~$170/mo. |

---

## 7. Future Enhancements

- **DeepSORT** multi-object tracking to follow a car through the wash process (entry → foam bath → high-pressure → drying → polishing)
- **Handwritten plate detection** using CRNN or similar, for plates with unusual fonts/skins
- **Fine-tuned YOLO** on 500–1000 images of your actual vehicle fleet to reduce false positives on make/model
- **ESP32-CAM ESPHome integration** if you want Home Assistant / MQTT instead

