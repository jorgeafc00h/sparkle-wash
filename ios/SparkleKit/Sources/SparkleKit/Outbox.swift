import Foundation

/// A change made on the device that must reach the server. Queued when offline and replayed in order.
/// Every operation carries its own idempotency key, so a replay after a lost response can't apply twice.
public enum OutboxOperation: Codable, Hashable, Sendable {
    case confirmAndOpen(arrivalId: String, plate: String, vehicleClass: String, packageId: String, alreadyConfirmed: Bool, key: String)
    case transition(jobId: String, status: JobStatus, key: String)
    case dismiss(arrivalId: String, reason: DismissReason)
    case assign(jobId: String, employeeId: String, key: String)

    public static func confirmAndOpen(arrivalId: String, plate: String, vehicleClass: String, packageId: String, alreadyConfirmed: Bool = false) -> OutboxOperation {
        .confirmAndOpen(arrivalId: arrivalId, plate: plate, vehicleClass: vehicleClass, packageId: packageId,
                        alreadyConfirmed: alreadyConfirmed, key: "open-\(arrivalId)-\(packageId)")
    }

    /// One key per (job, status), like the web console: double taps and retries are the same transition.
    public static func transition(jobId: String, to status: JobStatus) -> OutboxOperation {
        .transition(jobId: jobId, status: status, key: String("\(status.rawValue)-\(jobId)".prefix(128)))
    }

    public static func assign(jobId: String, employeeId: String) -> OutboxOperation {
        .assign(jobId: jobId, employeeId: employeeId, key: IdempotencyKey.make("assign"))
    }
}

public enum OutboxResult: Equatable, Sendable {
    case done
    /// Network trouble: keep it queued and try again later.
    case retryLater
    /// The server said no (conflict, invalid, gone). Drop it and tell the person why.
    case rejected(APIError)
}

public enum OutboxProcessor {
    public static func run(_ operation: OutboxOperation, on api: SparkleAPI) async -> OutboxResult {
        do {
            switch operation {
            case let .confirmAndOpen(arrivalId, plate, vehicleClass, packageId, alreadyConfirmed, key):
                // A replay after a lost response is safe: the API answers the same confirmation as a duplicate (200)
                // and only a different one as a conflict, which is a real rejection.
                if !alreadyConfirmed { _ = try await api.confirmArrival(id: arrivalId, plate: plate, vehicleClass: vehicleClass) }
                _ = try await api.openJob(arrivalId: arrivalId, packageId: packageId, idempotencyKey: key)
            case let .transition(jobId, status, key):
                _ = try await api.transitionJob(id: jobId, to: status, idempotencyKey: key)
            case let .dismiss(arrivalId, reason):
                _ = try await api.dismissArrival(id: arrivalId, reason: reason)
            case let .assign(jobId, employeeId, key):
                _ = try await api.assignEmployee(jobId: jobId, employeeId: employeeId, idempotencyKey: key)
            }
            return .done
        } catch let error as APIError {
            return error.isRetryable ? .retryLater : .rejected(error)
        } catch {
            return .retryLater
        }
    }

    /// Replays a queue in order and stops at the first operation that must wait (order matters:
    /// a "start wash" can't go before the "queue" it follows). Returns each processed result.
    public static func drain(_ queue: [OutboxOperation], on api: SparkleAPI) async -> [(OutboxOperation, OutboxResult)] {
        var results: [(OutboxOperation, OutboxResult)] = []
        for operation in queue {
            let result = await run(operation, on: api)
            results.append((operation, result))
            if result == .retryLater { break }
        }
        return results
    }
}
