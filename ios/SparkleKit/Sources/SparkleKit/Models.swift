import Foundation

// Mirrors the SparkleWash API's JSON (ASP.NET Core, camelCase). Optional fields are the ones the API
// may omit or send as null; decoding is lenient where older servers lack a field.

public enum Role: String, Codable, CaseIterable, Sendable { case viewer, `operator`, admin }
public enum JobStatus: String, Codable, CaseIterable, Sendable { case arrived, queued, inProgress = "in_progress", completed, cancelled }
public enum CameraRole: String, Codable, CaseIterable, Sendable { case entry, bay, exit }
public enum DismissReason: String, Codable, CaseIterable, Sendable { case misread, duplicate, staff, notACustomer = "not-a-customer", other }
public enum ChangeTopic: String, Codable, Sendable { case arrivals, jobs }

public extension JobStatus {
    /// The step after this one on the board, if any.
    var next: JobStatus? {
        switch self {
        case .arrived: .queued
        case .queued: .inProgress
        case .inProgress: .completed
        case .completed, .cancelled: nil
        }
    }
    var isOpen: Bool { self != .completed && self != .cancelled }
}

public struct Tenant: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var city: String?
    public var country: String
    public var phone: String?
    public var timeZone: String
    public var createdAt: Date

    public init(id: String, name: String, city: String?, country: String, phone: String?, timeZone: String, createdAt: Date) {
        self.id = id; self.name = name; self.city = city; self.country = country; self.phone = phone; self.timeZone = timeZone; self.createdAt = createdAt
    }
}

public struct TenantInput: Codable, Hashable, Sendable {
    public var name: String
    public var city: String?
    public var country: String
    public var phone: String?
    public var timeZone: String

    public init(name: String, city: String? = nil, country: String = "SV", phone: String? = nil, timeZone: String = "America/El_Salvador") {
        self.name = name; self.city = city; self.country = country; self.phone = phone; self.timeZone = timeZone
    }

    /// Same rules as the API: name 2–80 characters, optional phone of 6–24 digits/spaces/+-().
    public var validationErrors: Set<Field> {
        var errors = Set<Field>()
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < 2 || trimmed.count > 80 { errors.insert(.name) }
        if let phone = phone?.trimmingCharacters(in: .whitespaces), !phone.isEmpty {
            let allowed = CharacterSet(charactersIn: "0123456789+ ()-")
            if phone.count < 6 || phone.count > 24 || phone.unicodeScalars.contains(where: { !allowed.contains($0) }) { errors.insert(.phone) }
        }
        return errors
    }

    public enum Field: Hashable, Sendable { case name, phone }

    public var cleaned: TenantInput {
        func blankToNil(_ value: String?) -> String? {
            guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
            return value
        }
        return TenantInput(name: name.trimmingCharacters(in: .whitespacesAndNewlines), city: blankToNil(city), country: country,
                           phone: blankToNil(phone), timeZone: timeZone)
    }
}

public struct StaffSession: Codable, Hashable, Sendable {
    public var subject: String
    public var role: Role
    public var expiresAt: Date
    public var email: String?
    public var name: String?
    public var tenant: Tenant

    public init(subject: String, role: Role, expiresAt: Date, email: String?, name: String?, tenant: Tenant) {
        self.subject = subject; self.role = role; self.expiresAt = expiresAt; self.email = email; self.name = name; self.tenant = tenant
    }

    public var canOperate: Bool { role == .operator || role == .admin }
    public var isAdmin: Bool { role == .admin }
}

/// Answer of /api/auth/google and /api/tenants/register.
public struct LoginResult: Codable, Sendable {
    public var sessionToken: String
    public var role: Role
    public var expiresAt: Date
    public var tenant: Tenant?
}

public struct ArrivalObservation: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var deviceEventId: String
    public var cameraId: String
    public var plateCandidate: String?
    public var confidence: Double?
    public var capturedAt: Date
    public var receivedAt: Date
    public var photoId: String?
    public var confirmedPlate: String?
    public var vehicleClass: String?
    public var confirmedBy: String?
    public var confirmedAt: Date?
    public var jobId: String?
    public var cameraRole: CameraRole?
    public var dismissedAt: Date?
    public var dismissReason: String?

    public init(id: String, deviceEventId: String, cameraId: String, plateCandidate: String?, confidence: Double?, capturedAt: Date,
                receivedAt: Date, photoId: String? = nil, confirmedPlate: String? = nil, vehicleClass: String? = nil,
                confirmedBy: String? = nil, confirmedAt: Date? = nil, jobId: String? = nil, cameraRole: CameraRole? = .entry,
                dismissedAt: Date? = nil, dismissReason: String? = nil) {
        self.id = id; self.deviceEventId = deviceEventId; self.cameraId = cameraId; self.plateCandidate = plateCandidate
        self.confidence = confidence; self.capturedAt = capturedAt; self.receivedAt = receivedAt; self.photoId = photoId
        self.confirmedPlate = confirmedPlate; self.vehicleClass = vehicleClass; self.confirmedBy = confirmedBy
        self.confirmedAt = confirmedAt; self.jobId = jobId; self.cameraRole = cameraRole; self.dismissedAt = dismissedAt
        self.dismissReason = dismissReason
    }

    /// Same rule as the API: no job yet, not dismissed, seen by an entrance camera.
    public var isPending: Bool { jobId == nil && dismissedAt == nil && (cameraRole ?? .entry) == .entry }
    public var displayPlate: String? { confirmedPlate ?? plateCandidate }
}

public struct JobTransition: Codable, Hashable, Sendable {
    public var status: JobStatus
    public var at: Date
    public var actor: String

    public init(status: JobStatus, at: Date, actor: String) {
        self.status = status; self.at = at; self.actor = actor
    }
}

public struct JobAssignment: Codable, Hashable, Sendable {
    public var employeeId: String
    public var employeeName: String
    public var assignedAt: Date

    public init(employeeId: String, employeeName: String, assignedAt: Date) {
        self.employeeId = employeeId; self.employeeName = employeeName; self.assignedAt = assignedAt
    }
}

public struct Job: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var arrivalId: String
    public var plate: String
    public var vehicleClass: String
    public var packageId: String
    public var packageName: String
    public var services: [String]
    public var priceUsd: Decimal
    public var currency: String
    public var status: JobStatus
    public var arrivalAt: Date
    public var startedAt: Date?
    public var completedAt: Date?
    public var cancelledAt: Date?
    public var elapsedSeconds: Int
    public var activeSeconds: Int?
    public var transitions: [JobTransition]
    public var assignments: [JobAssignment]

    public init(id: String, arrivalId: String, plate: String, vehicleClass: String, packageId: String, packageName: String,
         services: [String], priceUsd: Decimal, currency: String, status: JobStatus, arrivalAt: Date, startedAt: Date?,
         completedAt: Date?, cancelledAt: Date?, elapsedSeconds: Int, activeSeconds: Int?, transitions: [JobTransition],
         assignments: [JobAssignment]) {
        self.id = id; self.arrivalId = arrivalId; self.plate = plate; self.vehicleClass = vehicleClass
        self.packageId = packageId; self.packageName = packageName; self.services = services; self.priceUsd = priceUsd
        self.currency = currency; self.status = status; self.arrivalAt = arrivalAt; self.startedAt = startedAt
        self.completedAt = completedAt; self.cancelledAt = cancelledAt; self.elapsedSeconds = elapsedSeconds
        self.activeSeconds = activeSeconds; self.transitions = transitions; self.assignments = assignments
    }
}

public struct JobSummary: Codable, Hashable, Sendable {
    public var total: Int
    public var arrived: Int
    public var queued: Int
    public var inProgress: Int
    public var completed: Int
    public var cancelled: Int
    public var averageCompletedSeconds: Int?
    public var completedToday: Int?
    public var completedTodayUtc: Int
    public var arrivalsToday: Int?

    /// Local-day count when the server provides it (newer APIs), otherwise the UTC one.
    public var doneToday: Int { completedToday ?? completedTodayUtc }
    public var onSite: Int { arrived + queued + inProgress }
}

public struct CatalogTranslation: Codable, Hashable, Sendable {
    public var name: String?
    public var subtitle: String?
    public var tagline: String?
    public var items: [String]?
}

public struct VehicleClass: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var translations: [String: CatalogTranslation]?
    public func localizedName(_ language: String) -> String { translations?[language]?.name ?? name }
}

public struct ServicePackage: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var subtitle: String
    public var tagline: String?
    public var items: [String]
    public var prices: [String: Decimal]
    public var translations: [String: CatalogTranslation]?
    public func localizedSubtitle(_ language: String) -> String { translations?[language]?.subtitle ?? subtitle }
    public func localizedItems(_ language: String) -> [String] { translations?[language]?.items ?? items }
}

public struct Catalog: Codable, Hashable, Sendable {
    public var currency: String
    public var locale: String?
    public var vehicleClasses: [VehicleClass]
    public var packages: [ServicePackage]

    public func price(package: String, vehicleClass: String) -> Decimal? {
        packages.first { $0.id == package }?.prices[vehicleClass]
    }
}

public struct Employee: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var active: Bool
}

public struct PlateTimeline: Codable, Hashable, Sendable {
    public var plate: String
    public var openJob: Job?
    public var leftAt: Date?
    public var visits: Int
    public var lastSeenAt: Date?
    public var jobs: [Job]
    public var sightings: [ArrivalObservation]
}

public struct Station: Codable, Hashable, Identifiable, Sendable {
    public var stationId: String
    public var name: String
    public var status: String
    public var pressurePsi: Double
    public var soapLevelDm: Double
    public var timestamp: Date
    public var id: String { stationId }
}

public struct StationAlert: Codable, Hashable, Sendable {
    public var stationId: String?
    public var code: String
    public var value: Double
    public var threshold: Double
    public var severity: String
}

public struct Bays: Codable, Hashable, Sendable {
    public var stations: [Station]
    public var alerts: [StationAlert]
}

public struct DeviceStatus: Codable, Hashable, Sendable {
    public var rssi: Int?
    public var uptimeMs: Int?
    public var freeHeap: Int?
    public var firmware: String?
    public var fps: Double?
    public var ip: String?

    public init(rssi: Int? = nil, uptimeMs: Int? = nil, freeHeap: Int? = nil, firmware: String? = nil, fps: Double? = nil, ip: String? = nil) {
        self.rssi = rssi; self.uptimeMs = uptimeMs; self.freeHeap = freeHeap; self.firmware = firmware; self.fps = fps; self.ip = ip
    }

    /// 0–4 bars, the same thresholds as the web console.
    public var signalBars: Int {
        guard let rssi else { return 0 }
        switch rssi {
        case (-60)...: return 4
        case (-70)...: return 3
        case (-80)...: return 2
        default: return 1
        }
    }
}

public struct Device: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var cameraId: String
    public var role: CameraRole
    public var keyHint: String
    public var createdAt: Date
    public var disabled: Bool
    public var online: Bool
    public var lastSeenAt: Date?
    public var lastStatus: DeviceStatus?
    public var observations: Int
    public var keyRotatedAt: Date?

    public enum State: Sendable { case online, offline, never, disabled }
    public var state: State { disabled ? .disabled : online ? .online : lastSeenAt == nil ? .never : .offline }
}

public struct DeviceInput: Codable, Hashable, Sendable {
    public var name: String
    public var cameraId: String
    public var role: CameraRole

    public init(name: String, cameraId: String, role: CameraRole) { self.name = name; self.cameraId = cameraId; self.role = role }

    public static func suggestedCameraId(for role: CameraRole) -> String {
        switch role { case .entry: "entrance-cam"; case .bay: "bay1-cam"; case .exit: "exit-cam" }
    }

    /// Name 2–60 characters; camera id of lowercase letters, digits, '-' or '_' (what the firmware and gateway use).
    public var isValid: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let id = cameraId.trimmingCharacters(in: .whitespaces).lowercased()
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-_")
        return (2...60).contains(trimmed.count) && (1...64).contains(id.count) && id.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
}

/// The key is only ever returned here, once, when a device is linked or its key rotated.
public struct DeviceWithKey: Codable, Hashable, Sendable {
    public var device: Device
    public var deviceKey: String
}

public struct Member: Codable, Hashable, Identifiable, Sendable {
    public var subject: String
    public var email: String?
    public var name: String?
    public var role: Role
    public var addedAt: Date
    public var id: String { subject }
    public var displayName: String { name ?? email ?? subject }
}

public struct Invitation: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var email: String
    public var role: Role
    public var invitedAt: Date
}

public struct ConfiguredMember: Codable, Hashable, Sendable {
    public var subject: String
    public var role: Role
}

public struct Team: Codable, Hashable, Sendable {
    public var members: [Member]
    public var invitations: [Invitation]
    public var configured: [ConfiguredMember]
    public var you: String
}

public enum EmailAddress {
    /// Lenient shape check (the API does the real normalization).
    public static func normalize(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = trimmed.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."), !parts[1].hasPrefix("."), !parts[1].hasSuffix("."),
              !trimmed.contains(where: \.isWhitespace), trimmed.count <= 254 else { return nil }
        return trimmed
    }
}
