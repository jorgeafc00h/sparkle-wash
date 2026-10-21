import Foundation

public enum APIError: Error, Equatable, Sendable {
    /// 401: the session expired or was revoked (role change, removed from the team).
    case unauthorized
    case forbidden
    case notFound
    /// 409: someone already changed it, the step isn't allowed, or the idempotency key was reused differently.
    case conflict(String?)
    case invalid(String?)
    case unavailable
    case server(Int)
    /// No connection, timeout, DNS: the request may be retried later.
    case offline

    public static func from(status: Int, message: String?) -> APIError? {
        switch status {
        case 200..<300: nil
        case 400: .invalid(message)
        case 401: .unauthorized
        case 403: .forbidden
        case 404: .notFound
        case 409: .conflict(message)
        case 503: .unavailable
        default: .server(status)
        }
    }

    /// Network-level failures that make sense to retry (as opposed to the server saying no).
    public var isRetryable: Bool {
        switch self {
        case .offline, .unavailable: true
        case .server(let status): status >= 500
        default: false
        }
    }
}

/// Everything the app needs from the backend. Implemented by the HTTP client and the in-app demo.
public protocol SparkleAPI: Sendable {
    var isDemo: Bool { get }
    func session() async throws -> StaffSession
    func catalog() async throws -> Catalog
    func arrivals(pendingOnly: Bool, limit: Int) async throws -> [ArrivalObservation]
    func arrivalPhoto(id: String) async throws -> Data?
    func confirmArrival(id: String, plate: String, vehicleClass: String) async throws -> ArrivalObservation
    func dismissArrival(id: String, reason: DismissReason) async throws -> ArrivalObservation
    func openJob(arrivalId: String, packageId: String, idempotencyKey: String) async throws -> Job
    func jobs() async throws -> [Job]
    func jobSummary() async throws -> JobSummary
    func transitionJob(id: String, to status: JobStatus, idempotencyKey: String) async throws -> Job
    func assignEmployee(jobId: String, employeeId: String, idempotencyKey: String) async throws -> Job
    func employees() async throws -> [Employee]
    func addEmployee(name: String) async throws -> Employee
    func setEmployeeActive(id: String, active: Bool) async throws -> Employee
    func plateTimeline(_ plate: String) async throws -> PlateTimeline
    func bays() async throws -> Bays
    func tenant() async throws -> Tenant
    func updateTenant(_ input: TenantInput) async throws -> Tenant
    func devices() async throws -> [Device]
    func createDevice(_ input: DeviceInput) async throws -> DeviceWithKey
    func rotateDevice(id: String) async throws -> DeviceWithKey
    func setDeviceDisabled(id: String, disabled: Bool) async throws -> Device
    func team() async throws -> Team
    func invite(email: String, role: Role) async throws
    func revokeInvitation(id: String) async throws
    func setMemberRole(subject: String, role: Role) async throws
    func removeMember(subject: String) async throws
    func signOut() async
    /// Change notifications ("arrivals", "jobs") pushed by the server; ends on disconnect.
    func changes() -> AsyncThrowingStream<ChangeTopic, Error>
}

public struct ServerConfig: Sendable, Equatable {
    public var baseURL: URL
    public init(baseURL: URL) {
        // "https://api.example.com/" and "https://api.example.com" must build the same request URLs.
        var text = baseURL.absoluteString
        while text.hasSuffix("/") { text.removeLast() }
        self.baseURL = URL(string: text) ?? baseURL
    }
}

/// The live API over HTTPS with a staff bearer token.
public final class HTTPSparkleAPI: SparkleAPI, @unchecked Sendable {
    public let isDemo = false
    public let token: String
    private let config: ServerConfig
    private let session: URLSession
    private let decoder = SparkleJSON.decoder()
    private let encoder = SparkleJSON.encoder()

    public init(config: ServerConfig, token: String, session: URLSession = .shared) {
        self.config = config
        self.token = token
        self.session = session
    }

    // MARK: - Unauthenticated calls

    public static func signIn(config: ServerConfig, idToken: String, session: URLSession = .shared) async throws -> LoginResult {
        try await post(config: config, path: "/api/auth/google", body: ["idToken": idToken], session: session)
    }

    public static func register(config: ServerConfig, idToken: String, carwash: TenantInput, session: URLSession = .shared) async throws -> LoginResult {
        struct Body: Encodable { let idToken: String; let name: String; let city: String?; let country: String; let phone: String?; let timeZone: String }
        let c = carwash.cleaned
        return try await post(config: config, path: "/api/tenants/register",
                              body: Body(idToken: idToken, name: c.name, city: c.city, country: c.country, phone: c.phone, timeZone: c.timeZone),
                              session: session)
    }

    public static func registrationOpen(config: ServerConfig, session: URLSession = .shared) async -> Bool {
        struct Open: Decodable { let open: Bool }
        guard let (data, response) = try? await session.data(from: config.baseURL.appending(path: "/api/tenants/registration")),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
        return (try? JSONDecoder().decode(Open.self, from: data))?.open ?? false
    }

    private static func post<Body: Encodable, Response: Decodable>(config: ServerConfig, path: String, body: Body, session: URLSession) async throws -> Response {
        var request = URLRequest(url: config.baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try SparkleJSON.encoder().encode(body)
        let (data, response) = try await send(request, session: session)
        try check(response, data)
        return try SparkleJSON.decoder().decode(Response.self, from: data)
    }

    // MARK: - Plumbing

    static func send(_ request: URLRequest, session: URLSession) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.server(0) }
            return (data, http)
        } catch let error as URLError {
            throw error.code == .cancelled ? CancellationError() : APIError.offline
        }
    }

    static func check(_ response: HTTPURLResponse, _ data: Data) throws {
        struct ErrorBody: Decodable { let error: String? }
        let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        if let error = APIError.from(status: response.statusCode, message: message) { throw error }
    }

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], idempotencyKey: String? = nil) -> URLRequest {
        var url = config.baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        return request
    }

    private func call<Response: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], idempotencyKey: String? = nil) async throws -> Response {
        let (data, response) = try await Self.send(request(method, path, query: query, idempotencyKey: idempotencyKey), session: session)
        try Self.check(response, data)
        return try decoder.decode(Response.self, from: data)
    }

    private func call<Body: Encodable, Response: Decodable>(_ method: String, _ path: String, body: Body, idempotencyKey: String? = nil) async throws -> Response {
        var request = request(method, path, idempotencyKey: idempotencyKey)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await Self.send(request, session: session)
        try Self.check(response, data)
        return try decoder.decode(Response.self, from: data)
    }

    private func callIgnoringBody<Body: Encodable>(_ method: String, _ path: String, body: Body?) async throws {
        var request = request(method, path)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }
        let (data, response) = try await Self.send(request, session: session)
        try Self.check(response, data)
    }

    /// IDs, plates and subjects never contain '/', but never let one change the route. (`appending(path:)` percent-encodes the rest.)
    private static func segment(_ value: String) -> String { value.replacingOccurrences(of: "/", with: "") }

    // MARK: - SparkleAPI

    public func session() async throws -> StaffSession { try await call("GET", "/api/auth/session") }
    public func catalog() async throws -> Catalog { try await call("GET", "/api/packages") }

    public func arrivals(pendingOnly: Bool, limit: Int) async throws -> [ArrivalObservation] {
        var query = [URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100)))]
        if pendingOnly { query.append(URLQueryItem(name: "pending", value: "true")) }
        return try await call("GET", "/api/arrivals", query: query)
    }

    public func arrivalPhoto(id: String) async throws -> Data? {
        let (data, response) = try await Self.send(request("GET", "/api/arrivals/\(Self.segment(id))/photo"), session: session)
        if response.statusCode == 404 { return nil }
        try Self.check(response, data)
        return data
    }

    public func confirmArrival(id: String, plate: String, vehicleClass: String) async throws -> ArrivalObservation {
        try await call("POST", "/api/arrivals/\(Self.segment(id))/confirm", body: ["plate": plate, "vehicleClass": vehicleClass])
    }

    public func dismissArrival(id: String, reason: DismissReason) async throws -> ArrivalObservation {
        try await call("POST", "/api/arrivals/\(Self.segment(id))/dismiss", body: ["reason": reason.rawValue])
    }

    public func openJob(arrivalId: String, packageId: String, idempotencyKey: String) async throws -> Job {
        try await call("POST", "/api/jobs", body: ["arrivalId": arrivalId, "packageId": packageId], idempotencyKey: idempotencyKey)
    }

    public func jobs() async throws -> [Job] { try await call("GET", "/api/jobs") }
    public func jobSummary() async throws -> JobSummary { try await call("GET", "/api/jobs/summary") }

    public func transitionJob(id: String, to status: JobStatus, idempotencyKey: String) async throws -> Job {
        try await call("POST", "/api/jobs/\(Self.segment(id))/transition", body: ["status": status.rawValue], idempotencyKey: idempotencyKey)
    }

    public func assignEmployee(jobId: String, employeeId: String, idempotencyKey: String) async throws -> Job {
        try await call("POST", "/api/jobs/\(Self.segment(jobId))/employees", body: ["employeeId": employeeId], idempotencyKey: idempotencyKey)
    }

    public func employees() async throws -> [Employee] { try await call("GET", "/api/employees") }
    public func addEmployee(name: String) async throws -> Employee { try await call("POST", "/api/employees", body: ["name": name]) }

    public func setEmployeeActive(id: String, active: Bool) async throws -> Employee {
        try await call("POST", "/api/employees/\(Self.segment(id))/status", body: ["active": active])
    }

    public func plateTimeline(_ plate: String) async throws -> PlateTimeline { try await call("GET", "/api/plates/\(Self.segment(plate))/timeline") }
    public func bays() async throws -> Bays { try await call("GET", "/api/bays") }
    public func tenant() async throws -> Tenant { try await call("GET", "/api/tenant") }
    public func updateTenant(_ input: TenantInput) async throws -> Tenant { try await call("PUT", "/api/tenant", body: input.cleaned) }
    public func devices() async throws -> [Device] { try await call("GET", "/api/devices") }
    public func createDevice(_ input: DeviceInput) async throws -> DeviceWithKey { try await call("POST", "/api/devices", body: input) }
    public func rotateDevice(id: String) async throws -> DeviceWithKey { try await call("POST", "/api/devices/\(Self.segment(id))/rotate") }

    public func setDeviceDisabled(id: String, disabled: Bool) async throws -> Device {
        try await call("POST", "/api/devices/\(Self.segment(id))/status", body: ["disabled": disabled])
    }

    public func team() async throws -> Team { try await call("GET", "/api/team") }

    public func invite(email: String, role: Role) async throws {
        try await callIgnoringBody("POST", "/api/team/invitations", body: ["email": email, "role": role.rawValue])
    }

    public func revokeInvitation(id: String) async throws {
        try await callIgnoringBody("DELETE", "/api/team/invitations/\(Self.segment(id))", body: Optional<[String: String]>.none)
    }

    public func setMemberRole(subject: String, role: Role) async throws {
        try await callIgnoringBody("POST", "/api/team/members/\(Self.segment(subject))/role", body: ["role": role.rawValue])
    }

    public func removeMember(subject: String) async throws {
        try await callIgnoringBody("DELETE", "/api/team/members/\(Self.segment(subject))", body: Optional<[String: String]>.none)
    }

    public func signOut() async {
        _ = try? await Self.send(request("DELETE", "/api/auth/session"), session: session)
    }

    public func changes() -> AsyncThrowingStream<ChangeTopic, Error> {
        let request = request("GET", "/api/events")
        let session = session
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var streamRequest = request
                    streamRequest.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    streamRequest.timeoutInterval = 3600
                    let (bytes, response) = try await session.bytes(for: streamRequest)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if let error = APIError.from(status: status, message: nil) { throw error }
                    var parser = ServerSentEvents()
                    for try await line in bytes.lines {
                        if let topic = parser.feed(line) { continuation.yield(topic) }
                    }
                    continuation.finish()
                } catch let error as URLError {
                    continuation.finish(throwing: error.code == .cancelled ? CancellationError() : APIError.offline)
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Parses the API's Server-Sent Events: `event: change` + `data: {"topic":"jobs"}`; comments are heartbeats.
public struct ServerSentEvents: Sendable {
    public init() {}

    /// Feed one line (without the newline). Returns a topic when a data line names one.
    public mutating func feed(_ line: String) -> ChangeTopic? {
        guard line.hasPrefix("data:") else { return nil }
        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        struct Frame: Decodable { let topic: String }
        guard let frame = try? JSONDecoder().decode(Frame.self, from: Data(payload.utf8)) else { return nil }
        return ChangeTopic(rawValue: frame.topic)
    }
}
