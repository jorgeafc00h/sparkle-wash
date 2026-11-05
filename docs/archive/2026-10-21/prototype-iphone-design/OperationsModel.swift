import SwiftUI
import SwiftData
import GoogleSignIn
import GoogleSignInSwift

@MainActor
final class OperationsModel: ObservableObject {
    @Published private(set) var catalog: ServiceCatalogDTO?
    @Published private(set) var arrivals: [ArrivalDTO] = []
    @Published private(set) var jobs: [JobDTO] = []
    @Published private(set) var summary: JobSummaryDTO?
    @Published private(set) var employees: [EmployeeDTO] = []
    @Published private(set) var inventory: [InventoryDTO] = []
    @Published private(set) var role: String?
    @Published private(set) var savedAt: Date?
    @Published private(set) var isStale = true
    @Published private(set) var isLoading = false
    @Published var error: String?
    @Published private(set) var catalogIsStale = true
    @Published private(set) var catalogUpdatedAt: Date?
    @Published private(set) var isMutating = false
    private let session: URLSession
    private var token: String?
    private var endpoint = ""
    private var actionKeys: [String: String] = [:]

    init(session: URLSession = .shared) { self.session = session }

    var canChange: Bool { canOperate && !isStale && !isMutating }
    var pendingArrivals: [ArrivalDTO] {
        arrivals.filter { arrival in !jobs.contains(where: { $0.arrivalId == arrival.id }) }
    }
    var canOperate: Bool { role == "operator" || role == "admin" }
    var signedIn: Bool { token != nil }

    func connect(context: ModelContext, endpoint: String) {
        if self.endpoint != endpoint { restore(context: context, endpoint: endpoint) }
    }

    func restore(context: ModelContext, endpoint: String, preserveSession: Bool = false) {
        self.endpoint = endpoint
        if !preserveSession { token = nil; role = nil }
        catalogIsStale = true
        catalogUpdatedAt = nil
        catalog = nil
        arrivals = []
        jobs = []
        summary = nil
        employees = []
        inventory = []
        savedAt = nil
        isStale = true
        error = nil
        do {
            guard let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: { $0.endpoint == endpoint }) else { return }
            let decoder = JSONDecoder()
            let menu = try decoder.decode(ServiceCatalogDTO.self, from: record.catalogData)
            guard menu.isValid else { throw URLError(.cannotParseResponse) }
            self.catalog = menu
            catalogUpdatedAt = record.savedAt
            guard token != nil else { return }
            let arrivals = try decoder.decode([ArrivalDTO].self, from: record.arrivalsData)
            let jobs = try decoder.decode([JobDTO].self, from: record.jobsData)
            let summary = try decoder.decode(JobSummaryDTO.self, from: record.summaryData)
            let employees = try decoder.decode([EmployeeDTO].self, from: record.employeesData)
            let inventory = try decoder.decode([InventoryDTO].self, from: record.inventoryData)
            guard menu.isValid && arrivals.allSatisfy(\.isValid) && jobs.allSatisfy(\.isValid) &&
                    summary.isValid && inventory.allSatisfy(\.isValid) else { throw URLError(.cannotParseResponse) }
            self.arrivals = arrivals
            self.jobs = jobs
            self.summary = summary
            self.employees = employees
            self.inventory = inventory
            savedAt = record.savedAt
        } catch { self.error = "Saved operations could not be loaded: \(error.localizedDescription)" }
    }

    func refresh(context: ModelContext, endpoint: String) async {
        guard self.endpoint == endpoint, EndpointValidation.isValid(endpoint) else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let catalogData = try await request("/api/packages", endpoint: endpoint, authenticated: false)
            let menu = try JSONDecoder().decode(ServiceCatalogDTO.self, from: catalogData)
            guard menu.isValid else { throw URLError(.cannotParseResponse) }
            guard !Task.isCancelled, self.endpoint == endpoint else { return }
            catalog = menu
            catalogIsStale = false
            catalogUpdatedAt = Date()
            error = nil
            guard let sessionToken = token else { return }
            let arrivalsData = try await request("/api/arrivals", endpoint: endpoint)
            let jobsData = try await request("/api/jobs", endpoint: endpoint)
            let summaryData = try await request("/api/jobs/summary", endpoint: endpoint)
            let employeesData = try await request("/api/employees", endpoint: endpoint)
            let inventoryData = try await request("/api/inventory/items", endpoint: endpoint)
            let decoder = JSONDecoder()
            let incomingArrivals = try decoder.decode([ArrivalDTO].self, from: arrivalsData)
            let incomingJobs = try decoder.decode([JobDTO].self, from: jobsData)
            let incomingSummary = try decoder.decode(JobSummaryDTO.self, from: summaryData)
            let incomingEmployees = try decoder.decode([EmployeeDTO].self, from: employeesData)
            let incomingInventory = try decoder.decode([InventoryDTO].self, from: inventoryData)
            guard incomingArrivals.allSatisfy(\.isValid), incomingJobs.allSatisfy(\.isValid),
                  incomingSummary.isValid, incomingInventory.allSatisfy(\.isValid) else { throw URLError(.cannotParseResponse) }
            guard !Task.isCancelled, self.endpoint == endpoint, token == sessionToken else { return }
            arrivals = incomingArrivals
            jobs = incomingJobs
            summary = incomingSummary
            employees = incomingEmployees
            inventory = incomingInventory
            savedAt = Date()
            isStale = false
            error = nil
            do {
                if let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: { $0.endpoint == endpoint }) {
                    record.arrivalsData = arrivalsData
                    record.jobsData = jobsData
                    record.summaryData = summaryData
                    record.employeesData = employeesData
                    record.inventoryData = inventoryData
                    record.catalogData = catalogData
                    record.savedAt = savedAt!
                } else {
                    context.insert(CachedOperationsSnapshot(endpoint: endpoint, arrivalsData: arrivalsData, jobsData: jobsData,
                        summaryData: summaryData, employeesData: employeesData, inventoryData: inventoryData,
                        catalogData: catalogData, savedAt: savedAt!))
                }
                try context.save()
            } catch { self.error = "Operations loaded, but offline copy could not be saved: \(error.localizedDescription)" }
        } catch {
            guard !Task.isCancelled, self.endpoint == endpoint else { return }
            isStale = true
            catalogIsStale = true
            self.error = "Could not refresh operations: \(error.localizedDescription)"
        }
    }

    func exchangeGoogleToken(_ idToken: String, context: ModelContext, endpoint: String) async {
        guard EndpointValidation.isValid(endpoint), let url = URL(string: endpoint + "/api/auth/google") else { return }
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 12
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(["idToken": idToken])
            let (data, response) = try await self.session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
            let session = try JSONDecoder().decode(StaffSessionDTO.self, from: data)
            guard !session.sessionToken.isEmpty, ["viewer", "operator", "admin"].contains(session.role) else { throw URLError(.cannotParseResponse) }
            guard self.endpoint == endpoint, !Task.isCancelled else { return }
            token = session.sessionToken
            role = session.role
            error = nil
            restore(context: context, endpoint: endpoint, preserveSession: true)
            await refresh(context: context, endpoint: endpoint)
        } catch { self.error = "Staff sign-in failed: \(error.localizedDescription)" }
    }

    func signOut() async {
        let previousToken = token
        let previousEndpoint = endpoint
        GIDSignIn.sharedInstance.signOut()
        token = nil
        role = nil
        arrivals = []
        jobs = []
        summary = nil
        employees = []
        inventory = []
        actionKeys.removeAll()
        isStale = true
        error = nil
        if let previousToken, let url = URL(string: previousEndpoint + "/api/auth/session") {
            var request = URLRequest(url: url)
            request.httpMethod = "DELETE"
            request.timeoutInterval = 8
            request.setValue("Bearer \(previousToken)", forHTTPHeaderField: "Authorization")
            _ = try? await self.session.data(for: request)
        }
    }

    func confirmAndOpen(_ arrival: ArrivalDTO, plate: String, vehicleClass: String, packageId: String,
                        context: ModelContext, endpoint: String) async {
        guard canChange else { return }
        isMutating = true
        error = nil
        defer { isMutating = false }
        do {
            if arrival.confirmedPlate == nil {
                _ = try await mutate("/api/arrivals/\(arrival.id)/confirm", body: ["plate": plate, "vehicleClass": vehicleClass],
                    key: "confirm-\(arrival.id)", endpoint: endpoint)
            }
            _ = try await mutate("/api/jobs", body: ["arrivalId": arrival.id, "packageId": packageId],
                key: "open-\(arrival.id)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch { self.error = "Could not open job: \(error.localizedDescription)" }
    }

    func transition(_ job: JobDTO, to status: String, context: ModelContext, endpoint: String) async {
        guard canChange else { return }
        isMutating = true
        error = nil
        defer { isMutating = false }
        do {
            _ = try await mutate("/api/jobs/\(job.id)/transition", body: ["status": status],
                key: "\(status)-\(job.id)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch { self.error = "Could not update job: \(error.localizedDescription)" }
    }

    func assign(_ employeeId: String, to job: JobDTO, context: ModelContext, endpoint: String) async {
        guard canChange else { return }
        isMutating = true
        error = nil
        defer { isMutating = false }
        do {
            _ = try await mutate("/api/jobs/\(job.id)/employees", body: ["employeeId": employeeId],
                key: "assign-\(job.id)-\(employeeId)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch { self.error = "Could not assign employee: \(error.localizedDescription)" }
    }

    private func request(_ path: String, endpoint: String, authenticated: Bool = true) async throws -> Data {
        guard let url = URL(string: endpoint + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        if authenticated {
            guard let token else { throw URLError(.userAuthenticationRequired) }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await self.session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    private func mutate(_ path: String, body: [String: String], key: String, endpoint: String) async throws -> Data {
        guard self.endpoint == endpoint, canOperate, !isStale, let token, let url = URL(string: endpoint + path) else { throw URLError(.userAuthenticationRequired) }
        let operationKey = actionKeys[key] ?? UUID().uuidString
        actionKeys[key] = operationKey
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(operationKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await self.session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        actionKeys.removeValue(forKey: key)
        return data
    }
}

