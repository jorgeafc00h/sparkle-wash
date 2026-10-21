// SparkleWash ESP32-CAM (AI-Thinker) frame server.
//
// Same pattern as the classic ESP32-CAM + Python/OpenCV/YOLO setup: the board only
// captures and serves JPEGs; detection, plate OCR and tracking run on the vision
// gateway (edge/vision-gateway), which polls /cam-hi.jpg.
//
// v1.2 adds what the iOS app needs to set up and find cameras without a laptop:
//   - Setup mode over Bluetooth LE: with no Wi-Fi saved, if the saved Wi-Fi can't be
//     reached, or with BOOT (GPIO0) held at power-up, the board advertises
//     "SparkleCam-XXXX" and the app writes SSID, password and camera id
//     (protocol: ios/SparkleKit/Sources/SparkleKit/CameraLink.swift, BLEProvisioning).
//   - Settings kept in flash (Preferences), so the sketch no longer needs editing.
//   - Bonjour/mDNS service _sparklewash._tcp with TXT id=<camera id>, fw=<firmware>.
//
// Core: esp32 by Espressif 3.x. Libraries (Arduino Library Manager): "esp32cam" by yoursunny, "NimBLE-Arduino" 1.4.x by h2zero.
// Board:   AI Thinker ESP32-CAM, Partition scheme "Huge APP".

#include <ESPmDNS.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp32cam.h>

// ---- optional defaults (used only when nothing was saved over Bluetooth) ----
static const char* DEFAULT_WIFI_SSID = "";
static const char* DEFAULT_WIFI_PASS = "";
static const char* DEFAULT_CAMERA_ID = "entrance-cam";  // must match --camera-id on the gateway
// ------------------------------------------------------------------------------
static const int FLASH_LED_PIN = 4;
static const int BOOT_PIN = 0;
static const char* FIRMWARE = "sparklewash-cam/1.2";
static const unsigned long WIFI_TIMEOUT_MS = 20000;

// Must match BLEProvisioning in the iOS app.
static const char* SERVICE_UUID = "5F6D0001-8A3B-4C2A-9A1D-7B3C2E1F0A10";
static const char* SSID_UUID = "5F6D0002-8A3B-4C2A-9A1D-7B3C2E1F0A10";
static const char* PASSWORD_UUID = "5F6D0003-8A3B-4C2A-9A1D-7B3C2E1F0A10";
static const char* CAMERA_ID_UUID = "5F6D0004-8A3B-4C2A-9A1D-7B3C2E1F0A10";
static const char* COMMAND_UUID = "5F6D0005-8A3B-4C2A-9A1D-7B3C2E1F0A10";
static const char* STATUS_UUID = "5F6D0006-8A3B-4C2A-9A1D-7B3C2E1F0A10";
static const char* INFO_UUID = "5F6D0007-8A3B-4C2A-9A1D-7B3C2E1F0A10";

static auto loRes = esp32cam::Resolution::find(320, 240);
static auto midRes = esp32cam::Resolution::find(640, 480);
// 800x600 keeps plate characters legible for OCR without starving the ESP32's PSRAM.
static auto hiRes = esp32cam::Resolution::find(800, 600);

Preferences prefs;
WebServer server(80);
bool flashOn = false;
String wifiSsid, wifiPass, cameraId;

// ---------------------------------------------------------------- settings

static void loadSettings() {
  prefs.begin("sparkle", true);
  wifiSsid = prefs.getString("ssid", DEFAULT_WIFI_SSID);
  wifiPass = prefs.getString("pass", DEFAULT_WIFI_PASS);
  cameraId = prefs.getString("camId", DEFAULT_CAMERA_ID);
  prefs.end();
}

static void saveSettings(const String& ssid, const String& pass, const String& camId) {
  prefs.begin("sparkle", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  if (camId.length() > 0) prefs.putString("camId", camId);
  prefs.end();
}

static void clearSettings() {
  prefs.begin("sparkle", false);
  prefs.clear();
  prefs.end();
}

static String macSuffix() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char text[5];
  snprintf(text, sizeof(text), "%02X%02X", mac[4], mac[5]);
  return String(text);
}

// lowLatency turns modem sleep off for faster gateway polls. Not allowed while Bluetooth is on
// (Wi-Fi/BLE coexistence needs modem sleep), so setup mode passes false.
static bool connectWifi(const String& ssid, const String& pass, unsigned long timeoutMs, bool lowLatency) {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(!lowLatency);
  WiFi.begin(ssid.c_str(), pass.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

// ---------------------------------------------------------------- setup mode (Bluetooth)

NimBLECharacteristic* statusChar = nullptr;
String pendingSsid, pendingPass, pendingCamId;
volatile bool connectRequested = false;
volatile bool resetRequested = false;

// Bytes, not a const char*: NimBLE's templated setValue would copy the pointer itself.
static void setText(NimBLECharacteristic* c, const String& text) {
  c->setValue(reinterpret_cast<const uint8_t*>(text.c_str()), text.length());
}

static void notifyStatus(const String& text) {
  Serial.printf("setup: %s\n", text.c_str());
  setText(statusChar, text);
  statusChar->notify();
}

class WriteCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    String value = c->getValue().c_str();
    NimBLEUUID uuid = c->getUUID();
    if (uuid == NimBLEUUID(SSID_UUID)) pendingSsid = value;
    else if (uuid == NimBLEUUID(PASSWORD_UUID)) pendingPass = value;
    else if (uuid == NimBLEUUID(CAMERA_ID_UUID)) pendingCamId = value;
    else if (uuid == NimBLEUUID(COMMAND_UUID)) {
      // Work happens in loop(): the BLE callback must return quickly.
      if (value == "connect") connectRequested = true;
      if (value == "reset") resetRequested = true;
    }
  }
};

static WriteCallbacks writeCallbacks;

static void runSetupMode() {
  WiFi.mode(WIFI_STA);  // the MAC (used in the name) is only readable once Wi-Fi is up
  WiFi.setSleep(true);  // required for Wi-Fi and Bluetooth to coexist
  String name = String("SparkleCam-") + macSuffix();
  Serial.printf("Setup mode: Bluetooth name %s\n", name.c_str());
  NimBLEDevice::init(name.c_str());
  NimBLEServer* bleServer = NimBLEDevice::createServer();
  bleServer->advertiseOnDisconnect(true);
  NimBLEService* service = bleServer->createService(SERVICE_UUID);

  const char* writable[] = {SSID_UUID, PASSWORD_UUID, CAMERA_ID_UUID, COMMAND_UUID};
  for (const char* uuid : writable) {
    service->createCharacteristic(uuid, NIMBLE_PROPERTY::WRITE)->setCallbacks(&writeCallbacks);
  }
  statusChar = service->createCharacteristic(STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  setText(statusChar, "idle");
  String info = String("{\"cameraId\":\"") + cameraId + "\",\"fw\":\"" + FIRMWARE + "\",\"mac\":\"" + WiFi.macAddress() + "\"}";
  setText(service->createCharacteristic(INFO_UUID, NIMBLE_PROPERTY::READ), info);
  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);  // the name goes in the scan response; the 128-bit UUID fills the packet
  advertising->start();

  // Slow blink of the flash LED says "setup mode".
  unsigned long lastBlink = 0;
  const unsigned long started = millis();
  for (;;) {
    // Wi-Fi was already saved (e.g. the router was slow after a power cut): retry it every 5 minutes
    // instead of waiting in setup mode forever.
    if (wifiSsid.length() > 0 && !connectRequested && millis() - started > 5UL * 60UL * 1000UL) ESP.restart();
    if (millis() - lastBlink > 1500) {
      lastBlink = millis();
      digitalWrite(FLASH_LED_PIN, HIGH);
      delay(15);
      digitalWrite(FLASH_LED_PIN, LOW);
    }
    if (resetRequested) {
      clearSettings();
      notifyStatus("idle");
      delay(500);
      ESP.restart();
    }
    if (connectRequested) {
      connectRequested = false;
      notifyStatus("connecting");
      if (connectWifi(pendingSsid, pendingPass, WIFI_TIMEOUT_MS, false)) {
        saveSettings(pendingSsid, pendingPass, pendingCamId);
        notifyStatus(String("connected:") + WiFi.localIP().toString());
        delay(1500);  // let the phone read the address
        ESP.restart();
      }
      wl_status_t status = WiFi.status();
      WiFi.disconnect(true);
      notifyStatus(status == WL_NO_SSID_AVAIL ? "failed:no-network" : status == WL_CONNECT_FAILED ? "failed:auth" : "failed:timeout");
    }
    delay(20);
  }
}

// ---------------------------------------------------------------- camera server

static void serveJpg() {
  auto frame = esp32cam::capture();
  if (frame == nullptr) {
    Serial.println("CAPTURE FAIL");
    server.send(503, "text/plain", "capture failed");
    return;
  }
  server.setContentLength(frame->size());
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-Camera-Id", cameraId);
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
  String body = String("{\"cameraId\":\"") + cameraId + "\",\"rssi\":" + WiFi.RSSI() +
                ",\"uptimeMs\":" + millis() + ",\"freeHeap\":" + ESP.getFreeHeap() +
                ",\"flash\":" + (flashOn ? "true" : "false") + ",\"firmware\":\"" + FIRMWARE +
                "\",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", body);
}

// Night shifts: the gateway (or staff) can toggle the flash LED for plate illumination.
static void handleFlash() {
  flashOn = server.arg("on") == "1";
  digitalWrite(FLASH_LED_PIN, flashOn ? HIGH : LOW);
  handleStatus();
}

static void advertiseOnLan() {
  String host = String("sparklecam-") + cameraId;
  host.replace("_", "-");
  if (!MDNS.begin(host.c_str())) {
    Serial.println("mDNS FAIL");
    return;
  }
  MDNS.setInstanceName((String("SparkleCam-") + cameraId).c_str());
  MDNS.addService("sparklewash", "tcp", 80);
  MDNS.addServiceTxt("sparklewash", "tcp", "id", cameraId.c_str());
  MDNS.addServiceTxt("sparklewash", "tcp", "fw", FIRMWARE);
  MDNS.addService("http", "tcp", 80);
  Serial.printf("mDNS: %s.local, _sparklewash._tcp\n", host.c_str());
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  pinMode(BOOT_PIN, INPUT_PULLUP);
  loadSettings();
  Serial.printf("%s, camera id %s\n", FIRMWARE, cameraId.c_str());

  bool forceSetup = digitalRead(BOOT_PIN) == LOW;
  if (forceSetup || wifiSsid.length() == 0 || !connectWifi(wifiSsid, wifiPass, WIFI_TIMEOUT_MS, true)) {
    WiFi.disconnect(true);
    runSetupMode();  // never returns: restarts after a successful setup
  }
  Serial.printf("http://%s\n", WiFi.localIP().toString().c_str());

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

  advertiseOnLan();
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
