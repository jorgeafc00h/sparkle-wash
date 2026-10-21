import Foundation

/// Wraps an API and can pretend the network is down. The demo's "sin conexión" switch uses it to show
/// offline queuing, and tests use it for the outbox.
public final class OfflineSwitchAPI: SparkleAPI, @unchecked Sendable {
    public let base: SparkleAPI
    private let lock = NSLock()
    private var _offline = false
    public var offline: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _offline }
        set { lock.lock(); _offline = newValue; lock.unlock() }
    }

    public init(base: SparkleAPI) { self.base = base }
    public var isDemo: Bool { base.isDemo }
    private func check() throws { if offline { throw APIError.offline } }

    public func session() async throws -> StaffSession { try check(); return try await base.session() }
    public func catalog() async throws -> Catalog { try check(); return try await base.catalog() }
    public func arrivals(pendingOnly: Bool, limit: Int) async throws -> [ArrivalObservation] { try check(); return try await base.arrivals(pendingOnly: pendingOnly, limit: limit) }
    public func arrivalPhoto(id: String) async throws -> Data? { try check(); return try await base.arrivalPhoto(id: id) }
    public func confirmArrival(id: String, plate: String, vehicleClass: String) async throws -> ArrivalObservation { try check(); return try await base.confirmArrival(id: id, plate: plate, vehicleClass: vehicleClass) }
    public func dismissArrival(id: String, reason: DismissReason) async throws -> ArrivalObservation { try check(); return try await base.dismissArrival(id: id, reason: reason) }
    public func openJob(arrivalId: String, packageId: String, idempotencyKey: String) async throws -> Job { try check(); return try await base.openJob(arrivalId: arrivalId, packageId: packageId, idempotencyKey: idempotencyKey) }
    public func jobs() async throws -> [Job] { try check(); return try await base.jobs() }
    public func jobSummary() async throws -> JobSummary { try check(); return try await base.jobSummary() }
    public func transitionJob(id: String, to status: JobStatus, idempotencyKey: String) async throws -> Job { try check(); return try await base.transitionJob(id: id, to: status, idempotencyKey: idempotencyKey) }
    public func assignEmployee(jobId: String, employeeId: String, idempotencyKey: String) async throws -> Job { try check(); return try await base.assignEmployee(jobId: jobId, employeeId: employeeId, idempotencyKey: idempotencyKey) }
    public func employees() async throws -> [Employee] { try check(); return try await base.employees() }
    public func addEmployee(name: String) async throws -> Employee { try check(); return try await base.addEmployee(name: name) }
    public func setEmployeeActive(id: String, active: Bool) async throws -> Employee { try check(); return try await base.setEmployeeActive(id: id, active: active) }
    public func plateTimeline(_ plate: String) async throws -> PlateTimeline { try check(); return try await base.plateTimeline(plate) }
    public func bays() async throws -> Bays { try check(); return try await base.bays() }
    public func tenant() async throws -> Tenant { try check(); return try await base.tenant() }
    public func updateTenant(_ input: TenantInput) async throws -> Tenant { try check(); return try await base.updateTenant(input) }
    public func devices() async throws -> [Device] { try check(); return try await base.devices() }
    public func createDevice(_ input: DeviceInput) async throws -> DeviceWithKey { try check(); return try await base.createDevice(input) }
    public func rotateDevice(id: String) async throws -> DeviceWithKey { try check(); return try await base.rotateDevice(id: id) }
    public func setDeviceDisabled(id: String, disabled: Bool) async throws -> Device { try check(); return try await base.setDeviceDisabled(id: id, disabled: disabled) }
    public func team() async throws -> Team { try check(); return try await base.team() }
    public func invite(email: String, role: Role) async throws { try check(); try await base.invite(email: email, role: role) }
    public func revokeInvitation(id: String) async throws { try check(); try await base.revokeInvitation(id: id) }
    public func setMemberRole(subject: String, role: Role) async throws { try check(); try await base.setMemberRole(subject: subject, role: role) }
    public func removeMember(subject: String) async throws { try check(); try await base.removeMember(subject: subject) }
    public func signOut() async { await base.signOut() }
    public func changes() -> AsyncThrowingStream<ChangeTopic, Error> { base.changes() }
}
