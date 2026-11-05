import Foundation
import SwiftData

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

@Model
final class CachedOperationsSnapshot {
    @Attribute(.unique) var endpoint: String
    var staffScope: Data?
    var archiveHistoryData: Data?
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
    }
}
