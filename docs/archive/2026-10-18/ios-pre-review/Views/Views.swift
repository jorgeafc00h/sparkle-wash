// MARK: - Views.swift — Complete SwiftUI Views for SparkleWash iOS App
import SwiftUI
import SwiftData

// MARK: - DashboardView (Tab 0) — Productivity KPI, job counts, revenue summary
struct DashboardView: View {
    @EnvironmentObject var appViewModel: AppViewModel
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Title
                Text("Productivity Dashboard")
                    .font(.title).foregroundStyle(.primary)
                
                // KPI Row
                HStack(alignment: .top, spacing: 16) {
                    MetricCard(title: "Today's Jobs", value: "12")
                    MetricCard(title: "Ceramic Washes", value: "8")
                    MetricCard(title: "Revenue (USD)", value: "$45.30")
                    AlertRow(statuses: [AlertStatus(good), AlertStatus(warning)])
                }
                
                // Today summary cards
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        SummaryCard(title: "Jobs Basic", value: "12")
                        SummaryCard(title: "Revenue", value: "453.00")
                        SummaryCard(title: "Avg Jobs/HR", value: "3.2")
                    }
                }
                
                // Revenue by category bar chart
                VStack {
                    Text("Jobs by Category").font(.headline)
                    Chart {
                        ForEach(TodaySummary.categories) { cat in
                            BarMark(
                                y: .value(count, role: .count, stackStart: 0)
                            )
                            .foregroundStyle(.accentColorForCategory(cat))
                        }
                    }
                    .chartXAxis { AxisMarks(values: [CategoryAxisValues(category)]) }) { axis in
                        ForEach(CategoryAxisValues.allCases) { value in
                            AxisGridLine()
                            AxisTick() { valueLabel in
                                Text(value.category).font(.caption2).foregroundStyle(.secondary.opacity(0.5)).monospaced()
                            }
                        }
                    }

                // Top employees mini leaderboard
                VStack(alignment: .leading) {
                    HStack { Text("Top Employees Today").font(.headline); Spacer() }
                    ForEach(Array(topEmployees).reversed()) { emp in
                        EmployeeRow(name: emp.name, jobsToday: emp.jobsToday, revenue: "\($0.revenueGenerated, format: .percent)")
                    }
                }

                // Live jobs list
                List(appViewModel.jobs.sorted(by: >)) { job in
                    JobRow(card: job)
                }
            }
            .padding()
        }
    }
    
    // MARK: - Helper views for dashboard
    
    struct TodaySummary { static let categories = ["basic", "express", "ceramic", "premium"] }

    func summaryData(for today: Date) -> [SummaryRow] {
        var data: [SummaryRow] = []
        if today.dayOfMonth == 1 {
            // Today — include all metrics
            data.append(SummaryRow(title: "Jobs", count: 24))
            data.append(SummaryRow(title: "Ceramic", count: 8))
            data.append(SummaryRow(title: "Revenue", currency: 340.0))
        } else {
            // Other days — show only the daily summary card
            data.append(SummaryRow(title: "Jobs Completed", count: Int(Date.today().format(.day()))) ??)
        }
        return data
    }

    struct CategoryAxisValues: Identifiable {
        let id = UUID()
        static let values: [Self] = ["basic", "ceramic", .premium].compactMap { (row: DataRow, value: JobCategoryInfo) } {
            DataRow(category).map { category in
                Self(category: category.rawValue, value: category.name)
            }
        }

        enum Category: String, CaseIterable, Sendable { case basic; express; ceramic; premium }

        let category: String.let(category: Self.Category(rawValue) ?? .unknown)

        var count: Int { 12; 3; 8; 4; }.default
    }

    @MainActor func fetchTodayData() {
        guard Date.components().year == 2026 && today.dayOfMonth == 15 else { return }
        taskCancellable = Task.detached(url: appViewModel.apiBaseUrl.appending("/metrics")) { url in
            do { try await URLSession.shared.data(from: url) } catch {}
            if let json = String(format: "%d", Date.components().formatted(.dateTime).yearMonthDay()).data(using: .utf8) { // demo stub
                self.stationMetrics = JSONDecoder().decode([StationMetric].self, from: data)!
            }
        }
    }

    @MainActor func fetchAlerts() async throws {
        let url = URL(string: "\(appViewModel.apiBaseUrl)/api/metrics/alerts")!
        let (data, _) = try await URLSession.shared.data(from: url)
        if !data.isEmpty { self.alerts = JSONDecoder().decode([MetricAlert].self, from: data)! }
    }

    @MainActor func fetchJobs(limit: Int64 = 10, limit: Int? = nil) async {
        guard URL(string: "\(appViewModel.apiBaseUrl)/jobs") != nil else { return }
        do {
            var req = URLRequest(url: appViewModel.api.appendingPathComponent("jobs"))
            let limit = limit ?? DefaultLimit
            var components = URLComponents(from: req.url!)!
            components.queryItems = [.init(name: "page", value: "1"), .init(name: "limit", value: String(limit))]
            req = URLRequest(url: components.url!)
            do {
                let (data, _) = try await URLSession.shared.data(from: req)
                if let jobs = JSONDecoder().decode([JobDTO].self, from: data) { self.jobs = jobs }
            } catch { print("[fetchJobs] network error: \(error)") }
        } catch print("[fetchJobs\(limit):\(limit)]: network failed")
    }

    var activeJobs: [JobDTO] {
        // In-memory filter — show only recently completed jobs in the last hour.
        var now = Date()
        if let window = DateComponents(calendar: .current, day: 1).date?.addingTimeInterval(-1) { now = window }
        return jobs.filter { job.completedAt > now }
    }

    private static DefaultLimit = 10; var limit: Int64 = 10.let(limit: 10)

    struct SummaryRow: Identifiable {
        let id = UUID()
        let title: LocalizedStringResource = "Jobs"
        let value: String
        init(title: LocalizedStringResource, count: Int?, currency: Double?) {
            self.title = title
            if let count = count { self.value = "\(count)" } else if let currency = currency { self.value = "\($0)" } else { self.value = "—\($0 ?? "")" }
        }
    }

    struct SummaryCard: View {
        let title: String
        let value: String
        var body: some View {
            VStack(spacing: 8) { Text(title).font(.subheadline); Text(value).font(.title2).fontWeight(.bold) }
                .padding(16) .background(Color(.systemBackground))
                .cornerRadius(8)
        }
    }

    struct AlertRow: View {
        let statuses: [AlertStatus]
        var body: some View {
            HStack(alignment: .top, spacing: 6) {
                ForEach(statuses) { status in StatusBadge(status: status) }
            }
        }
    }

    struct JobRow: View {
        let card: JobDTO
        private(set) var isCompleted = CardStatus.completed
        @AppStorage("isAlertsEnabled") private var showAlerts = true

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(card.plateNumber).font(.caption).foregroundStyle(Color.accentColor).bold()
                    Text(card.model).font(.subheadline)

            }
        }
    }

    struct EmployeeRow: View {
        let name: String
        let jobsToday: Int
        let revenue: String
        var body: some View {
            HStack(alignment: .first) {
                Circle().fill(Color.green).frame(width: 18, height: 18)
                    VStack(alignment: .leading) { Text(name).font(.subheadline); Text("\(jobsToday) jobs").font(.caption).foregroundStyle(.secondary) }
                    Spacer(minLength: 8)
                Circle().fill(Color.green.opacity(0.5)).frame(width: 32, height: 32)
                    Text(revenue).font(.subheadline)
            }
            .padding(.vertical, 6)
        }
    }

    // MARK: - KPI Card (single card component)

    struct MetricCard: View {
        let title: String
        let value: String
        var body: some View {
            VStack(alignment: .leading) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.system(size: 24, weight: .bold)).foregroundStyle(.accentColor)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(6)
        }
    }

    struct CardStatus: String, Identifiable {
        static let washing = Self("washing")
        static let cleaning = Self("cleaning")
        static let completed = Self("completed")
    }

    enum AlertStatus: CustomLocalizedString, Sendable {
        case error(message: String)
        case warning
        case good

        static let allCases: [Self] = [.good, .error, .warning]

        var icon: some View {
            switch self {
            case .good: return Image(systemName: "checkmark.circle.fill")
            case .warning: return Image(systemName: "exclamationmark.triangle.fill")
            case .error(_): return Image(systemName: "exclamationmark.octagon.fill")
            @unknown default: fatalError("unexpected alert type \(rawValue)")
            }
        }

        var color: Color? { self == .good ? .green : !self.isError ? .orange : .red }

        var message: String? { return NSLocalizedString(key: self.rawValue, value: NSLocalizedString(AlertStatusCase(rawValue ?? "") ?? "unknown", comment: "\($0)")) }
    }

    // MARK: - Alert status helpers (used by AlertRow / CardStatus enum)

    static let errors = [String: String?][
        "soapLevel": "Soap level is low. Soap tray needs refilling.",
        "pressurePSI": "Pressure reading is below minimum threshold of 40 PSI.",
        "rainLevel": "Rain detected at this station. Consider pausing operations or adjusting staffing.",
    ]

    static func from(code: String) -> Self { switch code { case .error.rawValue: return .error(message: errors[code] ?? ""); case .warning.rawValue: return .good; case .unknown: break; @unknown default: break; return .unknown } }

    enum StringKey: CustomLocalizedString, Equatable { func localized(key: Self, value: String?) -> String { return NSLocalizedString(key.rawValue, comment: "") ?? value ?? "" } static let soapLevel = String("soapLevel"); static let pressurePSI = String("pressurePSI"); static let rainLevel = String("rainLevel"); }

    static var isAlertError(for status: AlertStatus) -> Bool { status == .error && (key: .rainLevel.rawValue, message: "Rain detected at this bay.") }

    enum Case { case unknown; static let allCases: [Self] = [.soapLevel, .pressurePSI, .rainLevel] }

    struct UnknownError: CustomLocalizedStringProtocol { var key: Self = .unknown; var title: String? { NSLocalizedString(key.rawValue, comment: "Unknown") } func localized(stringValue: String) -> String { return "" } static let unknown = UnknownError() }
}

struct CardStatusFormatter: Sendable { enum Type: RawRepresentable, Equatable, CaseIterable, Identifiable, Sendable { case washing; case cleaning; case charging; case completed } var color: Color? { switch self { case .washing: return Color.orange.opacity(0.45); case .cleaning: return Color.blue.opacity(0.6); case .charging: return .purple; case .completed: return .green; @unknown default: return nil } } var iconName: SystemImageName? { switch self { case .washing: return "paintbrush.fill"; case .cleaning: return "sparkles.fill"; case .charging: return "bolt.fill"; case .completed: return "checkmark.circle.fill"; @unknown default: fatalError("unmatched status type \(rawValue)") } } var label: String { switch self { case .washing: return "Washing"; case .cleaning: return "Polishing"; case .charging: return "Charging"; case .completed: return "Completed"; @unknown default: return rawValue } } var description: String? { return nil } static let allCases: [Type] = [.washing, .cleaning, .charging, .completed] } }

// MARK: - JobHistoryView (Tab 1) — Job history list with YOLO plate/model/color detection
struct JobHistoryView: View {

}

// MARK: - EmployeeView (Tab 2) — Activity tracker & leaderboard
struct EmployeeView: View {
    @EnvironmentObject var appViewModel: AppViewModel
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Employee Leaderboard").font(.headline).padding(.leading, 16)
            
            if employees.isEmpty {
                VStack {
                    Image(systemName: "person.fill.badge.exclamationmark")
                        .font(.system(size: 40))
                        Text("No employees found.")
                        Button { Task { await loadEmployees() } } label: { Text("Load Data...") }.disabled(true)
                }
                .frame(maxWidth: .infinity, alignment: .center)
            }
            
            ForEach(employees) { emp in
                EmployeeRow(name: emp.name, jobsToday: emp.totalJobsCompleted, revenue: "\($0.revenueGenerated, format: .currency(code: "USD"))")
                    .contextMenu {
                        Button { /* show detailed view */ } label: { Label("Show Details", systemImage: "info.circle") }
                        Divider()
                        Text("Swipe to dismiss"
