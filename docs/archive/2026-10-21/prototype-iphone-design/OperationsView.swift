import SwiftUI
import SwiftData
import GoogleSignIn
import GoogleSignInSwift

// Semantic colors keep the same visual hierarchy in light and dark appearances.
enum WashStyle {
    static let accent = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.39, green: 0.85, blue: 0.75, alpha: 1)
        : UIColor(red: 0.02, green: 0.36, blue: 0.31, alpha: 1) })
    static let background = Color(.systemGroupedBackground)
    static let card = Color(.secondarySystemGroupedBackground)
    static let hero = Color(red: 0.025, green: 0.25, blue: 0.22)
}

enum WorkTab: String, CaseIterable {
    case overview = "Overview", jobs = "Jobs", team = "Team", packages = "Packages"
    var icon: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .jobs: "car.side"
        case .team: "person.2"
        case .packages: "sparkles"
        }
    }
}

enum JobFilter: String, CaseIterable {
    case active = "Active", completed = "Completed", all = "All jobs"
    func matches(_ job: JobDTO) -> Bool {
        switch self {
        case .active: !["completed", "cancelled"].contains(job.status)
        case .completed: job.status == "completed"
        case .all: true
        }
    }
}

@MainActor
struct OperationsView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var textSize
    @AppStorage("apiBaseUrl") private var endpoint = "http://localhost:8080"
    @StateObject private var model: OperationsModel
    @State private var selection: WorkTab = .overview
    @State private var showAccount = false
    @State private var jobFilter: JobFilter = .active
    @State private var search = ""
    @State private var teamSection = "Employees"
    @State private var vehicleClass = "car"

    init(model: OperationsModel = OperationsModel(), initialTab: WorkTab = .overview) {
        _model = StateObject(wrappedValue: model)
        _selection = State(initialValue: initialTab)
    }

    var body: some View {
        TabView(selection: $selection) {
            ForEach(WorkTab.allCases, id: \.self) { tab in
                NavigationStack {
                    content(for: tab)
                        .navigationTitle(tab == .overview ? "SparkleWash" : tab.rawValue)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button { showAccount = true } label: {
                                    Image(systemName: model.signedIn ? "person.crop.circle.fill" : "person.crop.circle")
                                        .font(.title3).frame(width: 44, height: 44)
                                }
                                .accessibilityLabel("Account and settings")
                            }
                        }
                }
                .tabItem { Label(tab.rawValue, systemImage: tab.icon) }
                .tag(tab)
            }
        }
        .tint(WashStyle.accent)
        .sheet(isPresented: $showAccount) {
            AccountView(model: model, endpoint: endpoint)
                .tint(WashStyle.accent)
        }
        .task(id: "\(endpoint)|\(scenePhase == .active)") {
            model.connect(context: context, endpoint: endpoint)
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh(context: context, endpoint: endpoint)
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    @ViewBuilder
    private func content(for tab: WorkTab) -> some View {
        switch tab {
        case .overview: overview
        case .jobs: jobs
        case .team: team
        case .packages: packages
        }
    }

    private func page<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24, content: content)
                .frame(maxWidth: 760, alignment: .leading)
                .padding(20).frame(maxWidth: .infinity)
        }
        .background(WashStyle.background)
        .refreshable { await model.refresh(context: context, endpoint: endpoint) }
    }

    private var overview: some View {
        page {
            VStack(alignment: .leading, spacing: 6) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("Every detail,\nin one place.")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if model.signedIn {
                connectionStatus
                if let summary = model.summary {
                    overviewSummary(summary)
                    sectionTitle("Arrivals to review", count: model.pendingArrivals.count)
                    if model.pendingArrivals.isEmpty {
                        EmptyCard(icon: "checkmark.circle", title: "You're all caught up", message: "New camera observations will appear here for staff review.")
                    }
                    ForEach(model.pendingArrivals) { arrival in arrivalLink(arrival) }
                    HStack {
                        Text("On the workboard").font(.title3.bold())
                        Spacer()
                        Button("See all") { selection = .jobs }.frame(minHeight: 44)
                    }
                    let active = model.jobs.filter { JobFilter.active.matches($0) }
                    if active.isEmpty { EmptyCard(icon: "car.side", title: "Ready for the next car", message: "Open a job after confirming an arrival.") }
                    ForEach(Array(active.prefix(3))) { job in jobLink(job) }
                } else if model.isLoading { ProgressView("Loading your workboard").frame(maxWidth: .infinity).padding() }
            } else {
                accessCard
                Button { selection = .packages } label: {
                    HStack(spacing: 16) {
                        Image(systemName: "sparkles").font(.title2).foregroundStyle(WashStyle.accent)
                            .frame(width: 48, height: 48).background(WashStyle.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Find the right finish").font(.headline)
                            Text("Explore our detailing packages").font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.secondary)
                    }.washCard()
                }.buttonStyle(.plain)
            }
            HStack(spacing: 12) {
                Image(systemName: "hand.raised.shield").foregroundStyle(WashStyle.accent)
                Text("Every arrival is reviewed by your team before work begins.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(.horizontal, 4)
        }
    }

    private var accessCard: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Image(systemName: "car.side.fill").font(.system(.title, design: .rounded))
                Spacer()
                Image(systemName: "sparkles").font(.title2).opacity(0.65)
            }.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text("Your next great\nworkday starts here.").font(.system(.title2, design: .rounded, weight: .bold))
                Text("Review arrivals, follow every job, and keep your team in sync.")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.85))
            }
            Button { showAccount = true } label: {
                HStack { Text("Staff access").fontWeight(.semibold); Spacer(); Image(systemName: "arrow.right") }
                    .padding(14).foregroundStyle(WashStyle.hero)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
        }
        .padding(24).foregroundStyle(.white)
        .background(WashStyle.hero, in: RoundedRectangle(cornerRadius: 24))
    }

    @ViewBuilder private var connectionStatus: some View {
        if let error = model.error {
            Label(error, systemImage: "exclamationmark.circle")
                .font(.subheadline).foregroundStyle(.red).washCard()
                .accessibilityIdentifier("operations-error")
        } else if model.isStale {
            Label("Saved view · reconnect to make changes", systemImage: "wifi.slash")
                .font(.subheadline).foregroundStyle(.secondary)
        } else if let savedAt = model.savedAt {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(WashStyle.accent)
                Text("Updated \(savedAt.formatted(date: .omitted, time: .shortened))")
                if model.isLoading { ProgressView().controlSize(.small) }
            }.font(.caption).foregroundStyle(.secondary)
        }
    }

    private func overviewSummary(_ summary: JobSummaryDTO) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("In progress").font(.subheadline).foregroundStyle(.white.opacity(0.85))
                    Text(summary.inProgress.formatted()).font(.system(.largeTitle, design: .rounded, weight: .bold)).monospacedDigit()
                }
                Spacer()
                Image(systemName: "car.side.fill").font(.largeTitle).accessibilityHidden(true)
            }.padding(24).foregroundStyle(.white)
                .background(WashStyle.hero, in: RoundedRectangle(cornerRadius: 22))
                .accessibilityElement(children: .combine)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    MetricCard(title: "Waiting", value: "\(summary.arrived + summary.queued)", icon: "clock")
                    MetricCard(title: "Done today¹", value: "\(summary.completedTodayUtc)", icon: "checkmark.circle")
                    MetricCard(title: "Avg. minutes", value: summary.averageCompletedSeconds.map { "\($0 / 60)" } ?? "—", icon: "timer")
                }
                VStack(spacing: 12) {
                    MetricCard(title: "Waiting", value: "\(summary.arrived + summary.queued)", icon: "clock")
                    MetricCard(title: "Done today¹", value: "\(summary.completedTodayUtc)", icon: "checkmark.circle")
                    MetricCard(title: "Avg. minutes", value: summary.averageCompletedSeconds.map { "\($0 / 60)" } ?? "—", icon: "timer")
                }
            }
            Text("¹ Today's completed jobs use the server's UTC day.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var jobs: some View {
        page {
            if model.signedIn {
                connectionStatus
                if textSize.isAccessibilitySize {
                    Picker("Job filter", selection: $jobFilter) {
                        ForEach(JobFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.menu)
                } else {
                    Picker("Job filter", selection: $jobFilter) {
                        ForEach(JobFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented)
                }
                let filtered = model.jobs.filter { jobFilter.matches($0) && (search.isEmpty || $0.plate.localizedCaseInsensitiveContains(search) || $0.packageName.localizedCaseInsensitiveContains(search)) }
                sectionTitle(jobFilter.rawValue, count: filtered.count)
                if filtered.isEmpty { EmptyCard(icon: "car.side", title: search.isEmpty ? "No jobs here yet" : "No matching jobs", message: search.isEmpty ? "Confirmed vehicle jobs will appear here." : "Try another plate or package name.") }
                ForEach(filtered) { job in jobLink(job) }
            } else { lockedWorkspace("Follow every job", message: "Sign in to see the queue, assign staff, and move cars through their detailing.", icon: "car.side") }
        }
        .searchable(text: $search, prompt: "Plate or package")
    }

    private var team: some View {
        page {
            if model.signedIn {
                connectionStatus
                if textSize.isAccessibilitySize {
                    Picker("Team section", selection: $teamSection) { Text("Employees").tag("Employees"); Text("Supplies").tag("Supplies") }.pickerStyle(.menu)
                } else {
                    Picker("Team section", selection: $teamSection) { Text("Employees").tag("Employees"); Text("Supplies").tag("Supplies") }.pickerStyle(.segmented)
                }
                if teamSection == "Employees" {
                    sectionTitle("Your team", count: model.employees.count)
                    if model.employees.isEmpty { EmptyCard(icon: "person.2", title: "No employees yet", message: "Employee records will appear here when added by an administrator.") }
                    ForEach(model.employees) { employee in
                        HStack(spacing: 14) {
                            if !textSize.isAccessibilitySize {
                                Text(employee.name.prefix(1).uppercased()).font(.headline)
                                    .frame(width: 46, height: 46).background(WashStyle.accent.opacity(0.10), in: Circle()).foregroundStyle(WashStyle.accent)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(employee.name).font(.headline)
                                let count = model.jobs.filter { JobFilter.active.matches($0) && $0.assignments.contains(where: { $0.employeeId == employee.id }) }.count
                                Text("\(count) active \(count == 1 ? "job" : "jobs")").font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(employee.active ? "Active" : "Inactive").font(.caption.weight(.semibold)).foregroundStyle(employee.active ? WashStyle.accent : .secondary)
                        }.washCard().accessibilityElement(children: .combine)
                    }
                } else {
                    sectionTitle("Supplies", count: model.inventory.count)
                    if model.inventory.isEmpty { EmptyCard(icon: "shippingbox", title: "Stock will appear here", message: "Track available quantities and reorder alerts for your supplies.") }
                    ForEach(model.inventory) { stock in stockCard(stock) }
                }
            } else { lockedWorkspace("A team in sync", message: "Staff sign-in gives you access to employee assignments and available supplies.", icon: "person.2") }
        }
    }

    private var packages: some View {
        page {
            VStack(alignment: .leading, spacing: 8) {
                Text("A little care.\nA lasting shine.").font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                Text("Four levels of detail. Choose your vehicle to see its price.").font(.subheadline).foregroundStyle(.secondary)
            }
            VehiclePicker(selection: $vehicleClass)
            if let catalog = model.catalog {
                if model.catalogIsStale { Label("Saved menu · prices may have changed", systemImage: "wifi.slash").font(.footnote).foregroundStyle(.secondary) }
                ForEach(catalog.packages) { package in
                    NavigationLink {
                        PackageDetailView(package: package, vehicleClass: vehicleClass)
                    } label: { PackageCard(package: package, vehicleClass: vehicleClass) }.buttonStyle(.plain)
                }
                Text("Prices in USD · Final package confirmed by staff.").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            } else if let error = model.error {
                EmptyCard(icon: "wifi.exclamationmark", title: "Menu unavailable", message: error)
                Button("Try again") { Task { await model.refresh(context: context, endpoint: endpoint) } }.buttonStyle(.borderedProminent)
            } else { ProgressView("Loading packages").padding().frame(maxWidth: .infinity) }
        }
    }

    private func lockedWorkspace(_ title: String, message: String, icon: String) -> some View {
        VStack(spacing: 24) {
            EmptyCard(icon: icon, title: title, message: message)
            Button("Staff access") { showAccount = true }.buttonStyle(.borderedProminent).controlSize(.large)
        }.padding(.top, 32)
    }

    private func sectionTitle(_ title: String, count: Int) -> some View {
        HStack { Text(title).font(.title3.bold()); Spacer(); Text(count.formatted()).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary) }
            .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }

    private func arrivalLink(_ arrival: ArrivalDTO) -> some View {
        NavigationLink { ArrivalReviewView(model: model, arrival: arrival, endpoint: endpoint) } label: {
            HStack(spacing: 14) {
                Image(systemName: "viewfinder").font(.title2).foregroundStyle(WashStyle.accent)
                    .frame(width: 48, height: 48).background(WashStyle.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 5) {
                    Text(arrival.confirmedPlate ?? arrival.plateCandidate ?? "Unreadable plate").font(.headline.monospaced())
                    Text(arrival.confirmedPlate == nil ? "Needs your review" : "Confirmed · ready for a job").font(.subheadline).foregroundStyle(.secondary)
                    Text("Camera \(arrival.cameraId)").font(.caption).foregroundStyle(.secondary)
                    if let confidence = arrival.confidence { Text("\(Int(confidence * 100))% candidate confidence").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.secondary)
            }.washCard()
        }.buttonStyle(.plain)
    }

    private func jobLink(_ job: JobDTO) -> some View {
        NavigationLink { JobDetailView(model: model, job: job, endpoint: endpoint) } label: { JobCard(job: job) }.buttonStyle(.plain)
    }

    private func stockCard(_ stock: InventoryDTO) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                Label(stock.item.name, systemImage: "shippingbox").font(.headline)
                Spacer(minLength: 4)
                if stock.needsReorder { Label("Reorder", systemImage: "exclamationmark.circle").font(.caption.bold()).foregroundStyle(.orange) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(stock.available.formatted()).font(.system(.title2, design: .rounded, weight: .bold))
                Text("\(stock.item.unit) available").font(.subheadline).foregroundStyle(.secondary)
            }
            Divider()
            Text("\(stock.onHand.formatted()) on hand · \(stock.reserved.formatted()) reserved")
                .font(.caption).foregroundStyle(.secondary)
        }.washCard().accessibilityElement(children: .combine)
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let icon: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon).foregroundStyle(WashStyle.accent)
            Text(value).font(.system(.title2, design: .rounded, weight: .bold)).monospacedDigit()
            Text(title).font(.caption).foregroundStyle(.secondary).fixedSize()
        }.frame(maxWidth: .infinity, alignment: .leading).washCard(padding: 16)
            .accessibilityElement(children: .combine)
    }
}

private struct EmptyCard: View {
    let icon: String
    let title: String
    let message: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon).font(.title).foregroundStyle(WashStyle.accent).accessibilityHidden(true)
            Text(title).font(.title3.bold())
            Text(message).font(.subheadline).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).washCard(padding: 24)
    }
}

struct JobStatusBadge: View {
    let status: String
    var title: String {
        switch status { case "in_progress": "In progress"; case "arrived": "Arrived"; case "queued": "Queued"; case "completed": "Completed"; case "cancelled": "Cancelled"; default: status }
    }
    var color: Color { switch status { case "completed": WashStyle.accent; case "in_progress": .blue; case "cancelled": .secondary; default: .orange } }
    var body: some View {
        Text(title).font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 6)
            .foregroundStyle(color).background(color.opacity(0.1), in: Capsule()).fixedSize(horizontal: false, vertical: true)
    }
}

struct JobCard: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let job: JobDTO
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if textSize.isAccessibilitySize {
                Text(job.plate).font(.title3.monospaced().bold())
                JobStatusBadge(status: job.status)
            } else {
                HStack { Text(job.plate).font(.title3.monospaced().bold()); Spacer(); JobStatusBadge(status: job.status) }
            }
            Text("\(job.packageName) · \(job.vehicleClass.uppercased())").font(.subheadline).foregroundStyle(.secondary)
            Divider()
            ViewThatFits(in: .horizontal) {
                HStack { Label("\(job.elapsedSeconds / 60) min on site", systemImage: "clock"); Spacer(); Text(job.priceUsd, format: .currency(code: "USD")).fontWeight(.semibold) }
                VStack(alignment: .leading, spacing: 8) { Label("\(job.elapsedSeconds / 60) min on site", systemImage: "clock"); Text(job.priceUsd, format: .currency(code: "USD")) }
            }.font(.subheadline)
            if !job.assignments.isEmpty { Label(job.assignments.map(\.employeeName).joined(separator: ", "), systemImage: "person").font(.caption).foregroundStyle(.secondary) }
            else { Label("Unassigned", systemImage: "person.badge.plus").font(.caption).foregroundStyle(.secondary) }
        }.washCard()
    }
}

private struct VehiclePicker: View {
    @Binding var selection: String
    var body: some View {
        Menu {
            Picker("Vehicle class", selection: $selection) {
                Text("Car").tag("car"); Text("SUV").tag("suv"); Text("XL").tag("xl"); Text("Pickup").tag("pickup")
            }
        } label: {
            HStack { Image(systemName: "car.side"); Text("Vehicle").foregroundStyle(.secondary); Spacer(); Text(selection == "car" ? "Car" : selection == "pickup" ? "Pickup" : selection.uppercased()).fontWeight(.semibold); Image(systemName: "chevron.up.chevron.down").font(.caption.bold()) }
                .font(.subheadline).washCard(padding: 16)
        }.accessibilityLabel("Vehicle class").accessibilityValue(selection)
    }
}

struct PackageCard: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let package: ServicePackageDTO
    let vehicleClass: String
    var icon: String { switch package.id { case "quick": "drop"; case "essential": "sparkles"; case "renew": "sun.max"; default: "crown" } }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Image(systemName: icon).font(.system(size: 20, weight: .medium)).foregroundStyle(WashStyle.accent).frame(width: 40, height: 40).background(WashStyle.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 12)); Spacer(); Image(systemName: "arrow.up.right").font(.subheadline).foregroundStyle(.secondary) }.accessibilityHidden(true)
            if textSize.isAccessibilitySize {
                packageName
                price
            } else { HStack(alignment: .top) { packageName; Spacer(); price } }
            Divider()
            Text(package.items.prefix(2).joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            Text("\(package.items.count) included services").font(.caption.weight(.semibold)).foregroundStyle(WashStyle.accent)
        }.washCard(padding: 20)
    }
    private var packageName: some View {
        VStack(alignment: .leading, spacing: 5) { Text(package.name).font(.title3.bold()); Text(package.subtitle).font(.subheadline).foregroundStyle(.secondary) }
    }
    private var price: some View {
        Text(package.price(for: vehicleClass) ?? 0, format: .currency(code: "USD").precision(.fractionLength(0)))
            .font(.system(.title, design: .rounded, weight: .bold)).foregroundStyle(WashStyle.accent)
    }
}

private struct PackageDetailView: View {
    let package: ServicePackageDTO
    @State var vehicleClass: String
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VehiclePicker(selection: $vehicleClass)
                PackageCard(package: package, vehicleClass: vehicleClass)
                VStack(alignment: .leading, spacing: 16) {
                    Text("Everything included").font(.title3.bold())
                    ForEach(package.items, id: \.self) { item in
                        Label { Text(item).frame(maxWidth: .infinity, alignment: .leading) } icon: { Image(systemName: "checkmark").foregroundStyle(WashStyle.accent) }
                        if item != package.items.last { Divider() }
                    }
                }.washCard()
                Text("Your team confirms the vehicle class, package, and final price before opening a job.").font(.footnote).foregroundStyle(.secondary)
            }.frame(maxWidth: 760).padding(20).frame(maxWidth: .infinity)
        }.background(WashStyle.background).navigationTitle(package.name).navigationBarTitleDisplayMode(.inline)
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

private struct AccountView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @ObservedObject var model: OperationsModel
    let endpoint: String
    @State private var signingIn = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("SparkleWash", systemImage: "sparkles").font(.title2.bold()).foregroundStyle(WashStyle.accent).padding(.vertical, 8)
                    if model.signedIn {
                        LabeledContent("Access", value: model.role?.capitalized ?? "Staff")
                        Text("Your permissions are managed by your carwash administrator.").font(.subheadline).foregroundStyle(.secondary)
                        Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                    } else {
                        Text("Staff access").font(.headline)
                        Text("Use your approved Google account to access arrivals, jobs, and team information.").font(.subheadline).foregroundStyle(.secondary)
                        if let ids = GoogleClientSettings.current {
                            GoogleSignInButton { Task { await signIn(ids) } }.frame(minHeight: 44).disabled(signingIn)
                        } else {
                            Label("Staff sign-in hasn't been enabled for this installation. Contact your administrator.", systemImage: "info.circle").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
                Section("Preferences") { NavigationLink { SettingsView() } label: { Label("Connection settings", systemImage: "network") } }
            }
            .navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
    private func signIn(_ ids: GoogleClientSettings) async {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
              let controller = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { model.error = "Could not open Google sign-in."; return }
        signingIn = true
        defer { signingIn = false }
        do {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: ids.ios, serverClientID: ids.server)
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: controller)
            let user = try await result.user.refreshTokensIfNeeded()
            guard let token = user.idToken?.tokenString else { throw URLError(.userAuthenticationRequired) }
            await model.exchangeGoogleToken(token, context: context, endpoint: endpoint)
            if model.signedIn { dismiss() }
        } catch { model.error = "Google sign-in failed: \(error.localizedDescription)" }
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
                if let date = arrival.receivedDate { LabeledContent("Received", value: date.formatted(date: .abbreviated, time: .shortened)) }
                Label("Confirm the plate and vehicle before opening a job.", systemImage: "person.badge.shield.checkmark").font(.footnote).foregroundStyle(.secondary)
            }
            Section("Vehicle") {
                TextField("Plate number", text: $plate).textInputAutocapitalization(.characters).autocorrectionDisabled().disabled(arrival.confirmedPlate != nil)
                Picker("Vehicle class", selection: $vehicleClass) {
                    ForEach(model.catalog?.vehicleClasses ?? [], id: \.id) { Text($0.name).tag($0.id) }
                }.disabled(arrival.vehicleClass != nil)
            }
            Section("Detailing package") {
                Picker("Package", selection: $packageId) { ForEach(model.catalog?.packages ?? []) { Text($0.name).tag($0.id) } }
                if let package = model.catalog?.packages.first(where: { $0.id == packageId }), let price = package.price(for: vehicleClass) {
                    LabeledContent("Confirmed price", value: price.formatted(.currency(code: "USD")))
                    Text("Essential is the initial suggestion. Choose the package that fits this vehicle.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            if model.canOperate {
                Section {
                    Button {
                        Task {
                            await model.confirmAndOpen(arrival, plate: plate, vehicleClass: vehicleClass, packageId: packageId, context: context, endpoint: endpoint)
                            if model.error == nil { dismiss() }
                        }
                    } label: { HStack { Text(model.isMutating ? "Opening job…" : arrival.confirmedPlate == nil ? "Confirm & open job" : "Open job"); Spacer(); Image(systemName: "arrow.right") }.frame(minHeight: 44) }
                        .disabled(!model.canChange || plate.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                }
            }
            if model.isStale { Section { Label("Reconnect before making changes.", systemImage: "wifi.slash").foregroundStyle(.secondary) } }
            if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
        }.navigationTitle("Review arrival").navigationBarTitleDisplayMode(.inline)
            .onAppear { plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? ""; vehicleClass = arrival.vehicleClass ?? "car" }
    }
}

struct JobDetailView: View {
    @Environment(\.modelContext) private var context
    @ObservedObject var model: OperationsModel
    let job: JobDTO
    let endpoint: String
    @State private var selectedEmployee = ""
    @State private var confirmCancel = false
    private var currentJob: JobDTO { model.jobs.first(where: { $0.id == job.id }) ?? job }
    private var isOpen: Bool { JobFilter.active.matches(currentJob) }
    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    Text(currentJob.plate).font(.system(.largeTitle, design: .monospaced, weight: .bold))
                    JobStatusBadge(status: currentJob.status)
                    Text("\(currentJob.packageName) · \(currentJob.vehicleClass.uppercased())").foregroundStyle(.secondary)
                }.padding(.vertical, 8)
                LabeledContent("Time on site", value: "\(currentJob.elapsedSeconds / 60) min")
                if let active = currentJob.activeSeconds { LabeledContent("Active work", value: "\(active / 60) min") }
                LabeledContent("Package price") { Text(currentJob.priceUsd, format: .currency(code: "USD")) }
            }
            if model.canOperate && isOpen {
                Section("Next step") {
                    if currentJob.status == "arrived" { transitionButton("Queue job", "queued", "clock") }
                    if currentJob.status == "queued" { transitionButton("Start detailing", "in_progress", "play.circle") }
                    if currentJob.status == "in_progress" { transitionButton("Complete job", "completed", "checkmark.circle") }
                }
            }
            Section("Assigned team") {
                if currentJob.assignments.isEmpty { Label("No one assigned yet", systemImage: "person.badge.plus").foregroundStyle(.secondary) }
                ForEach(currentJob.assignments, id: \.employeeId) { Label($0.employeeName, systemImage: "person.crop.circle") }
                if model.canOperate && isOpen {
                    let available = model.employees.filter { employee in employee.active && !currentJob.assignments.contains(where: { $0.employeeId == employee.id }) }
                    if available.isEmpty { Text("No other active employees available.").font(.subheadline).foregroundStyle(.secondary) }
                    else {
                        Picker("Add employee", selection: $selectedEmployee) { Text("Select employee").tag(""); ForEach(available) { Text($0.name).tag($0.id) } }
                        Button("Assign employee") { Task { await model.assign(selectedEmployee, to: currentJob, context: context, endpoint: endpoint); if model.error == nil { selectedEmployee = "" } } }
                            .disabled(selectedEmployee.isEmpty || !model.canChange).frame(minHeight: 44)
                    }
                }
            }
            Section {
                ForEach(currentJob.services, id: \.self) { Label($0, systemImage: "checkmark").foregroundStyle(.primary) }
            } header: { Text("Included services") } footer: { Text("Saved with this job's package. Individual service completion is not tracked.") }
            if model.canOperate && isOpen { Section { Button("Cancel job", role: .destructive) { confirmCancel = true }.disabled(!model.canChange).frame(minHeight: 44) } }
            if model.isStale { Section { Label("Saved view · reconnect to make changes", systemImage: "wifi.slash").foregroundStyle(.secondary) } }
            if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("Job details").navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Cancel job for \(currentJob.plate)?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel job", role: .destructive) { Task { await model.transition(currentJob, to: "cancelled", context: context, endpoint: endpoint) } }
            Button("Keep job", role: .cancel) { }
        }
    }
    private func transitionButton(_ label: String, _ status: String, _ icon: String) -> some View {
        Button { Task { await model.transition(currentJob, to: status, context: context, endpoint: endpoint) } } label: {
            Label(model.isMutating ? "Updating job…" : label, systemImage: icon).fontWeight(.semibold).frame(minHeight: 44)
        }.disabled(!model.canChange)
    }
}

private extension View {
    func washCard(padding: CGFloat = 20) -> some View {
        self.padding(padding).background(WashStyle.card, in: RoundedRectangle(cornerRadius: 20))
    }
}
