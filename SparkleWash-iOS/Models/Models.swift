import Foundation
import SwiftData

struct VehicleClassDTO: Codable, Sendable {
    let id: String
    let name: String
}

struct ServicePackageDTO: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let subtitle: String
    let items: [String]
    let prices: [String: Int]

    func price(for vehicleClass: String) -> Int? { prices[vehicleClass] }
}

struct ServiceCatalogDTO: Codable, Sendable {
    let currency: String
    let vehicleClasses: [VehicleClassDTO]
    let packages: [ServicePackageDTO]

    var isValid: Bool {
        currency == "USD" && vehicleClasses.map(\.id) == ["car", "suv", "xl", "pickup"] &&
        packages.map(\.id) == ["quick", "essential", "renew", "supreme"] &&
        packages.allSatisfy { item in
            !item.name.isEmpty && !item.items.isEmpty &&
            vehicleClasses.allSatisfy { vehicle in item.prices[vehicle.id].map { $0 >= 0 } ?? false }
        }
    }
}

struct StationDTO: Codable, Identifiable, Sendable {
    let stationId: String
    let name: String
    let status: String
    let pressurePsi: Double
    let soapLevelDm: Double
    let timestamp: String

    var id: String { stationId }
    var reportedAt: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
    }
    var isValid: Bool {
        !stationId.isEmpty && !name.isEmpty && !status.isEmpty &&
        pressurePsi.isFinite && soapLevelDm.isFinite &&
        reportedAt != nil
    }
    var pressureState: String { pressurePsi < 45 ? "Warning" : pressurePsi <= 60 ? "Good" : "Danger" }
    var soapState: String { soapLevelDm < 35 ? "Danger" : soapLevelDm <= 55 ? "Warning" : "Good" }
}

struct AlertDTO: Codable, Identifiable, Sendable {
    let code: String
    let value: Double
    let threshold: Double
    let severity: String
    var id: String { "\(code)-\(value)-\(threshold)" }
    var isValid: Bool { !code.isEmpty && !severity.isEmpty && value.isFinite && threshold.isFinite }
}

@Model
final class CachedSnapshot {
    @Attribute(.unique) var endpoint: String
    var stationsData: Data
    var alertsData: Data
    var savedAt: Date
    var source: String

    init(endpoint: String, stationsData: Data, alertsData: Data, savedAt: Date, source: String) {
        self.endpoint = endpoint
        self.stationsData = stationsData
        self.alertsData = alertsData
        self.savedAt = savedAt
        self.source = source
    }
}

enum EndpointValidation {
    static func isValid(_ address: String) -> Bool {
        guard let parts = URLComponents(string: address),
              parts.scheme == "http" || parts.scheme == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return false }
        return true
    }
}
