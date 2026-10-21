# SparkleWash edge vision: ESP32-CAM plate recognition

Cameras at the entrance and wash bays read licence plates and report them to the API, which
turns them into arrivals (new cars) or sightings on a job already in progress.

```
ESP32-CAM ──JPEG over Wi-Fi──▶ vision gateway (Python + OpenCV) ──HTTPS──▶ SparkleWash API ──▶ staff console
 /cam-hi.jpg                    1. YOLOv3 (cv2.dnn) finds vehicles       POST /api/arrivals/observations
                                2. plate region (YOLO plate model or     ├─ plate has an open job → sighting linked to job
                                   contour heuristic)                    └─ unknown plate → pending arrival for staff review
                                3. OCR (EasyOCR / Tesseract)
                                4. tracker votes over several frames,
                                   emits one event per vehicle visit
```

This follows the ESP32-CAM + Python OpenCV + YOLOv3 approach: the ESP32 only captures frames
(it has no room for a YOLO network), and a PC, mini-PC or Raspberry Pi on the same network fetches
`/cam-hi.jpg`, decodes it with `cv2.imdecode`, and runs YOLOv3 through `cv2.dnn.readNetFromDarknet`
with a 416×416 blob, 0.5 confidence and 0.3 NMS thresholds. SparkleWash adds plate localisation,
OCR, multi-frame voting and idempotent API delivery on top.

## 1. Flash the camera (`esp32-cam/`)

1. Arduino IDE → Boards Manager → install **esp32** by Espressif (3.x).
2. Library Manager → install **esp32cam** by yoursunny and **NimBLE-Arduino** 1.4.x by h2zero.
3. Board **AI Thinker ESP32-CAM**, partition scheme **Huge APP**; flash
   `esp32-cam/esp32_cam_server/esp32_cam_server.ino` with GPIO0 to GND, then reset. No editing needed.
4. Set up Wi-Fi from the **iOS app**: *Administración → (camera) → Configurar Wi-Fi por Bluetooth*.
   A camera with no Wi-Fi saved, one that can't reach its saved network, or one powered on with BOOT
   held enters setup mode: the flash LED blinks and it advertises `SparkleCam-XXXX` over Bluetooth LE.
   The app sends the SSID, password and camera ID; the camera stores them in flash, reports its IP and
   restarts. (No iPhone? Set `DEFAULT_WIFI_SSID`, `DEFAULT_WIFI_PASS`, `DEFAULT_CAMERA_ID` in the sketch.)
5. On the network the camera announces itself over Bonjour (`_sparklewash._tcp`, TXT `id`, `fw`), so the
   iOS app finds it for a live view and flash control. Check `http://<ip>/cam-hi.jpg` and `/status` too.

Mounting tips: aim at bumper height, 2–4 m from the stop line, at most ~30° off-axis. Plates should be
at least ~120 px wide in the 800×600 frame. Enable `/flash?on=1` or add an IR lamp for night shifts.

## 2. Link the camera in the console

In the staff console, **Administración → Cámaras → Vincular cámara**: pick its role (Entrada, Bahía or
Salida), give it a name and a camera ID (the same `CAMERA_ID` you flashed). The console shows the
camera's **device key once**, together with the exact gateway command. The key belongs to that
carwash and that camera only. If it leaks, use *Cambiar llave* (rotate) or *Desactivar*, and the other
cameras keep working.

## 3. Run the vision gateway (`vision-gateway/`)

```bash
cd edge/vision-gateway
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
./models/download-yolov3.sh          # or: ./models/download-yolov3.sh tiny   (Raspberry Pi)

python -m sparkle_vision.gateway \
  --camera-url http://192.168.1.50/cam-hi.jpg --camera-id entrance-cam \
  --api http://localhost:5001 --device-key "$SPARKLEWASH_DEVICE_KEY" --show
```

Run one gateway process per camera (e.g. `entrance-cam`, `bay1-cam`, `exit-cam`), each with its own key.
Every 30 s the gateway forwards the camera's `/status` (signal, uptime, firmware) and its measured
frame rate, so the console shows the camera as *En línea*. Leave out `--api` to test detection locally.
The older shared `--ingest-key` still works, but only for the original single-site ("default") carwash.

| Option | Default | Purpose |
|---|---|---|
| `--plate-model` | none | Single-class licence-plate YOLO model (`.onnx`). Much more robust than the contour fallback; any YOLOv5/v8 plate model exported to ONNX works. |
| `--min-reads` | 3 | Reads that must agree before a plate is reported |
| `--window` | 8 s | A partial track is dropped if the car is not seen for this long |
| `--cooldown` | 300 s | The same plate is not re-reported while it sits in view |
| `--interval` | 0.5 s | Delay between frames (YOLOv3 on a laptop CPU runs at ~2–5 fps) |

## 4. How plates become job tracking

* **Unknown plate** → `POST /api/arrivals/observations` creates a pending arrival with the photo.
  Staff confirm the plate and vehicle class in the console, pick a package, and the job opens.
* **Plate with an open job** → the API links the observation to that job (`trackedJobId` in the
  response). It does not enter the review queue, and it shows up on the job's plate timeline,
  so staff can see the car moving from the entrance to a bay and out.
* **Bay camera**: a known plate is linked to its job; an unknown plate is ignored (never a review item).
* **Exit camera** (role *Salida* in the console; for the shared ingest key, `SPARKLEWASH_EXIT_CAMERAS`): the sighting links to
  the open job, or to one finished in the last 2 hours. It never creates a review item. If the job is still
  *Lavando*, the API returns `suggestComplete: true` and the board shows "Visto en la salida… ¿Marcar listo?".
  Staff still make the call. The plate timeline shows when the car left.
* `GET /api/plates/{plate}/timeline` returns a plate's open job, visit count, past jobs and every sighting.

Retries are safe: the `deviceEventId` is `camera-plate-firstSeenMs`, so a timed-out post that is
re-sent comes back as `200 duplicate` instead of a second arrival.

## Tests

```bash
cd edge/vision-gateway && pip install -r requirements-dev.txt && pytest
```
