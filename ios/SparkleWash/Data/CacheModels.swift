import Foundation
import SparkleKit
import SwiftData

// SwiftData keeps the carwash's data on the device so the app opens instantly, works without signal
// at the bays, and queues changes until they can be sent. Each record stores the server's JSON
// (`payload`) plus the few fields needed to filter and sort; the server stays the source of truth.

@Model
final class CachedArrival {
    @Attribute(.unique) var key: String
    var id: String
    var tenantId: String
    var receivedAt: Date
    var isPending: Bool
    var payload: Data

    init(tenantId: String, arrival: ArrivalObservation) {
        key = "\(tenantId)/\(arrival.id)"
        id = arrival.id
        self.tenantId = tenantId
        receivedAt = arrival.receivedAt
        isPending = arrival.isPending
        payload = (try? SparkleJSON.encoder().encode(arrival)) ?? Data()
    }

    var value: ArrivalObservation? { try? SparkleJSON.decoder().decode(ArrivalObservation.self, from: payload) }
}

@Model
final class CachedJob {
    @Attribute(.unique) var key: String
    var id: String
    var tenantId: String
    var status: String
    var arrivalAt: Date
    /// True for a job created on the device while offline, until the server's version replaces it.
    var isProvisional: Bool
    var payload: Data

    init(tenantId: String, job: Job, provisional: Bool = false) {
        key = "\(tenantId)/\(job.id)"
        id = job.id
        self.tenantId = tenantId
        status = job.status.rawValue
        arrivalAt = job.arrivalAt
        isProvisional = provisional
        payload = (try? SparkleJSON.encoder().encode(job)) ?? Data()
    }

    var value: Job? { try? SparkleJSON.decoder().decode(Job.self, from: payload) }
}

@Model
final class CachedDevice {
    @Attribute(.unique) var key: String
    var tenantId: String
    var name: String
    var payload: Data

    init(tenantId: String, device: Device) {
        key = "\(tenantId)/\(device.id)"
        self.tenantId = tenantId
        name = device.name
        payload = (try? SparkleJSON.encoder().encode(device)) ?? Data()
    }

    var value: Device? { try? SparkleJSON.decoder().decode(Device.self, from: payload) }
}

@Model
final class CachedEmployee {
    @Attribute(.unique) var key: String
    var tenantId: String
    var name: String
    var payload: Data

    init(tenantId: String, employee: Employee) {
        key = "\(tenantId)/\(employee.id)"
        self.tenantId = tenantId
        name = employee.name
        payload = (try? SparkleJSON.encoder().encode(employee)) ?? Data()
    }

    var value: Employee? { try? SparkleJSON.decoder().decode(Employee.self, from: payload) }
}

/// Small documents kept per carwash: the catalog, the job summary, the session's tenant.
@Model
final class CachedDocument {
    @Attribute(.unique) var key: String
    var payload: Data
    var updatedAt: Date

    init(key: String, payload: Data) {
        self.key = key
        self.payload = payload
        updatedAt = Date()
    }
}

@Model
final class CachedPhoto {
    @Attribute(.unique) var key: String
    @Attribute(.externalStorage) var data: Data

    init(key: String, data: Data) {
        self.key = key
        self.data = data
    }
}

/// A change made on the device, waiting to reach the server (see SparkleKit.OutboxOperation).
@Model
final class PendingOperation {
    @Attribute(.unique) var id: UUID
    var tenantId: String
    var createdAt: Date
    var attempts: Int
    /// Breaks ties between operations queued within the same clock tick, so they replay in order.
    var sequence: Int = 0
    var payload: Data

    init(tenantId: String, operation: OutboxOperation, createdAt: Date = Date(), sequence: Int = 0) {
        id = UUID()
        self.sequence = sequence
        self.tenantId = tenantId
        self.createdAt = createdAt
        attempts = 0
        payload = (try? JSONEncoder().encode(operation)) ?? Data()
    }

    var operation: OutboxOperation? { try? JSONDecoder().decode(OutboxOperation.self, from: payload) }
}

enum CacheSchema {
    static let models: [any PersistentModel.Type] = [
        CachedArrival.self, CachedJob.self, CachedDevice.self, CachedEmployee.self, CachedDocument.self, CachedPhoto.self, PendingOperation.self,
    ]

    static func container(inMemory: Bool) throws -> ModelContainer {
        let configuration = ModelConfiguration(schema: Schema(models), isStoredInMemoryOnly: inMemory)
        return try ModelContainer(for: Schema(models), configurations: [configuration])
    }
}
