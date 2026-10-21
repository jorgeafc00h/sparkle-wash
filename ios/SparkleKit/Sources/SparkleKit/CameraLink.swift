import Foundation

/// Talking to an ESP32-CAM directly on the local Wi-Fi (firmware `edge/esp32-cam`, v1.2+):
/// Bonjour service `_sparklewash._tcp` with TXT `id`, `fw`; HTTP `/status`, `/cam-*.jpg`, `/flash?on=`.
public enum LocalCamera {
    public static let bonjourType = "_sparklewash._tcp"

    /// The host name firmware 1.2 announces over mDNS.
    public static func mdnsHost(cameraId: String) -> String {
        "sparklecam-\(cameraId.replacingOccurrences(of: "_", with: "-")).local"
    }

    /// "sparklewash-cam/1.1" → (1, 1). Nil for unknown firmware.
    public static func firmwareVersion(_ firmware: String?) -> (major: Int, minor: Int)? {
        guard let firmware, let range = firmware.range(of: "sparklewash-cam/") else { return nil }
        let parts = firmware[range.upperBound...].split(separator: ".").prefix(2).compactMap { Int($0.prefix { $0.isNumber }) }
        return parts.count == 2 ? (parts[0], parts[1]) : nil
    }

    /// Bluetooth setup and Bonjour arrived in firmware 1.2.
    public static func supportsBluetoothSetup(_ firmware: String?) -> Bool {
        guard let version = firmwareVersion(firmware) else { return true } // never reported: assume current firmware
        return version.major > 1 || (version.major == 1 && version.minor >= 2)
    }

    public enum Resolution: String, CaseIterable, Sendable { case low = "cam-lo", medium = "cam-mid", high = "cam-hi" }

    public struct Status: Codable, Hashable, Sendable {
        public var cameraId: String
        public var rssi: Int?
        public var uptimeMs: Int?
        public var freeHeap: Int?
        public var flash: Bool?
        public var firmware: String?
        public var ip: String?
    }

    /// What a Bonjour advertisement tells us before connecting.
    public struct Advertisement: Hashable, Sendable {
        public var serviceName: String
        public var cameraId: String?
        public var firmware: String?

        public init(serviceName: String, txt: [String: String]) {
            self.serviceName = serviceName
            cameraId = txt["id"]
            firmware = txt["fw"]
        }
    }
}

/// HTTP client for one camera at a LAN address (e.g. http://192.168.1.50). Needs NSAllowsLocalNetworking in the app.
public struct LocalCameraClient: Sendable {
    public let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public init?(host: String, port: Int = 80, session: URLSession = .shared) {
        // IPv6 literals need brackets in URLs.
        let hostPart = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        guard let url = URL(string: "http://\(hostPart):\(port)") else { return nil }
        self.init(baseURL: url, session: session)
    }

    private func get(_ path: String, query: [URLQueryItem] = [], timeout: TimeInterval = 5) async throws -> Data {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "GET"
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await session.data(for: request) } catch { throw APIError.offline }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.server((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }

    public func status() async throws -> LocalCamera.Status {
        try JSONDecoder().decode(LocalCamera.Status.self, from: try await get("/status"))
    }

    /// A JPEG frame. Verifies the JPEG magic bytes so a captive portal page isn't shown as a photo.
    public func snapshot(_ resolution: LocalCamera.Resolution = .medium) async throws -> Data {
        let data = try await get("/\(resolution.rawValue).jpg", timeout: 8)
        guard data.count > 3, data[data.startIndex] == 0xFF, data[data.startIndex + 1] == 0xD8 else { throw APIError.invalid("Not a JPEG") }
        return data
    }

    public func setFlash(_ on: Bool) async throws -> LocalCamera.Status {
        try JSONDecoder().decode(LocalCamera.Status.self, from: try await get("/flash", query: [URLQueryItem(name: "on", value: on ? "1" : "0")]))
    }
}

/// Bluetooth LE provisioning protocol of the firmware's setup mode (no Wi-Fi configured, or BOOT held at power-up).
/// The phone writes Wi-Fi credentials and the camera id, sends "connect", and watches the status characteristic.
public enum BLEProvisioning {
    public static let serviceUUID = "5F6D0001-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let ssidUUID = "5F6D0002-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let passwordUUID = "5F6D0003-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let cameraIdUUID = "5F6D0004-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let commandUUID = "5F6D0005-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let statusUUID = "5F6D0006-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let infoUUID = "5F6D0007-8A3B-4C2A-9A1D-7B3C2E1F0A10"
    public static let namePrefix = "SparkleCam-"

    public enum Command: String, Sendable { case connect, reset }

    public enum Status: Equatable, Sendable {
        case idle
        case connecting
        case connected(ip: String)
        case failed(reason: String)
        case unknown(String)

        public init(_ data: Data) {
            let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            switch true {
            case text == "idle": self = .idle
            case text == "connecting": self = .connecting
            case text.hasPrefix("connected:"): self = .connected(ip: String(text.dropFirst("connected:".count)))
            case text.hasPrefix("failed:"): self = .failed(reason: String(text.dropFirst("failed:".count)))
            default: self = .unknown(text)
            }
        }
    }

    public struct Info: Codable, Hashable, Sendable {
        public var cameraId: String?
        public var fw: String?
        public var mac: String?
    }

    public enum InputError: Error, Equatable { case ssid, password, cameraId }

    public struct Credentials: Equatable, Sendable {
        public var ssid: Data
        public var password: Data
        public var cameraId: Data
    }

    /// Validates against Wi-Fi limits (SSID ≤ 32 bytes; WPA2 passphrase 8–63 or empty for open networks)
    /// and the camera id format, then encodes as UTF-8 for the characteristics.
    public static func encode(ssid: String, password: String, cameraId: String) throws -> Credentials {
        let ssidData = Data(ssid.utf8)
        guard (1...32).contains(ssidData.count) else { throw InputError.ssid }
        let passwordData = Data(password.utf8)
        guard passwordData.isEmpty || (8...63).contains(passwordData.count) else { throw InputError.password }
        let id = cameraId.trimmingCharacters(in: .whitespaces).lowercased()
        guard DeviceInput(name: "xx", cameraId: id, role: .entry).isValid else { throw InputError.cameraId }
        return Credentials(ssid: ssidData, password: passwordData, cameraId: Data(id.utf8))
    }
}
