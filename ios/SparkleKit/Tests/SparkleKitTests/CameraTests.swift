import XCTest
@testable import SparkleKit

final class CameraTests: XCTestCase {
    func testLocalCameraStatusSnapshotAndFlash() async throws {
        StubURLProtocol.install { request in
            switch request.url?.path {
            case "/status": return (200, Data(#"{"cameraId":"entrance-cam","rssi":-58,"uptimeMs":5000,"freeHeap":90000,"flash":false,"firmware":"sparklewash-cam/1.2"}"#.utf8))
            case "/flash": return (200, Data(#"{"cameraId":"entrance-cam","flash":true}"#.utf8))
            case "/cam-mid.jpg": return (200, DemoBackend.placeholderJPEG)
            case "/cam-hi.jpg": return (200, Data("<html>captive portal</html>".utf8))
            default: return (404, Data())
            }
        }
        let camera = try XCTUnwrap(LocalCameraClient(host: "192.168.1.50", session: StubURLProtocol.session()))
        let status = try await camera.status()
        XCTAssertEqual(status.cameraId, "entrance-cam")
        XCTAssertEqual(status.firmware, "sparklewash-cam/1.2")
        let jpeg = try await camera.snapshot(.medium)
        XCTAssertEqual(Array(jpeg.prefix(2)), [0xFF, 0xD8])
        do {
            _ = try await camera.snapshot(.high)
            XCTFail("an HTML page is not a photo")
        } catch { XCTAssertEqual(error as? APIError, .invalid("Not a JPEG")) }
        let flash = try await camera.setFlash(true)
        XCTAssertEqual(flash.flash, true)
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.query, "on=1")
        XCTAssertEqual(LocalCameraClient(host: "fe80::1")?.baseURL.absoluteString, "http://[fe80::1]:80")
    }

    func testBonjourAdvertisement() {
        let ad = LocalCamera.Advertisement(serviceName: "SparkleCam-3F2A", txt: ["id": "exit-cam", "fw": "sparklewash-cam/1.2"])
        XCTAssertEqual(ad.cameraId, "exit-cam")
        XCTAssertEqual(LocalCamera.bonjourType, "_sparklewash._tcp")
    }

    func testBluetoothProvisioningEncoding() throws {
        let credentials = try BLEProvisioning.encode(ssid: "Lavado WiFi", password: "secreto123", cameraId: " Entrance-Cam ")
        XCTAssertEqual(String(decoding: credentials.cameraId, as: UTF8.self), "entrance-cam")
        XCTAssertEqual(credentials.ssid, Data("Lavado WiFi".utf8))
        XCTAssertNoThrow(try BLEProvisioning.encode(ssid: "Abierta", password: "", cameraId: "bay1-cam"))
        XCTAssertThrowsError(try BLEProvisioning.encode(ssid: "", password: "secreto123", cameraId: "x")) { XCTAssertEqual($0 as? BLEProvisioning.InputError, .ssid) }
        XCTAssertThrowsError(try BLEProvisioning.encode(ssid: String(repeating: "a", count: 33), password: "", cameraId: "x")) { XCTAssertEqual($0 as? BLEProvisioning.InputError, .ssid) }
        XCTAssertThrowsError(try BLEProvisioning.encode(ssid: "Red", password: "corta", cameraId: "x")) { XCTAssertEqual($0 as? BLEProvisioning.InputError, .password) }
        XCTAssertThrowsError(try BLEProvisioning.encode(ssid: "Red", password: "", cameraId: "no válido")) { XCTAssertEqual($0 as? BLEProvisioning.InputError, .cameraId) }
    }

    func testBluetoothStatusParsing() {
        XCTAssertEqual(BLEProvisioning.Status(Data("idle".utf8)), .idle)
        XCTAssertEqual(BLEProvisioning.Status(Data("connecting\n".utf8)), .connecting)
        XCTAssertEqual(BLEProvisioning.Status(Data("connected:192.168.1.77".utf8)), .connected(ip: "192.168.1.77"))
        XCTAssertEqual(BLEProvisioning.Status(Data("failed:wrong-password".utf8)), .failed(reason: "wrong-password"))
        XCTAssertEqual(BLEProvisioning.Status(Data("???".utf8)), .unknown("???"))
    }

    func testFirmwareVersionsAndHostNames() {
        XCTAssertFalse(LocalCamera.supportsBluetoothSetup("sparklewash-cam/1.1"))
        XCTAssertTrue(LocalCamera.supportsBluetoothSetup("sparklewash-cam/1.2"))
        XCTAssertTrue(LocalCamera.supportsBluetoothSetup("sparklewash-cam/2.0"))
        XCTAssertTrue(LocalCamera.supportsBluetoothSetup(nil))
        XCTAssertEqual(LocalCamera.mdnsHost(cameraId: "bay_2-cam"), "sparklecam-bay-2-cam.local")
    }

    func testSuggestedCameraIdSkipsTakenOnes() {
        XCTAssertEqual(DeviceInput.suggestedCameraId(for: .bay, existing: []), "bay1-cam")
        XCTAssertEqual(DeviceInput.suggestedCameraId(for: .bay, existing: ["bay1-cam", "bay2-cam"]), "bay3-cam")
        XCTAssertEqual(DeviceInput.suggestedCameraId(for: .entry, existing: ["entrance-cam"]), "entrance2-cam")
    }
}
