import Foundation
import SparkleKit
import SwiftData

/// Reads and writes the on-device cache for one carwash. Server data replaces cached data on every
/// refresh; changes made on the device are applied optimistically and queued in `PendingOperation`.
extension Job {
    /// A job opened on the device while offline gets a local id until the server's job replaces it.
    /// It can't be advanced or assigned until then, since the server doesn't know that id.
    static func provisionalId(arrivalId: String) -> String { "local-\(arrivalId)" }
    var isProvisional: Bool { id.hasPrefix("local-") }
}

@MainActor
final class LocalStore {
    let context: ModelContext
    let tenantId: String

    init(context: ModelContext, tenantId: String) {
        self.context = context
        self.tenantId = tenantId
    }

    private func fetch<T: PersistentModel>(_ type: T.Type) -> [T] { (try? context.fetch(FetchDescriptor<T>())) ?? [] }

    // MARK: - Reading

    func arrivals() -> [ArrivalObservation] {
        fetch(CachedArrival.self).filter { $0.tenantId == tenantId }.sorted { $0.receivedAt > $1.receivedAt }.compactMap(\.value)
    }

    func pendingArrivals() -> [ArrivalObservation] { arrivals().filter(\.isPending) }

    func jobs() -> [Job] {
        fetch(CachedJob.self).filter { $0.tenantId == tenantId }.sorted { $0.arrivalAt > $1.arrivalAt }.compactMap(\.value)
    }

    func devices() -> [Device] {
        fetch(CachedDevice.self).filter { $0.tenantId == tenantId }.compactMap(\.value).sorted { $0.createdAt < $1.createdAt }
    }

    func employees() -> [Employee] {
        fetch(CachedEmployee.self).filter { $0.tenantId == tenantId }.compactMap(\.value).sorted { $0.name < $1.name }
    }

    func document<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        let key = "\(tenantId)/\(name)"
        guard let record = fetch(CachedDocument.self).first(where: { $0.key == key }) else { return nil }
        return try? SparkleJSON.decoder().decode(T.self, from: record.payload)
    }

    func photo(arrivalId: String) -> Data? {
        let key = "\(tenantId)/\(arrivalId)"
        return fetch(CachedPhoto.self).first { $0.key == key }?.data
    }

    func pendingOperations() -> [PendingOperation] {
        fetch(PendingOperation.self).filter { $0.tenantId == tenantId }.sorted { ($0.sequence, $0.createdAt) < ($1.sequence, $1.createdAt) }
    }

    // MARK: - Writing server data

    func replaceArrivals(_ list: [ArrivalObservation]) {
        for record in fetch(CachedArrival.self) where record.tenantId == tenantId { context.delete(record) }
        save() // commit deletions before re-inserting the same unique keys
        for arrival in list { context.insert(CachedArrival(tenantId: tenantId, arrival: arrival)) }
        reapplyPending()
        save()
    }

    func replaceJobs(_ list: [Job]) {
        for record in fetch(CachedJob.self) where record.tenantId == tenantId { context.delete(record) }
        save() // commit deletions before re-inserting the same unique keys
        for job in list { context.insert(CachedJob(tenantId: tenantId, job: job)) }
        reapplyPending()
        save()
    }

    func replaceDevices(_ list: [Device]) {
        for record in fetch(CachedDevice.self) where record.tenantId == tenantId { context.delete(record) }
        save() // commit deletions before re-inserting the same unique keys
        for device in list { context.insert(CachedDevice(tenantId: tenantId, device: device)) }
        save()
    }

    func replaceEmployees(_ list: [Employee]) {
        for record in fetch(CachedEmployee.self) where record.tenantId == tenantId { context.delete(record) }
        save() // commit deletions before re-inserting the same unique keys
        for employee in list { context.insert(CachedEmployee(tenantId: tenantId, employee: employee)) }
        save()
    }

    func putDocument<T: Encodable>(_ value: T, _ name: String) {
        let key = "\(tenantId)/\(name)"
        guard let data = try? SparkleJSON.encoder().encode(value) else { return }
        if let existing = fetch(CachedDocument.self).first(where: { $0.key == key }) {
            existing.payload = data
            existing.updatedAt = Date()
        } else {
            context.insert(CachedDocument(key: key, payload: data))
        }
        save()
    }

    func putPhoto(_ data: Data, arrivalId: String) {
        let key = "\(tenantId)/\(arrivalId)"
        guard fetch(CachedPhoto.self).first(where: { $0.key == key }) == nil else { return }
        context.insert(CachedPhoto(key: key, data: data))
        save()
    }

    func upsertJob(_ job: Job) {
        let key = "\(tenantId)/\(job.id)"
        if let record = fetch(CachedJob.self).first(where: { $0.key == key }) { context.delete(record); save() }
        context.insert(CachedJob(tenantId: tenantId, job: job))
        save()
    }

    func upsertDevice(_ device: Device) {
        let key = "\(tenantId)/\(device.id)"
        if let record = fetch(CachedDevice.self).first(where: { $0.key == key }) { context.delete(record); save() }
        context.insert(CachedDevice(tenantId: tenantId, device: device))
        save()
    }

    // MARK: - Outbox

    func enqueue(_ operation: OutboxOperation) {
        let next = (pendingOperations().map(\.sequence).max() ?? 0) + 1
        context.insert(PendingOperation(tenantId: tenantId, operation: operation, sequence: next))
        apply(operation)
        save()
    }

    func remove(_ pending: PendingOperation) {
        context.delete(pending)
        save()
    }

    /// Server refreshes overwrite the cache; changes still waiting to be sent are re-applied on top,
    /// so the screen doesn't flip back to the old state while offline.
    private func reapplyPending() {
        for pending in pendingOperations() { if let operation = pending.operation { apply(operation) } }
    }

    /// The optimistic local version of an operation.
    func apply(_ operation: OutboxOperation, catalog: Catalog? = nil, now: Date = Date()) {
        switch operation {
        case let .confirmAndOpen(arrivalId, plate, vehicleClass, packageId, _, _):
            guard let record = arrivalRecord(arrivalId), var arrival = record.value, arrival.jobId == nil else { return }
            let provisionalId = Job.provisionalId(arrivalId: arrivalId)
            arrival.confirmedPlate = plate
            arrival.vehicleClass = vehicleClass
            arrival.confirmedAt = arrival.confirmedAt ?? now
            arrival.jobId = provisionalId
            replace(record, with: arrival)
            let catalog = catalog ?? document(Catalog.self, "catalog") ?? DemoBackend.defaultCatalog
            let package = catalog.packages.first { $0.id == packageId }
            let job = Job(id: provisionalId, arrivalId: arrivalId, plate: plate, vehicleClass: vehicleClass, packageId: packageId,
                          packageName: package?.name ?? packageId, services: package?.items ?? [], priceUsd: package?.prices[vehicleClass] ?? 0,
                          currency: catalog.currency, status: .arrived, arrivalAt: arrival.receivedAt, startedAt: nil, completedAt: nil,
                          cancelledAt: nil, elapsedSeconds: 0, activeSeconds: nil, transitions: [JobTransition(status: .arrived, at: now, actor: "local")],
                          assignments: [])
            if fetch(CachedJob.self).first(where: { $0.key == "\(tenantId)/\(provisionalId)" }) == nil {
                context.insert(CachedJob(tenantId: tenantId, job: job, provisional: true))
            }
        case let .transition(jobId, status, _):
            let key = "\(tenantId)/\(jobId)"
            guard let record = fetch(CachedJob.self).first(where: { $0.key == key }), var job = record.value, job.status != status else { return }
            job.status = status
            if status == .inProgress { job.startedAt = now }
            if status == .completed { job.completedAt = now }
            if status == .cancelled { job.cancelledAt = now }
            job.transitions.append(JobTransition(status: status, at: now, actor: "local"))
            record.payload = (try? SparkleJSON.encoder().encode(job)) ?? record.payload
            record.status = status.rawValue
        case let .dismiss(arrivalId, reason):
            guard let record = arrivalRecord(arrivalId), var arrival = record.value else { return }
            arrival.dismissedAt = arrival.dismissedAt ?? now
            arrival.dismissReason = reason.rawValue
            replace(record, with: arrival)
        case let .assign(jobId, employeeId, _):
            let key = "\(tenantId)/\(jobId)"
            guard let record = fetch(CachedJob.self).first(where: { $0.key == key }), var job = record.value,
                  !job.assignments.contains(where: { $0.employeeId == employeeId }),
                  let employee = employees().first(where: { $0.id == employeeId }) else { return }
            job.assignments.append(JobAssignment(employeeId: employeeId, employeeName: employee.name, assignedAt: now))
            record.payload = (try? SparkleJSON.encoder().encode(job)) ?? record.payload
        }
    }

    private func arrivalRecord(_ id: String) -> CachedArrival? {
        let key = "\(tenantId)/\(id)"
        return fetch(CachedArrival.self).first { $0.key == key }
    }

    private func replace(_ record: CachedArrival, with arrival: ArrivalObservation) {
        record.payload = (try? SparkleJSON.encoder().encode(arrival)) ?? record.payload
        record.isPending = arrival.isPending
    }

    func save() {
        do { try context.save() } catch { assertionFailure("SwiftData save failed: \(error)") }
    }

    /// Removes this carwash's cached data (sign-out).
    func clear() {
        for record in fetch(CachedArrival.self) where record.tenantId == tenantId { context.delete(record) }
        for record in fetch(CachedJob.self) where record.tenantId == tenantId { context.delete(record) }
        for record in fetch(CachedDevice.self) where record.tenantId == tenantId { context.delete(record) }
        for record in fetch(CachedEmployee.self) where record.tenantId == tenantId { context.delete(record) }
        for record in fetch(CachedDocument.self) where record.key.hasPrefix("\(tenantId)/") { context.delete(record) }
        for record in fetch(CachedPhoto.self) where record.key.hasPrefix("\(tenantId)/") { context.delete(record) }
        for record in pendingOperations() { context.delete(record) }
        save()
    }
}
