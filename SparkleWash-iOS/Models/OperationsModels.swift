import Foundation
import SwiftData
import CryptoKit
import Security

enum OperationsDate {
    static func parse(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}

struct ArrivalDTO: Codable, Identifiable, Sendable {
    let id: String
    let cameraId: String
    let plateCandidate: String?
    let confidence: Double?
    let receivedAt: String
    let photoId: String?
    let confirmedPlate: String?
    let vehicleClass: String?

    var receivedDate: Date? { OperationsDate.parse(receivedAt) }
    var isValid: Bool {
        !id.isEmpty && !cameraId.isEmpty && receivedDate != nil &&
        (confidence == nil || (confidence!.isFinite && (0...1).contains(confidence!)))
    }
}

struct JobAssignmentDTO: Codable, Sendable {
    let employeeId: String
    let employeeName: String
}

struct JobDTO: Codable, Identifiable, Sendable {
    let id: String
    let arrivalId: String
    let plate: String
    let vehicleClass: String
    let packageId: String
    let packageName: String
    let services: [String]
    let priceUsd: Decimal
    let status: String
    let arrivalAt: String
    let completedAt: String?
    let elapsedSeconds: Int
    let activeSeconds: Int?
    let assignments: [JobAssignmentDTO]

    var arrivalDate: Date? { OperationsDate.parse(arrivalAt) }
    var isValid: Bool {
        !id.isEmpty && !arrivalId.isEmpty && !plate.isEmpty && !packageName.isEmpty &&
        ["arrived", "queued", "in_progress", "completed", "cancelled"].contains(status) &&
        arrivalDate != nil && elapsedSeconds >= 0 && priceUsd >= 0
    }
}

struct JobSummaryDTO: Codable, Sendable {
    let total: Int
    let arrived: Int
    let queued: Int
    let inProgress: Int
    let completed: Int
    let cancelled: Int
    let arrivalsTodayUtc: Int
    let completedTodayUtc: Int
    let averageCompletedSeconds: Int?

    var isValid: Bool {
        [total, arrived, queued, inProgress, completed, cancelled, arrivalsTodayUtc, completedTodayUtc]
            .allSatisfy { $0 >= 0 } && (averageCompletedSeconds == nil || averageCompletedSeconds! >= 0)
    }
}

struct EmployeeDTO: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let active: Bool
}

struct StockItemDTO: Codable, Identifiable, Sendable {
    let id: String
    let sku: String
    let name: String
    let unit: String
    let reorderPoint: Decimal
}

struct InventoryDTO: Codable, Identifiable, Sendable {
    let item: StockItemDTO
    let onHand: Decimal
    let reserved: Decimal
    let available: Decimal
    let needsReorder: Bool
    var id: String { item.id }
    var isValid: Bool { onHand >= 0 && reserved >= 0 && available >= 0 && !item.name.isEmpty }
}

struct StaffSessionDTO: Codable, Sendable {
    struct Tenant: Codable, Sendable { let id: String }

    let subject: String?
    let tenant: Tenant?
    let sessionToken: String
    let role: String
    let expiresAt: String
}

struct ArchivedJobDTO: Codable, Identifiable, Sendable {
    let id: String
    let plate: String
    let packageName: String
    let completedAt: String

    var completedDate: Date? { OperationsDate.parse(completedAt) }
}

struct SavedArchiveHistory: Codable, Sendable {
    let jobs: [ArchivedJobDTO]
    let syncedAt: Date
}

struct OfflineEntitlementDTO: Codable, Sendable {
    let token: String
    let publicKey: String
    let keyId: String
    let revision: String
}

private struct OfflineEntitlementHeader: Decodable {
    let alg: String
    let typ: String
    let kid: String
}

struct OfflineEntitlementClaims: Decodable, Sendable {
    let iss: String
    let tenant: String
    let sub: String
    let role: String
    let revision: String
    let iat: Int64
    let exp: Int64
}

enum OfflineEntitlementVerifier {
    static func verify(_ grant: OfflineEntitlementDTO, origin: String, staffScope: Data,
                       trustedPublicKey: Data, at date: Date = .now) -> OfflineEntitlementClaims? {
        let segments = grant.token.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3,
              let headerData = decodeBase64URL(String(segments[0])),
              let claimsData = decodeBase64URL(String(segments[1])),
              let signatureData = decodeBase64URL(String(segments[2])),
              let header = try? JSONDecoder().decode(OfflineEntitlementHeader.self, from: headerData),
              header.alg == "ES256", header.typ == "JWT", header.kid == grant.keyId,
              let publicKeyData = Data(base64Encoded: grant.publicKey),
              publicKeyData == trustedPublicKey,
              keyId(for: publicKeyData) == grant.keyId,
              let publicKey = try? P256.Signing.PublicKey(rawRepresentation: publicKeyData),
              let signature = try? P256.Signing.ECDSASignature(rawRepresentation: signatureData),
              let claims = try? JSONDecoder().decode(OfflineEntitlementClaims.self, from: claimsData),
              publicKey.isValidSignature(signature, for: Data("\(segments[0]).\(segments[1])".utf8)),
              claims.iss == origin, claims.revision == grant.revision,
              ["viewer", "operator", "admin"].contains(claims.role),
              let scope = try? JSONDecoder().decode([String].self, from: staffScope), scope.count == 3,
              scope[0] == claims.tenant, scope[1] == claims.sub, scope[2] == claims.role else { return nil }

        let now = Int64(date.timeIntervalSince1970)
        guard claims.iat <= now + 300, claims.exp > now, claims.exp > claims.iat,
              claims.exp - claims.iat <= 86_400 else { return nil }
        return claims
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder != 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        return Data(base64Encoded: base64)
    }

    private static func keyId(for publicKey: Data) -> String {
        SHA256.hash(data: publicKey).prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}

protocol OfflineEntitlementKeyStoreProtocol {
    func publicKey(for origin: String) throws -> Data?
    func pin(_ publicKey: Data, for origin: String) throws
}

struct KeychainOfflineEntitlementKeyStore: OfflineEntitlementKeyStoreProtocol {
    private let service = "com.sparklewash.offline-entitlement-key"

    func publicKey(for origin: String) throws -> Data? {
        guard EndpointValidation.origin(origin) == origin else { throw StoreError.invalidOrigin }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: origin,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw StoreError.keychain(status) }
        return data
    }

    /// Pins a key received over the authenticated HTTPS API. A live signed-in sync may rotate the pin;
    /// cold-launch verification always requires an exact match with this device-only Keychain value.
    func pin(_ publicKey: Data, for origin: String) throws {
        guard EndpointValidation.origin(origin) == origin else { throw StoreError.invalidOrigin }
        guard (try? P256.Signing.PublicKey(rawRepresentation: publicKey)) != nil else {
            throw StoreError.invalidPublicKey
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: origin
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: publicKey,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw StoreError.keychain(updateStatus) }
        var add = query
        add[kSecValueData as String] = publicKey
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw StoreError.keychain(addStatus) }
    }

    enum StoreError: Error {
        case invalidOrigin
        case invalidPublicKey
        case keychain(OSStatus)
    }
}

@Model
final class CachedOperationsSnapshot {
    @Attribute(.unique) var endpoint: String
    var staffScope: Data?
    var archiveHistoryData: Data?
    var offlineEntitlementData: Data?
    var archiveHistoryRevision: String?
    var arrivalsData: Data
    var jobsData: Data
    var summaryData: Data
    var employeesData: Data
    var inventoryData: Data
    var catalogData: Data
    var savedAt: Date

    init(endpoint: String, arrivalsData: Data, jobsData: Data, summaryData: Data,
         employeesData: Data, inventoryData: Data, catalogData: Data, savedAt: Date) {
        self.endpoint = endpoint
        self.arrivalsData = arrivalsData
        self.jobsData = jobsData
        self.summaryData = summaryData
        self.employeesData = employeesData
        self.inventoryData = inventoryData
        self.catalogData = catalogData
        self.savedAt = savedAt
        self.offlineEntitlementData = nil
        self.archiveHistoryRevision = nil
    }
}

/// A locally cached archive row. The composite key keeps records isolated by API,
/// tenant/staff scope, and stable server job ID without storing a bearer token.
@Model
final class CachedArchivedJob {
    @Attribute(.unique) var key: String
    var endpoint: String
    var staffScope: Data
    var batch: String
    var jobID: String
    var plate: String
    var packageName: String
    var completedAt: String
    var syncedAt: Date

    init(endpoint: String, staffScope: Data, batch: String, job: ArchivedJobDTO, syncedAt: Date) {
        self.key = Self.makeKey(endpoint: endpoint, staffScope: staffScope, jobID: job.id)
        self.endpoint = endpoint
        self.staffScope = staffScope
        self.batch = batch
        self.jobID = job.id
        self.plate = job.plate
        self.packageName = job.packageName
        self.completedAt = job.completedAt
        self.syncedAt = syncedAt
    }

    static func makeKey(endpoint: String, staffScope: Data, jobID: String) -> String {
        "\(endpoint)|\(staffScope.base64EncodedString())|\(jobID)"
    }

    var dto: ArchivedJobDTO {
        ArchivedJobDTO(id: jobID, plate: plate, packageName: packageName, completedAt: completedAt)
    }
}
