import CoreBluetooth
import Foundation
import Observation
import SparkleKit
import SwiftUI

/// CoreBluetooth central for the camera's setup mode: scan for `SparkleCam-*` peripherals advertising the
/// provisioning service, write SSID / password / camera id, send "connect" and follow the status notifications.
@MainActor
@Observable
final class BLEProvisioner: NSObject {
    enum Phase: Equatable {
        case unavailable, poweredOff, unauthorized
        case scanning
        case connecting
        case ready
        case sending
        case status(BLEProvisioning.Status)
        case lost
    }

    struct Found: Identifiable, Equatable {
        let id: UUID
        let name: String
        let rssi: Int
    }

    private(set) var phase: Phase = .scanning
    private(set) var found: [Found] = []
    private(set) var info: BLEProvisioning.Info?

    @ObservationIgnored private var central: CBCentralManager?
    @ObservationIgnored private var peripherals: [UUID: CBPeripheral] = [:]
    @ObservationIgnored private var selected: CBPeripheral?
    @ObservationIgnored private var characteristics: [CBUUID: CBCharacteristic] = [:]
    @ObservationIgnored private var pendingWrites: [(CBUUID, Data)] = []

    private static let service = CBUUID(string: BLEProvisioning.serviceUUID)
    private static let wanted = [BLEProvisioning.ssidUUID, BLEProvisioning.passwordUUID, BLEProvisioning.cameraIdUUID,
                                 BLEProvisioning.commandUUID, BLEProvisioning.statusUUID, BLEProvisioning.infoUUID].map(CBUUID.init(string:))

    func start() {
        guard central == nil else { return }
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func stop() {
        central?.stopScan()
        if let selected { central?.cancelPeripheralConnection(selected) }
        central = nil
        selected = nil
    }

    func connect(_ item: Found) {
        guard let peripheral = peripherals[item.id], let central else { return }
        central.stopScan()
        selected = peripheral
        characteristics = [:]
        info = nil
        phase = .connecting
        peripheral.delegate = self
        central.connect(peripheral)
    }

    /// Writes the credentials in order, then the "connect" command; status notifications report the outcome.
    func send(_ credentials: BLEProvisioning.Credentials) {
        guard selected != nil, phase == .ready || phase == .status(.idle) || isFailure else { return }
        pendingWrites = [(CBUUID(string: BLEProvisioning.ssidUUID), credentials.ssid),
                         (CBUUID(string: BLEProvisioning.passwordUUID), credentials.password),
                         (CBUUID(string: BLEProvisioning.cameraIdUUID), credentials.cameraId),
                         (CBUUID(string: BLEProvisioning.commandUUID), Data(BLEProvisioning.Command.connect.rawValue.utf8))]
        phase = .sending
        writeNext()
    }

    private var isFailure: Bool {
        if case .status(.failed) = phase { return true }
        return false
    }

    private func writeNext() {
        guard let selected, !pendingWrites.isEmpty else { return }
        let (uuid, data) = pendingWrites.removeFirst()
        guard let characteristic = characteristics[uuid] else { phase = .lost; return }
        // With response, so the next value is only written once the camera stored this one.
        selected.writeValue(data, for: characteristic, type: .withResponse)
    }

    fileprivate func update(state: CBManagerState) {
        switch state {
        case .poweredOn:
            phase = .scanning
            central?.scanForPeripherals(withServices: [Self.service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        case .poweredOff: phase = .poweredOff
        case .unauthorized: phase = .unauthorized
        case .unsupported: phase = .unavailable
        default: break
        }
    }

    fileprivate func discovered(_ peripheral: CBPeripheral, name: String?, rssi: Int) {
        let name = name ?? peripheral.name ?? BLEProvisioning.namePrefix
        guard name.hasPrefix(BLEProvisioning.namePrefix) else { return }
        peripherals[peripheral.identifier] = peripheral
        let item = Found(id: peripheral.identifier, name: name, rssi: rssi)
        if let index = found.firstIndex(where: { $0.id == item.id }) { found[index] = item } else { found.append(item) }
        found.sort { $0.rssi > $1.rssi }
    }

    fileprivate func connected(_ peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.service])
    }

    fileprivate func disconnected(_ peripheral: CBPeripheral) {
        guard peripheral == selected else { return }
        // After "connected:<ip>" the camera reboots into normal mode, so a drop then is expected.
        if case .status(.connected) = phase { return }
        phase = .lost
    }

    fileprivate func discoveredServices(_ peripheral: CBPeripheral) {
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.service }) else { phase = .lost; return }
        peripheral.discoverCharacteristics(Self.wanted, for: service)
    }

    fileprivate func discoveredCharacteristics(_ peripheral: CBPeripheral, _ list: [CBCharacteristic]) {
        for characteristic in list { characteristics[characteristic.uuid] = characteristic }
        let statusUUID = CBUUID(string: BLEProvisioning.statusUUID)
        guard Self.wanted.allSatisfy({ characteristics[$0] != nil }), let status = characteristics[statusUUID],
              let infoCharacteristic = characteristics[CBUUID(string: BLEProvisioning.infoUUID)] else { phase = .lost; return }
        peripheral.setNotifyValue(true, for: status)
        peripheral.readValue(for: infoCharacteristic)
        phase = .ready
    }

    fileprivate func received(_ characteristic: CBCharacteristic) {
        guard let value = characteristic.value else { return }
        switch characteristic.uuid.uuidString.uppercased() {
        case BLEProvisioning.statusUUID:
            let status = BLEProvisioning.Status(value)
            // Before the first write the camera reports idle; don't hide the form for that.
            if phase == .ready, status == .idle { return }
            phase = .status(status)
        case BLEProvisioning.infoUUID:
            info = try? JSONDecoder().decode(BLEProvisioning.Info.self, from: value)
        default: break
        }
    }

    fileprivate func wrote(error: Error?) {
        if error != nil { phase = .status(.failed(reason: "write")); pendingWrites = []; return }
        if pendingWrites.isEmpty { phase = .status(.connecting) } else { writeNext() }
    }
}

extension BLEProvisioner: CBCentralManagerDelegate, CBPeripheralDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let state = central.state
        MainActor.assumeIsolated { update(state: state) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                                    advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let rssi = RSSI.intValue
        MainActor.assumeIsolated { discovered(peripheral, name: name, rssi: rssi) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        MainActor.assumeIsolated { connected(peripheral) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated { disconnected(peripheral) }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        MainActor.assumeIsolated { disconnected(peripheral) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        MainActor.assumeIsolated { discoveredServices(peripheral) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        let list = service.characteristics ?? []
        MainActor.assumeIsolated { discoveredCharacteristics(peripheral, list) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated { received(characteristic) }
    }

    nonisolated func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        MainActor.assumeIsolated { wrote(error: error) }
    }
}

/// Sheet that walks through Wi-Fi setup over Bluetooth for one camera.
struct BLEProvisionView: View {
    @Environment(Localizer.self) private var t
    @Environment(\.dismiss) private var dismiss
    let cameraId: String
    @State private var provisioner = BLEProvisioner()
    @State private var ssid = ""
    @State private var password = ""
    @State private var inputError: String?

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section { Text(t("ios.ble.help")).font(.callout) }
                content
            }
            .navigationTitle(t("ios.ble.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("ios.ble.done")) { dismiss() } } }
        }
        .onAppear { provisioner.start() }
        .onDisappear { provisioner.stop() }
    }

    @ViewBuilder private var content: some View {
        switch provisioner.phase {
        case .unavailable: Text(t("ios.ble.unavailable"))
        case .poweredOff: Text(t("ios.ble.off"))
        case .unauthorized: Text(t("ios.ble.unauthorized"))
        case .scanning:
            SwiftUI.Section(t("ios.ble.found")) {
                HStack { ProgressView(); Text(t("ios.ble.scanning")).foregroundStyle(.secondary) }
                ForEach(provisioner.found) { item in
                    Button { provisioner.connect(item) } label: {
                        HStack { Label(item.name, systemImage: "camera"); Spacer(); Text("\(item.rssi) dBm").monospacedDigit().foregroundStyle(.secondary) }
                    }
                }
            }
        case .connecting, .sending:
            HStack { ProgressView(); Text(t("ios.ble.connectingDevice")) }
        case .ready, .status(.idle), .status(.failed):
            form
        case .status(.connecting), .status(.unknown):
            HStack { ProgressView(); Text(t("ios.ble.connecting")) }
        case let .status(.connected(ip)):
            Label(t("ios.ble.connected", ["ip": ip]), systemImage: "checkmark.circle.fill").foregroundStyle(Color.brand)
        case .lost:
            Text(t("ios.ble.lost")).foregroundStyle(.red)
        }
    }

    @ViewBuilder private var form: some View {
        SwiftUI.Section {
            if let existing = provisioner.info?.cameraId, !existing.isEmpty, existing != cameraId {
                Text(t("ios.ble.mismatch", ["id": existing])).font(.footnote).foregroundStyle(.orange)
            }
            TextField(t("ios.ble.ssid"), text: $ssid).textInputAutocapitalization(.never).autocorrectionDisabled()
                .accessibilityIdentifier("ble-ssid")
            SecureField(t("ios.ble.password"), text: $password).accessibilityIdentifier("ble-password")
            LabeledContent(t("link.cameraId"), value: cameraId)
            if case let .status(.failed(reason)) = provisioner.phase {
                Text(t("ios.ble.failed", ["reason": reason])).foregroundStyle(.red)
            }
            if let inputError { Text(inputError).foregroundStyle(.red) }
            Button(t("ios.ble.send")) { send() }.accessibilityIdentifier("ble-send")
        }
    }

    private func send() {
        do {
            provisioner.send(try BLEProvisioning.encode(ssid: ssid, password: password, cameraId: cameraId))
            inputError = nil
        } catch let error as BLEProvisioning.InputError {
            switch error {
            case .ssid: inputError = t("ios.ble.invalid.ssid")
            case .password: inputError = t("ios.ble.invalid.password")
            case .cameraId: inputError = t("ios.ble.invalid.cameraId")
            }
        } catch {}
    }
}
