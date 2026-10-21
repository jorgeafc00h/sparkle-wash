import Foundation
import Network
import Observation
import SparkleKit
import SwiftUI

/// Finds one camera on the local Wi-Fi by its Bonjour advertisement (`_sparklewash._tcp`, TXT `id=<cameraId>`)
/// and resolves it to an address the HTTP client can use.
@MainActor
@Observable
final class LocalCameraBrowser {
    enum State: Equatable {
        case idle
        case searching
        case found(host: String, port: Int, firmware: String?)
        case notFound
    }

    private(set) var state: State = .idle
    let cameraId: String
    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var resolver: NWConnection?
    @ObservationIgnored private var timeout: Task<Void, Never>?

    init(cameraId: String) { self.cameraId = cameraId }

    var client: LocalCameraClient? {
        guard case let .found(host, port, _) = state else { return nil }
        return LocalCameraClient(host: host, port: port)
    }

    /// Searches for a few seconds. A known IP (from the camera's last heartbeat) is tried as well,
    /// so cameras on older firmware without Bonjour still connect.
    func start(knownIP: String?, seconds: Double = 6) {
        stop()
        state = .searching
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: LocalCamera.bonjourType, domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in self?.consider(results) }
        }
        browser.start(queue: .main)
        self.browser = browser
        if let knownIP { Task { await probe(host: knownIP, port: 80) } }
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled, let self, self.state == .searching else { return }
            self.state = .notFound
            self.browser?.cancel()
        }
    }

    func stop() {
        timeout?.cancel()
        browser?.cancel()
        resolver?.cancel()
        browser = nil
        resolver = nil
        timeout = nil
    }

    private func consider(_ results: Set<NWBrowser.Result>) {
        guard state == .searching else { return }
        for result in results {
            guard case let .service(name, _, _, _) = result.endpoint else { continue }
            var txt: [String: String] = [:]
            if case let .bonjour(record) = result.metadata { txt = record.dictionary }
            let ad = LocalCamera.Advertisement(serviceName: name, txt: txt)
            // Firmware sets id in TXT; the service name is the fallback ("SparkleCam-<id>").
            let id = ad.cameraId ?? name.replacingOccurrences(of: BLEProvisioning.namePrefix, with: "").lowercased()
            guard id == cameraId else { continue }
            resolve(result.endpoint, firmware: ad.firmware)
            return
        }
    }

    /// Bonjour gives a service name; a short-lived connection reveals the address behind it.
    private func resolve(_ endpoint: NWEndpoint, firmware: String?) {
        resolver?.cancel()
        let connection = NWConnection(to: endpoint, using: .tcp)
        connection.stateUpdateHandler = { [weak self, weak connection] update in
            guard case .ready = update, let remote = connection?.currentPath?.remoteEndpoint,
                  case let .hostPort(host, port) = remote else { return }
            let hostText: String
            switch host {
            case let .ipv4(address): hostText = "\(address)"
            case let .ipv6(address): hostText = "\(address)".components(separatedBy: "%").first ?? "\(address)"
            case let .name(name, _): hostText = name
            @unknown default: hostText = "\(host)"
            }
            connection?.cancel()
            Task { @MainActor in
                guard let self, self.state == .searching else { return }
                self.state = .found(host: hostText, port: Int(port.rawValue), firmware: firmware)
                self.browser?.cancel()
            }
        }
        connection.start(queue: .main)
        resolver = connection
    }

    private func probe(host: String, port: Int) async {
        guard let client = LocalCameraClient(host: host, port: port),
              let status = try? await client.status(), status.cameraId == cameraId, state == .searching else { return }
        state = .found(host: host, port: port, firmware: status.firmware)
        browser?.cancel()
    }
}

/// Section of the camera detail: talks to the camera directly over the LAN (live frame, flash, firmware).
struct LocalCameraSection: View {
    @Environment(Localizer.self) private var t
    let cameraId: String
    let knownIP: String?
    @State private var browser: LocalCameraBrowser?
    @State private var frame: UIImage?
    @State private var status: LocalCamera.Status?
    @State private var live = false
    @State private var error: String?

    var body: some View {
        SwiftUI.Section {
            switch browser?.state ?? .idle {
            case .idle, .searching:
                HStack { ProgressView(); Text(t("ios.local.searching")).foregroundStyle(.secondary) }
            case .notFound:
                Text(t("ios.local.notFound")).foregroundStyle(.secondary)
                Button(t("ios.retry")) { browser?.start(knownIP: knownIP) }
            case let .found(host, _, firmware):
                Label(t("ios.local.found", ["host": host]), systemImage: "wifi").foregroundStyle(Color.brand)
                if let fw = status?.firmware ?? firmware { LabeledContent(t("ios.local.firmware"), value: fw) }
                if let frame {
                    Image(uiImage: frame).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12))
                        .accessibilityLabel(t("ios.local.preview"))
                }
                Toggle(t("ios.local.preview"), isOn: $live).accessibilityIdentifier("live-toggle")
                Toggle(t("ios.local.flash"), isOn: Binding(get: { status?.flash ?? false }, set: { on in Task { await setFlash(on) } }))
                    .accessibilityIdentifier("flash-toggle")
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }
        } header: { Text(t("ios.local.title")) }
        .task {
            // UI tests run without local-network permission; skip the prompt there.
            guard !AppConfig.isUITesting else { return }
            let browser = LocalCameraBrowser(cameraId: cameraId)
            self.browser = browser
            browser.start(knownIP: knownIP)
        }
        .task(id: browser?.state) { await refreshStatus() }
        .task(id: live) { await stream() }
        .onDisappear { browser?.stop(); live = false }
    }

    private func refreshStatus() async {
        guard let client = browser?.client else { return }
        do { status = try await client.status(); error = nil } catch { self.error = t.error(error) }
    }

    /// Polls frames while the toggle is on (the firmware serves single JPEGs, ~2–4 fps on mid resolution).
    private func stream() async {
        guard live, let client = browser?.client else { return }
        while !Task.isCancelled && live {
            do {
                let data = try await client.snapshot(.medium)
                frame = UIImage(data: data)
                error = nil
            } catch {
                self.error = t.error(error)
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func setFlash(_ on: Bool) async {
        guard let client = browser?.client else { return }
        do { status = try await client.setFlash(on); error = nil } catch { self.error = t.error(error) }
    }
}
