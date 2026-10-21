import Foundation

/// In-memory SparkleWash, for the demo mode and for tests. Mirrors the API's rules (job state machine,
/// pending/dismissed arrivals, device keys, team limits) and the web console's demo data.
/// The rules live in `DemoWorld` (a value type, so seeding in `init` needs no actor hops); the actor
/// serializes access and pushes change notifications.
public actor DemoBackend: SparkleAPI {
    public nonisolated let isDemo = true
    private var world: DemoWorld
    private var listeners: [UUID: AsyncThrowingStream<ChangeTopic, Error>.Continuation] = [:]

    public init(seed: Bool = true, carwash: TenantInput? = nil, now: Date = Date()) {
        world = DemoWorld(seed: seed, carwash: carwash, now: now)
    }

    /// Runs one operation on the world, then announces whatever it changed.
    private func run<T>(_ body: (inout DemoWorld) throws -> T) rethrows -> T {
        defer {
            for topic in world.changed { for continuation in listeners.values { continuation.yield(topic) } }
            world.changed.removeAll()
        }
        return try body(&world)
    }

    public func tick(now: Date = Date()) { run { $0.tick(now: now) } }

    public func session() async throws -> StaffSession { world.session() }
    public func catalog() async throws -> Catalog { world.catalogData }
    public func arrivals(pendingOnly: Bool, limit: Int) async throws -> [ArrivalObservation] { world.arrivals(pendingOnly: pendingOnly, limit: limit) }
    public func arrivalPhoto(id: String) async throws -> Data? { world.photos[id] }
    public func confirmArrival(id: String, plate: String, vehicleClass: String) async throws -> ArrivalObservation {
        try run { try $0.confirmArrival(id: id, plate: plate, vehicleClass: vehicleClass) }
    }
    public func dismissArrival(id: String, reason: DismissReason) async throws -> ArrivalObservation { try run { try $0.dismissArrival(id: id, reason: reason) } }
    public func openJob(arrivalId: String, packageId: String, idempotencyKey: String) async throws -> Job {
        try run { try $0.openJob(arrivalId: arrivalId, packageId: packageId) }
    }
    public func jobs() async throws -> [Job] { world.jobs() }
    public func jobSummary() async throws -> JobSummary { world.jobSummary() }
    public func transitionJob(id: String, to status: JobStatus, idempotencyKey: String) async throws -> Job { try run { try $0.transitionJob(id: id, to: status) } }
    public func assignEmployee(jobId: String, employeeId: String, idempotencyKey: String) async throws -> Job {
        try run { try $0.assignEmployee(jobId: jobId, employeeId: employeeId) }
    }
    public func employees() async throws -> [Employee] { world.staff }
    public func addEmployee(name: String) async throws -> Employee { try run { try $0.addEmployee(name: name) } }
    public func setEmployeeActive(id: String, active: Bool) async throws -> Employee { try run { try $0.setEmployeeActive(id: id, active: active) } }
    public func plateTimeline(_ plate: String) async throws -> PlateTimeline { try world.plateTimeline(plate) }
    public func bays() async throws -> Bays { world.bays() }
    public func tenant() async throws -> Tenant { world.tenantData }
    public func updateTenant(_ input: TenantInput) async throws -> Tenant { try run { try $0.updateTenant(input) } }
    public func devices() async throws -> [Device] { world.devices() }
    public func createDevice(_ input: DeviceInput) async throws -> DeviceWithKey { try run { try $0.createDevice(input) } }
    public func rotateDevice(id: String) async throws -> DeviceWithKey { try run { try $0.rotateDevice(id: id) } }
    public func setDeviceDisabled(id: String, disabled: Bool) async throws -> Device { try run { try $0.setDeviceDisabled(id: id, disabled: disabled) } }
    public func team() async throws -> Team { world.team() }
    public func invite(email: String, role: Role) async throws { try run { try $0.invite(email: email, role: role) } }
    public func revokeInvitation(id: String) async throws { try run { try $0.revokeInvitation(id: id) } }
    public func setMemberRole(subject: String, role: Role) async throws { try run { try $0.setMemberRole(subject: subject, role: role) } }
    public func removeMember(subject: String) async throws { try run { try $0.removeMember(subject: subject) } }
    public func signOut() async {}

    public nonisolated func changes() -> AsyncThrowingStream<ChangeTopic, Error> {
        AsyncThrowingStream { continuation in
            let id = UUID()
            Task { await self.addListener(id, continuation) }
            continuation.onTermination = { _ in Task { await self.removeListener(id) } }
        }
    }

    private func addListener(_ id: UUID, _ continuation: AsyncThrowingStream<ChangeTopic, Error>.Continuation) { listeners[id] = continuation }
    private func removeListener(_ id: UUID) { listeners[id] = nil }

    /// The catalog of contracts/v1/service-packages.json (Spanish, with English translations).
    public static var defaultCatalog: Catalog { DemoWorld.defaultCatalog }
    public static var placeholderJPEG: Data { DemoWorld.placeholderJPEG }
}

struct DemoWorld {
    let catalogData: Catalog
    var arrivals: [ArrivalObservation] = []
    var jobList: [Job] = []
    var photos: [String: Data] = [:]
    var staff: [Employee] = []
    var deviceList: [Device] = []
    var members: [Member] = []
    var invitations: [Invitation] = []
    var tenantData: Tenant
    private var fresh: Bool
    private var counter = 0
    /// Topics changed by the last operation; the actor announces and clears them.
    var changed: [ChangeTopic] = []
    private let plates = ["P482913", "M771204", "C55821", "AB123CD", "P903377", "N1CO42", "P118450", "TX4410", "P660021", "SV2026"]

    /// `seed: false` starts an empty carwash, as right after registering.
    init(seed: Bool, carwash: TenantInput?, now: Date) {
        catalogData = DemoWorld.defaultCatalog
        tenantData = Tenant(id: "demo", name: carwash?.name ?? "SparkleWash Escalón",
                            city: carwash == nil ? "San Salvador" : carwash?.city, country: carwash?.country ?? "SV",
                            phone: carwash == nil ? "+503 2222-3333" : carwash?.phone, timeZone: carwash?.timeZone ?? "America/El_Salvador",
                            createdAt: now.addingTimeInterval(-86400 * 30))
        fresh = !seed
        members = [Member(subject: "demo", email: "tu@ejemplo.com", name: "Tú (demo)", role: .admin, addedAt: now.addingTimeInterval(-86400 * 30))]
        guard seed else { return }
        staff = [Employee(id: "e1", name: "Maria Garcia", active: true), Employee(id: "e2", name: "Luis Hernandez", active: true),
                 Employee(id: "e3", name: "Ana Martinez", active: true), Employee(id: "e4", name: "Carlos Rivera", active: true)]
        members.append(Member(subject: "demo-maria", email: "maria@ejemplo.com", name: "Maria Garcia", role: .operator, addedAt: now.addingTimeInterval(-86400 * 20)))
        invitations = [Invitation(id: "inv-demo", email: "luis@ejemplo.com", role: .viewer, invitedAt: now.addingTimeInterval(-3600 * 5))]
        let seeds: [(String, CameraRole, String, Int)] = [("Cámara de entrada", .entry, "entrance-cam", -54), ("Bahía 1", .bay, "bay1-cam", -63), ("Cámara de salida", .exit, "exit-cam", -71)]
        deviceList = seeds.enumerated().map { index, seed in
            Device(id: "dev\(index)", name: seed.0, cameraId: seed.2, role: seed.1, keyHint: "…a\(index)Bc", createdAt: now.addingTimeInterval(-86400 * 20),
                   disabled: false, online: true, lastSeenAt: now.addingTimeInterval(-12), lastStatus: DeviceStatus(rssi: seed.3, uptimeMs: 3_600_000 * (30 - index * 7),
                   freeHeap: 96_000, firmware: "sparklewash-cam/1.2", fps: 2.4 - Double(index) * 0.2, ip: "192.168.1.\(50 + index)"),
                   observations: [214, 187, 160][index], keyRotatedAt: nil)
        }
        let seededJobs: [(String, String, String, JobStatus, TimeInterval, [String])] = [
            ("P118450", "suv", "renew", .inProgress, 1900, ["e1", "e3"]), ("C55821", "car", "essential", .queued, 760, ["e2"]),
            ("TX4410", "pickup", "supreme", .arrived, 240, []), ("SV2026", "car", "quick", .completed, 3600, ["e4"]),
        ]
        for (plate, vehicleClass, package, status, age, assigned) in seededJobs {
            var arrival = observe(cameraId: "entrance-cam", plate: plate, confidence: 0.93, at: now.addingTimeInterval(-age), notify: false)
            arrival.confirmedPlate = plate
            arrival.vehicleClass = vehicleClass
            arrival.confirmedAt = now.addingTimeInterval(-age + 30)
            replace(arrival)
            var job = makeJob(arrival: arrival, packageId: package, at: now.addingTimeInterval(-age))
            let path: [JobStatus] = [.queued, .inProgress, .completed]
            let offsets = [age - 120, age * 0.6, age * 0.6 - 840]
            for (step, offset) in zip(path, offsets) where path.firstIndex(of: step)! <= (path.firstIndex(of: status) ?? -1) {
                job = moved(job, to: step, at: now.addingTimeInterval(-offset))
            }
            let staffList = staff
            job.assignments = assigned.compactMap { id in staffList.first { $0.id == id } }.map {
                JobAssignment(employeeId: $0.id, employeeName: $0.name, assignedAt: now.addingTimeInterval(-age + 60))
            }
            jobList.insert(job, at: 0)
            linkArrival(arrival.id, to: job.id)
        }
        _ = observe(cameraId: "entrance-cam", plate: "P482913", confidence: 0.91, at: now.addingTimeInterval(-45), notify: false)
        _ = observe(cameraId: "entrance-cam", plate: "P9O3377", confidence: 0.57, at: now.addingTimeInterval(-15), notify: false)
    }

    // MARK: - Simulation

    mutating func tick(now: Date) {
        let open = jobList.filter { $0.status == .inProgress || $0.status == .queued }
        if !open.isEmpty, Int.random(in: 0..<100) < 45, let job = open.randomElement() {
            let camera = job.status != .inProgress ? "entrance-cam" : Int.random(in: 0..<100) < 35 ? "exit-cam" : "bay1-cam"
            _ = observe(cameraId: camera, plate: job.plate, confidence: 0.8 + Double.random(in: 0...0.18), at: now)
            return
        }
        let waiting = arrivals.filter(\.isPending)
        let known = Set(jobList.filter { $0.status.isOpen }.map(\.plate) + waiting.compactMap(\.plateCandidate))
        guard waiting.count < 4, let plate = plates.filter({ !known.contains($0) }).randomElement() else { return }
        if (fresh || !deviceList.isEmpty) && !deviceList.contains(where: { $0.role == .entry && !$0.disabled }) { return }
        _ = observe(cameraId: "entrance-cam", plate: plate, confidence: 0.45 + Double.random(in: 0...0.5), at: now)
    }

    private mutating func nextId() -> String {
        counter += 1
        let random = String(UInt32.random(in: 0...UInt32.max), radix: 16)
        return String(repeating: "0", count: 8 - random.count) + random + String(counter, radix: 16)
    }

    @discardableResult
    private mutating func observe(cameraId: String, plate: String, confidence: Double, at: Date, notify: Bool = true) -> ArrivalObservation {
        let normalized = Plate.normalize(plate)
        let role: CameraRole = cameraId == "exit-cam" ? .exit : cameraId == "bay1-cam" ? .bay : .entry
        let openJob = jobList.first { $0.plate == normalized && $0.status.isOpen }
        let id = nextId()
        let observation = ArrivalObservation(id: id, deviceEventId: "\(cameraId)-\(id)", cameraId: cameraId, plateCandidate: normalized,
                                             confidence: (confidence * 100).rounded() / 100, capturedAt: at.addingTimeInterval(-1), receivedAt: at,
                                             photoId: id, jobId: openJob?.id, cameraRole: role)
        arrivals.insert(observation, at: 0)
        if arrivals.count > 300 { arrivals.removeLast(arrivals.count - 300) }
        photos[id] = DemoWorld.placeholderJPEG
        if let index = deviceList.firstIndex(where: { $0.cameraId == cameraId && !$0.disabled }) {
            deviceList[index].lastSeenAt = at
            deviceList[index].online = true
            deviceList[index].observations += 1
        }
        if notify { emit(openJob == nil ? .arrivals : .jobs) }
        return observation
    }

    private mutating func replace(_ arrival: ArrivalObservation) {
        if let index = arrivals.firstIndex(where: { $0.id == arrival.id }) { arrivals[index] = arrival }
    }

    private mutating func linkArrival(_ id: String, to jobId: String) {
        if let index = arrivals.firstIndex(where: { $0.id == id }) { arrivals[index].jobId = jobId }
    }

    private mutating func makeJob(arrival: ArrivalObservation, packageId: String, at: Date) -> Job {
        let package = catalogData.packages.first { $0.id == packageId }!
        let vehicleClass = arrival.vehicleClass ?? "car"
        return Job(id: nextId(), arrivalId: arrival.id, plate: arrival.confirmedPlate ?? arrival.plateCandidate ?? "", vehicleClass: vehicleClass,
                   packageId: package.id, packageName: package.name, services: package.items, priceUsd: package.prices[vehicleClass] ?? 0,
                   currency: catalogData.currency, status: .arrived, arrivalAt: arrival.receivedAt, startedAt: nil, completedAt: nil,
                   cancelledAt: nil, elapsedSeconds: 0, activeSeconds: nil, transitions: [JobTransition(status: .arrived, at: at, actor: "demo")],
                   assignments: [])
    }

    private func moved(_ job: Job, to status: JobStatus, at: Date) -> Job {
        var next = job
        next.status = status
        if status == .inProgress { next.startedAt = at }
        if status == .completed { next.completedAt = at }
        if status == .cancelled { next.cancelledAt = at }
        next.transitions.append(JobTransition(status: status, at: at, actor: "demo"))
        return next
    }

    private func view(_ job: Job, now: Date = Date()) -> Job {
        var result = job
        let end = job.completedAt ?? job.cancelledAt ?? now
        result.elapsedSeconds = max(0, Int(end.timeIntervalSince(job.arrivalAt)))
        result.activeSeconds = job.startedAt.map { max(0, Int(end.timeIntervalSince($0))) }
        return result
    }

    private mutating func emit(_ topic: ChangeTopic) {
        if !changed.contains(topic) { changed.append(topic) }
    }

    // MARK: - Operations (the actor exposes these as SparkleAPI)

    func session() -> StaffSession {
        StaffSession(subject: "demo", role: .admin, expiresAt: Date().addingTimeInterval(8 * 3600), email: "tu@ejemplo.com", name: "Tú (demo)", tenant: tenantData)
    }

    
    func arrivals(pendingOnly: Bool, limit: Int) -> [ArrivalObservation] {
        Array((pendingOnly ? arrivals.filter(\.isPending) : arrivals).prefix(max(1, min(limit, 100))))
    }


    mutating func confirmArrival(id: String, plate: String, vehicleClass: String) throws -> ArrivalObservation {
        guard let normalized = Plate.normalize(plate), catalogData.vehicleClasses.contains(where: { $0.id == vehicleClass }) else {
            throw APIError.invalid("Invalid plate or vehicle class")
        }
        guard var arrival = arrivals.first(where: { $0.id == id }) else { throw APIError.notFound }
        if arrival.dismissedAt != nil { throw APIError.conflict("Arrival was dismissed") }
        if arrival.confirmedAt != nil {
            if arrival.confirmedPlate == normalized && arrival.vehicleClass == vehicleClass { return arrival }
            throw APIError.conflict("Arrival was already confirmed differently")
        }
        arrival.confirmedPlate = normalized
        arrival.vehicleClass = vehicleClass
        arrival.confirmedBy = "demo"
        arrival.confirmedAt = Date()
        replace(arrival)
        emit(.arrivals)
        return arrival
    }

    mutating func dismissArrival(id: String, reason: DismissReason) throws -> ArrivalObservation {
        guard var arrival = arrivals.first(where: { $0.id == id }) else { throw APIError.notFound }
        if arrival.jobId != nil { throw APIError.conflict("Arrival already has a job") }
        arrival.dismissedAt = Date()
        arrival.dismissReason = reason.rawValue
        replace(arrival)
        emit(.arrivals)
        return arrival
    }

    mutating func openJob(arrivalId: String, packageId: String) throws -> Job {
        if let existing = jobList.first(where: { $0.transitions.first?.status == .arrived && $0.arrivalId == arrivalId && $0.packageId == packageId }) {
            return view(existing) // same arrival + package: an idempotent replay
        }
        guard let arrival = arrivals.first(where: { $0.id == arrivalId }) else { throw APIError.notFound }
        guard arrival.confirmedAt != nil else { throw APIError.conflict("Arrival needs staff confirmation") }
        guard arrival.dismissedAt == nil else { throw APIError.conflict("Arrival was dismissed") }
        guard catalogData.packages.contains(where: { $0.id == packageId }) else { throw APIError.invalid("Unknown detailing package") }
        if jobList.contains(where: { $0.arrivalId == arrivalId || ($0.plate == arrival.confirmedPlate && $0.status.isOpen) }) {
            throw APIError.conflict("Arrival or plate already has an open job")
        }
        let job = makeJob(arrival: arrival, packageId: packageId, at: Date())
        jobList.insert(job, at: 0)
        linkArrival(arrivalId, to: job.id)
        emit(.jobs)
        emit(.arrivals)
        return view(job)
    }

    func jobs() -> [Job] { jobList.map { view($0) } }

    func jobSummary() -> JobSummary {
        let calendar = Calendar.current
        let completed = jobList.filter { $0.status == .completed }
        let today = completed.filter { calendar.isDateInToday($0.completedAt!) }.count
        let average = completed.isEmpty ? nil : completed.map { view($0).elapsedSeconds }.reduce(0, +) / completed.count
        func count(_ status: JobStatus) -> Int { jobList.filter { $0.status == status }.count }
        return JobSummary(total: jobList.count, arrived: count(.arrived), queued: count(.queued), inProgress: count(.inProgress),
                          completed: completed.count, cancelled: count(.cancelled), averageCompletedSeconds: average, completedToday: today,
                          completedTodayUtc: today, arrivalsToday: jobList.filter { calendar.isDateInToday($0.arrivalAt) }.count)
    }

    mutating func transitionJob(id: String, to status: JobStatus) throws -> Job {
        guard let index = jobList.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        let job = jobList[index]
        if job.status == status { return view(job) }
        let allowed = (status == .cancelled && job.status.isOpen) || job.status.next == status
        guard allowed else { throw APIError.conflict("Invalid job transition") }
        jobList[index] = moved(job, to: status, at: Date())
        emit(.jobs)
        return view(jobList[index])
    }

    mutating func assignEmployee(jobId: String, employeeId: String) throws -> Job {
        guard let index = jobList.firstIndex(where: { $0.id == jobId }) else { throw APIError.notFound }
        guard let employee = staff.first(where: { $0.id == employeeId && $0.active }) else { throw APIError.invalid("Employee is unknown or inactive") }
        if !jobList[index].status.isOpen || jobList[index].assignments.contains(where: { $0.employeeId == employeeId }) {
            throw APIError.conflict("Employee is already assigned or job is closed")
        }
        jobList[index].assignments.append(JobAssignment(employeeId: employee.id, employeeName: employee.name, assignedAt: Date()))
        emit(.jobs)
        return view(jobList[index])
    }


    mutating func addEmployee(name: String) throws -> Employee {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...100).contains(trimmed.count) else { throw APIError.invalid("Invalid employee name") }
        if staff.contains(where: { $0.active && $0.name.lowercased() == trimmed.lowercased() }) { throw APIError.conflict("Active employee name already exists") }
        let employee = Employee(id: nextId(), name: trimmed, active: true)
        staff.append(employee)
        return employee
    }

    mutating func setEmployeeActive(id: String, active: Bool) throws -> Employee {
        guard let index = staff.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        staff[index].active = active
        return staff[index]
    }

    func plateTimeline(_ plate: String) throws -> PlateTimeline {
        guard let normalized = Plate.normalize(plate) else { throw APIError.invalid("Invalid plate") }
        let jobs = jobList.filter { $0.plate == normalized }.map { view($0) }
        let sightings = arrivals.filter { $0.plateCandidate == normalized || $0.confirmedPlate == normalized }
        let leftAt = jobs.first.flatMap { latest in sightings.first { $0.jobId == latest.id && $0.cameraRole == .exit }?.capturedAt }
        return PlateTimeline(plate: normalized, openJob: jobs.first { $0.status.isOpen }, leftAt: leftAt, visits: jobs.count,
                             lastSeenAt: sightings.first?.capturedAt, jobs: jobs, sightings: sightings)
    }

    func bays() -> Bays {
        if fresh { return Bays(stations: [], alerts: []) }
        let now = Date()
        let stations = [
            Station(stationId: "b4c3", name: "Bay #1 foam touch", status: "idle", pressurePsi: 52, soapLevelDm: 20, timestamp: now),
            Station(stationId: "7d5c", name: "Bay #2 high pressure", status: "washing", pressurePsi: 58.5, soapLevelDm: 24, timestamp: now),
            Station(stationId: "a1f2", name: "Bay #3 detail", status: "idle", pressurePsi: 48, soapLevelDm: 19, timestamp: now),
            Station(stationId: "e8f1", name: "Bay #4 diamond polish", status: "cleaning", pressurePsi: 63.2, soapLevelDm: 26, timestamp: now),
        ]
        let alerts = stations.flatMap { station -> [StationAlert] in
            var list: [StationAlert] = []
            if station.pressurePsi < 45 { list.append(StationAlert(stationId: station.stationId, code: "lowPressure", value: station.pressurePsi, threshold: 45, severity: "warning")) }
            if station.pressurePsi > 60 { list.append(StationAlert(stationId: station.stationId, code: "highPressure", value: station.pressurePsi, threshold: 60, severity: "danger")) }
            if station.soapLevelDm < 35 { list.append(StationAlert(stationId: station.stationId, code: "lowSoapLevel", value: station.soapLevelDm, threshold: 35, severity: "danger")) }
            return list
        }
        return Bays(stations: stations, alerts: alerts)
    }


    mutating func updateTenant(_ input: TenantInput) throws -> Tenant {
        guard input.validationErrors.isEmpty else { throw APIError.invalid("Invalid carwash details") }
        let clean = input.cleaned
        tenantData.name = clean.name
        tenantData.city = clean.city
        tenantData.country = clean.country
        tenantData.phone = clean.phone
        tenantData.timeZone = clean.timeZone
        return tenantData
    }

    func devices() -> [Device] {
        let now = Date()
        return deviceList.map { device in
            var copy = device
            copy.online = !device.disabled && device.lastSeenAt.map { now.timeIntervalSince($0) < 120 } == true
            return copy
        }
    }

    private static func secret() -> String {
        let alphabet = Array("abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<43).map { _ in alphabet.randomElement()! })
    }

    mutating func createDevice(_ input: DeviceInput) throws -> DeviceWithKey {
        guard input.isValid else { throw APIError.invalid("Invalid device name, camera id or role") }
        let cameraId = input.cameraId.trimmingCharacters(in: .whitespaces).lowercased()
        if deviceList.contains(where: { $0.cameraId == cameraId && !$0.disabled }) { throw APIError.conflict("Another active device already uses this camera id") }
        let id = String(nextId().prefix(16))
        let secret = Self.secret()
        let device = Device(id: id, name: input.name.trimmingCharacters(in: .whitespaces), cameraId: cameraId, role: input.role,
                            keyHint: "…" + secret.suffix(4), createdAt: Date(), disabled: false, online: false, lastSeenAt: nil,
                            lastStatus: nil, observations: 0, keyRotatedAt: nil)
        deviceList.append(device)
        return DeviceWithKey(device: device, deviceKey: "swd.demo.\(id).\(secret)")
    }

    mutating func rotateDevice(id: String) throws -> DeviceWithKey {
        guard let index = deviceList.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        let secret = Self.secret()
        deviceList[index].keyHint = "…" + secret.suffix(4)
        deviceList[index].keyRotatedAt = Date()
        return DeviceWithKey(device: deviceList[index], deviceKey: "swd.demo.\(id).\(secret)")
    }

    mutating func setDeviceDisabled(id: String, disabled: Bool) throws -> Device {
        guard let index = deviceList.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        if !disabled, deviceList.contains(where: { $0.id != id && !$0.disabled && $0.cameraId == deviceList[index].cameraId }) {
            throw APIError.conflict("Another active device already uses this camera id")
        }
        deviceList[index].disabled = disabled
        if disabled { deviceList[index].online = false }
        return deviceList[index]
    }

    func team() -> Team { Team(members: members, invitations: invitations, configured: [], you: "demo") }

    mutating func invite(email: String, role: Role) throws {
        guard let normalized = EmailAddress.normalize(email) else { throw APIError.invalid("Invalid email or role") }
        if invitations.contains(where: { $0.email == normalized }) || members.contains(where: { $0.email?.lowercased() == normalized }) {
            throw APIError.conflict("Already invited or already on the team")
        }
        invitations.insert(Invitation(id: nextId(), email: normalized, role: role, invitedAt: Date()), at: 0)
    }

    mutating func revokeInvitation(id: String) throws {
        guard invitations.contains(where: { $0.id == id }) else { throw APIError.notFound }
        invitations.removeAll { $0.id == id }
    }

    mutating func setMemberRole(subject: String, role: Role) throws {
        guard let index = members.firstIndex(where: { $0.subject == subject }) else { throw APIError.notFound }
        if members[index].role == .admin, role != .admin, members.filter({ $0.role == .admin }).count == 1 {
            throw APIError.conflict("A carwash needs at least one admin")
        }
        members[index].role = role
    }

    mutating func removeMember(subject: String) throws {
        if subject == "demo" { throw APIError.conflict("You can't remove yourself") }
        guard members.contains(where: { $0.subject == subject }) else { throw APIError.notFound }
        members.removeAll { $0.subject == subject }
    }

    
    // MARK: - Data

    static let defaultCatalog: Catalog = {
        func t(_ subtitle: String, _ tagline: String, _ items: [String]) -> [String: CatalogTranslation] {
            ["en": CatalogTranslation(name: nil, subtitle: subtitle, tagline: tagline, items: items)]
        }
        return Catalog(currency: "USD", locale: "es", vehicleClasses: [
            VehicleClass(id: "car", name: "Carro", translations: ["en": CatalogTranslation(name: "Car")]),
            VehicleClass(id: "suv", name: "Camioneta / SUV", translations: ["en": CatalogTranslation(name: "SUV")]),
            VehicleClass(id: "xl", name: "XL", translations: ["en": CatalogTranslation(name: "XL")]),
            VehicleClass(id: "pickup", name: "XXL / Pickup", translations: ["en": CatalogTranslation(name: "XXL / Pickup")]),
        ], packages: [
            ServicePackage(id: "quick", name: "Quick Spa", subtitle: "Limpieza básica", tagline: "Limpio, siempre listo",
                           items: ["Lavado exterior", "Llantas y neumáticos", "Ventanas", "Aspirado"],
                           prices: ["car": 10, "suv": 12, "xl": 14, "pickup": 16],
                           translations: t("Basic clean", "Clean, always ready", ["Exterior wash", "Rims and tires", "Windows", "Vacuum"])),
            ServicePackage(id: "essential", name: "Essential Spa", subtitle: "Limpieza + acabado", tagline: "Un paso más allá",
                           items: ["Todo lo de Quick", "Espuma activa", "Bordes de puertas", "Pasteado a mano", "Limpieza de tablero y consolas", "Aromatizante"],
                           prices: ["car": 15, "suv": 18, "xl": 21, "pickup": 24],
                           translations: t("Clean + finish", "One step further", ["Everything in Quick", "Snow foam", "Door jambs", "Hand polish", "Dashboard and console cleaning", "Air freshener"])),
            ServicePackage(id: "renew", name: "Renew Spa", subtitle: "Limpieza + renovación", tagline: "Renueva tu experiencia",
                           items: ["Todo lo de Essential", "Pasteado a máquina", "Prelavado sin contacto", "Tolvas", "Lavado de motor", "Aire en rendijas", "Hidratación interior"],
                           prices: ["car": 25, "suv": 30, "xl": 35, "pickup": 40],
                           translations: t("Clean + renewal", "Renew your experience", ["Everything in Essential", "Machine polish", "Touchless pre-wash", "Wheel wells", "Engine wash", "Air-blown vents and gaps", "Interior conditioning"])),
            ServicePackage(id: "supreme", name: "Supreme Spa", subtitle: "Cuidado + acabado premium", tagline: "El máximo cuidado",
                           items: ["Todo lo de Renew", "Cera líquida", "Detallado de rines", "Limpieza de puntas de escape"],
                           prices: ["car": 35, "suv": 40, "xl": 45, "pickup": 50],
                           translations: t("Premium care + finish", "The ultimate care", ["Everything in Renew", "Liquid wax", "Rim detailing", "Exhaust tip cleaning"])),
        ])
    }()

    /// A tiny valid JPEG (a gray frame with a plate-colored bar) used as the demo's camera photo.
    static let placeholderJPEG: Data = Data(base64Encoded: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlKKKK0ICiiigAooooAKKKKACiitXwvZ29/wCILW1u4/Mhk37lyRnCEjkc9RQBlUV6t/wh+gf8+H/kaT/4qj/hD9A/58P/ACNJ/wDFUuYdjymivVv+EP0D/nw/8jSf/FUf8IfoH/Ph/wCRpP8A4qjmCx5TRXQeNNNs9L1eKCxh8qNoA5XcW53MM8k+grn6YgrS8PahDpet297cK7RxbshACeVI7ketZtFAHpH/AAn+k/8APve/98J/8VR/wn+k/wDPve/98J/8VXm9FKyHdnpH/Cf6T/z73v8A3wn/AMVR/wAJ/pP/AD73v/fCf/FV5vRRZBdm34r1e31rU47m1SVESERkSAA5DMexPrWJRRTEf//Z")!
}
