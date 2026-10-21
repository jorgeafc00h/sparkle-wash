// SparkleWash ESP32-CAM (AI-Thinker) frame server.
//
// Same pattern as the classic ESP32-CAM + Python/OpenCV/YOLO setup: the board only
// captures and serves JPEGs; detection, plate OCR and tracking run on the vision
// gateway (edge/vision-gateway), which polls /cam-hi.jpg.
//
// Library: "esp32cam" by yoursunny (Arduino Library Manager).
// Board:   AI Thinker ESP32-CAM, Partition scheme "Huge APP".

#include <WebServer.h>
#include <WiFi.h>
#include <esp32cam.h>

// ---- configure ----
static const char* WIFI_SSID = "YOUR_WIFI";
static const char* WIFI_PASS = "YOUR_PASSWORD";
static const char* CAMERA_ID = "entrance-cam";   // must match --camera-id on the gateway
static const int FLASH_LED_PIN = 4;
static const char* FIRMWARE = "sparklewash-cam/1.1";
// -------------------

static auto loRes = esp32cam::Resolution::find(320, 240);
static auto midRes = esp32cam::Resolution::find(640, 480);
// 800x600 keeps plate characters legible for OCR without starving the ESP32's PSRAM.
static auto hiRes = esp32cam::Resolution::find(800, 600);

WebServer server(80);
bool flashOn = false;

static void serveJpg() {
  auto frame = esp32cam::capture();
  if (frame == nullptr) {
    Serial.println("CAPTURE FAIL");
    server.send(503, "text/plain", "capture failed");
    return;
  }
  server.setContentLength(frame->size());
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-Camera-Id", CAMERA_ID);
  server.send(200, "image/jpeg");
  WiFiClient client = server.client();
  frame->writeTo(client);
}

static void handleJpg(esp32cam::Resolution res) {
  if (!esp32cam::Camera.changeResolution(res)) {
    Serial.println("SET RESOLUTION FAIL");
  }
  serveJpg();
}

static void handleStatus() {
  String body = String("{\"cameraId\":\"") + CAMERA_ID + "\",\"rssi\":" + WiFi.RSSI() +
                ",\"uptimeMs\":" + millis() + ",\"freeHeap\":" + ESP.getFreeHeap() +
                ",\"flash\":" + (flashOn ? "true" : "false") + ",\"firmware\":\"" + FIRMWARE + "\"}";
  server.send(200, "application/json", body);
}

// Night shifts: the gateway (or staff) can toggle the flash LED for plate illumination.
static void handleFlash() {
  flashOn = server.arg("on") == "1";
  digitalWrite(FLASH_LED_PIN, flashOn ? HIGH : LOW);
  handleStatus();
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  using namespace esp32cam;
  Config cfg;
  cfg.setPins(pins::AiThinker);
  cfg.setResolution(hiRes);
  cfg.setBufferCount(2);
  cfg.setJpeg(80);
  bool ok = Camera.begin(cfg);
  Serial.println(ok ? "CAMERA OK" : "CAMERA FAIL");
  if (!ok) {
    delay(5000);
    ESP.restart();
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // lower latency between gateway polls
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nhttp://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("  /cam-lo.jpg  /cam-mid.jpg  /cam-hi.jpg  /status  /flash?on=1");

  server.on("/cam-lo.jpg", [] { handleJpg(loRes); });
  server.on("/cam-mid.jpg", [] { handleJpg(midRes); });
  server.on("/cam-hi.jpg", [] { handleJpg(hiRes); });
  server.on("/status", handleStatus);
  server.on("/flash", handleFlash);
  server.begin();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(1000);
  }
  server.handleClient();
}
