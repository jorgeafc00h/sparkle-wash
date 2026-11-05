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
    private var token: String?
    private var endpoint = ""
    private var actionKeys: [String: String] = [:]

    var canOperate: Bool { role == "operator" || role == "admin" }
    var signedIn: Bool { token != nil }

    func restore(context: ModelContext, endpoint: String, preserveSession: Bool = false) {
        self.endpoint = endpoint
        if !preserveSession { token = nil; role = nil }
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
            catalog = menu
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
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
            let session = try JSONDecoder().decode(StaffSessionDTO.self, from: data)
            guard !session.sessionToken.isEmpty, ["viewer", "operator", "admin"].contains(session.role) else { throw URLError(.cannotParseResponse) }
            token = session.sessionToken
            role = session.role
            error = nil
            restore(context: context, endpoint: endpoint, preserveSession: true)
            await refresh(context: context, endpoint: endpoint)
        } catch { self.error = "Staff sign-in failed: \(error.localizedDescription)" }
    }

    func signOut() {
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
    }

    func confirmAndOpen(_ arrival: ArrivalDTO, plate: String, vehicleClass: String, packageId: String,
                        context: ModelContext, endpoint: String) async {
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
        do {
            _ = try await mutate("/api/jobs/\(job.id)/transition", body: ["status": status],
                key: "\(status)-\(job.id)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch { self.error = "Could not update job: \(error.localizedDescription)" }
    }

    func assign(_ employeeId: String, to job: JobDTO, context: ModelContext, endpoint: String) async {
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
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    private func mutate(_ path: String, body: [String: String], key: String, endpoint: String) async throws -> Data {
        guard let token, let url = URL(string: endpoint + path) else { throw URLError(.userAuthenticationRequired) }
        let operationKey = actionKeys[key] ?? UUID().uuidString
        actionKeys[key] = operationKey
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(operationKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        actionKeys.removeValue(forKey: key)
        return data
    }
}

struct OperationsView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("apiBaseUrl") private var endpoint = "http://localhost:8080"
    @StateObject private var model = OperationsModel()

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        statusView
                        if !model.signedIn { signInSection }
                        if let summary = model.summary {
                            summarySection(summary)
                            if geometry.size.width >= 900 && !dynamicTypeSize.isAccessibilitySize {
                                HStack(alignment: .top, spacing: 20) {
                                    VStack(alignment: .leading, spacing: 20) { arrivalsSection; jobsSection }.frame(maxWidth: .infinity)
                                    VStack(alignment: .leading, spacing: 20) { employeeSection; inventorySection }.frame(width: geometry.size.width * 0.34)
                                }
                            } else { arrivalsSection; jobsSection; employeeSection; inventorySection }
                        }
                        packageSection
                    }
                    .frame(maxWidth: 1200, alignment: .leading)
                    .padding()
                    .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Workboard")
            .toolbar {
                if model.signedIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Sign out") { model.signOut() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh(context: context, endpoint: endpoint) } }
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(model.isLoading)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: { Label("Settings", systemImage: "gearshape") }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .task(id: endpoint) {
                model.restore(context: context, endpoint: endpoint)
                while !Task.isCancelled {
                    await model.refresh(context: context, endpoint: endpoint)
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
    }

    private var statusView: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.isLoading { ProgressView("Refreshing operations") }
            else if model.isStale { Text("Saved operations · offline or sign-in required").fontWeight(.semibold) }
            else { Text("API checked \(model.savedAt?.formatted(date: .omitted, time: .shortened) ?? "")") }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }

    private var signInSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Staff access").font(.title2).fontWeight(.semibold)
            if let ids = GoogleClientSettings.current {
                GoogleSignInButton {
                    Task { await signIn(ids) }
                }
                .frame(maxWidth: 260, minHeight: 44)
                .accessibilityLabel("Sign in with Google for SparkleWash staff")
            } else {
                Text("Google sign-in is not configured for this iOS build. Set the iOS and server client IDs and reversed URL scheme.")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func signIn(_ ids: GoogleClientSettings) async {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
              let controller = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
            model.error = "Could not open Google sign-in."
            return
        }
        do {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: ids.ios, serverClientID: ids.server)
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: controller)
            let user = try await result.user.refreshTokensIfNeeded()
            guard let token = user.idToken?.tokenString else { throw URLError(.userAuthenticationRequired) }
            await model.exchangeGoogleToken(token, context: context, endpoint: endpoint)
        } catch { model.error = "Google sign-in failed: \(error.localizedDescription)" }
    }

    private func summarySection(_ summary: JobSummaryDTO) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Whole-carwash jobs").font(.title2).fontWeight(.semibold)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                metric("Active work", summary.inProgress)
                metric("Waiting", summary.arrived + summary.queued)
                metric("Completed today UTC", summary.completedTodayUtc)
                metric("Average site minutes", (summary.averageCompletedSeconds ?? 0) / 60)
            }
        }
    }

    private func metric(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(label).font(.subheadline).foregroundStyle(.secondary); Text(value.formatted()).font(.title).bold() }
            .frame(maxWidth: .infinity, alignment: .leading).padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
    }

    private var arrivalsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Arrivals to review").font(.title2).fontWeight(.semibold)
            let pending = model.arrivals.filter { arrival in !model.jobs.contains(where: { $0.arrivalId == arrival.id }) }
            if pending.isEmpty { Text("No arrivals waiting for a job.").foregroundStyle(.secondary) }
            ForEach(pending) { arrival in
                NavigationLink {
                    ArrivalReviewView(model: model, arrival: arrival, endpoint: endpoint)
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(arrival.confirmedPlate ?? arrival.plateCandidate ?? "Unreadable plate").font(.headline)
                        Text("Camera \(arrival.cameraId) · \(arrival.confirmedPlate == nil ? "Needs review" : "Confirmed")")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if let confidence = arrival.confidence { Text("Candidate confidence \(Int(confidence * 100))%") }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Review arrival \(arrival.plateCandidate ?? "unreadable plate")")
            }
        }
    }

    private var jobsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Jobs").font(.title2).fontWeight(.semibold)
            if model.jobs.isEmpty { Text("No vehicle jobs yet.").foregroundStyle(.secondary) }
            ForEach(model.jobs) { job in
                NavigationLink { JobDetailView(model: model, job: job, endpoint: endpoint) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack { Text(job.plate).font(.headline); Spacer(); Text(job.status.replacingOccurrences(of: "_", with: " ")).font(.caption).bold() }
                        Text("\(job.packageName) · $\(job.priceUsd.formatted()) · \(job.vehicleClass.uppercased())")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Text("Time on site \(job.elapsedSeconds / 60) min · \(job.assignments.count) assigned")
                            .font(.subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Job \(job.plate), \(job.status), \(job.elapsedSeconds / 60) minutes on site")
            }
        }
    }

    private var employeeSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Employees").font(.title2).fontWeight(.semibold)
            if model.employees.isEmpty { Text("No employees added.").foregroundStyle(.secondary) }
            ForEach(model.employees) { employee in
                LabeledContent(employee.name, value: employee.active ? "Active" : "Inactive")
                    .padding().background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var inventorySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Resources and stock").font(.title2).fontWeight(.semibold)
            if model.inventory.isEmpty { Text("No compounds or supplies added.").foregroundStyle(.secondary) }
            ForEach(model.inventory) { stock in
                VStack(alignment: .leading, spacing: 4) {
                    Text(stock.item.name).font(.headline)
                    Text("\(stock.available.formatted()) \(stock.item.unit) available · \(stock.reserved.formatted()) reserved")
                    if stock.needsReorder { Text("Reorder needed").foregroundStyle(.orange).fontWeight(.semibold) }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding()
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var packageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Detailing packages").font(.title2).fontWeight(.semibold)
            if let catalog = model.catalog {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                    ForEach(catalog.packages) { package in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(package.name).font(.headline)
                            Text(package.subtitle).font(.subheadline).foregroundStyle(.secondary)
                            Text("Car $\(package.price(for: "car") ?? 0) · SUV $\(package.price(for: "suv") ?? 0)")
                            Text("XL $\(package.price(for: "xl") ?? 0) · Pickup $\(package.price(for: "pickup") ?? 0)")
                            Text("\(package.items.count) included services").font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding()
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            } else { Text("Loading service menu…") }
        }
    }
}

private struct GoogleClientSettings {
    let ios: String
    let server: String
    static var current: Self? {
        guard let ios = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              let server = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String,
              ios.contains(".apps.googleusercontent.com"), server.contains(".apps.googleusercontent.com") else { return nil }
        return Self(ios: ios, server: server)
    }
}

private struct ArrivalReviewView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: OperationsModel
    let arrival: ArrivalDTO
    let endpoint: String
    @State private var plate = ""
    @State private var vehicleClass = "car"
    @State private var packageId = "essential"

    var body: some View {
        Form {
            Section("Camera observation") {
                LabeledContent("Camera", value: arrival.cameraId)
                LabeledContent("Candidate", value: arrival.plateCandidate ?? "Unreadable")
                LabeledContent("Confidence", value: arrival.confidence.map { "\(Int($0 * 100))%" } ?? "Unavailable")
                Text("A candidate needs staff confirmation before a job is opened.").font(.footnote)
            }
            Section("Confirm vehicle") {
                TextField("Plate number", text: $plate).textInputAutocapitalization(.characters)
                    .autocorrectionDisabled().disabled(arrival.confirmedPlate != nil)
                Picker("Vehicle class", selection: $vehicleClass) {
                    ForEach(model.catalog?.vehicleClasses ?? [], id: \.id) { item in Text(item.name).tag(item.id) }
                }.disabled(arrival.vehicleClass != nil)
                Picker("Detailing package", selection: $packageId) {
                    ForEach(model.catalog?.packages ?? []) { item in Text(item.name).tag(item.id) }
                }
                if let package = model.catalog?.packages.first(where: { $0.id == packageId }), let price = package.price(for: vehicleClass) {
                    Text("Suggested \(package.name) · $\(price). Confirm choice before opening.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if model.canOperate {
                Button(arrival.confirmedPlate == nil ? "Confirm and open job" : "Open job") {
                    Task {
                        await model.confirmAndOpen(arrival, plate: plate, vehicleClass: vehicleClass,
                            packageId: packageId, context: context, endpoint: endpoint)
                        if model.error == nil { dismiss() }
                    }
                }
                .disabled(plate.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                .frame(minHeight: 44)
            }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("Review arrival")
        .onAppear { plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? ""; vehicleClass = arrival.vehicleClass ?? "car" }
    }
}

private struct JobDetailView: View {
    @Environment(\.modelContext) private var context
    @ObservedObject var model: OperationsModel
    let job: JobDTO
    let endpoint: String
    @State private var selectedEmployee = ""
    private var currentJob: JobDTO { model.jobs.first(where: { $0.id == job.id }) ?? job }

    var body: some View {
        Form {
            Section("Vehicle and time") {
                LabeledContent("Plate", value: currentJob.plate)
                LabeledContent("Status", value: currentJob.status.replacingOccurrences(of: "_", with: " "))
                LabeledContent("Time on site", value: "\(currentJob.elapsedSeconds / 60) min")
                LabeledContent("Package", value: currentJob.packageName)
                LabeledContent("Price", value: "$\(currentJob.priceUsd.formatted())")
            }
            Section("Service checklist") { ForEach(currentJob.services, id: \.self) { service in Text(service) } }
            Section("Employees") {
                if currentJob.assignments.isEmpty { Text("Unassigned").foregroundStyle(.secondary) }
                ForEach(currentJob.assignments, id: \.employeeId) { employee in Text(employee.employeeName) }
                if model.canOperate && currentJob.status != "completed" && currentJob.status != "cancelled" {
                    Picker("Assign employee", selection: $selectedEmployee) {
                        Text("Select employee").tag("")
                        ForEach(model.employees.filter(\.active)) { employee in Text(employee.name).tag(employee.id) }
                    }
                    Button("Assign") { Task { await model.assign(selectedEmployee, to: currentJob, context: context, endpoint: endpoint) } }
                        .disabled(selectedEmployee.isEmpty).frame(minHeight: 44)
                }
            }
            if model.canOperate {
                Section("Job controls") {
                    if currentJob.status == "arrived" { transitionButton("Queue job", "queued") }
                    if currentJob.status == "queued" { transitionButton("Start work", "in_progress") }
                    if currentJob.status == "in_progress" { transitionButton("Complete job", "completed") }
                }
            }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("Job \(job.plate)")
    }

    private func transitionButton(_ label: String, _ status: String) -> some View {
        Button(label) { Task { await model.transition(currentJob, to: status, context: context, endpoint: endpoint) } }
            .frame(minHeight: 44)
    }
}
