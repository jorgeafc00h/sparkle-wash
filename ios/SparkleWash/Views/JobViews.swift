import SparkleKit
import SwiftUI

struct JobListView: View {
    @Binding var selection: String?
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t

    private static let columns: [JobStatus] = [.arrived, .queued, .inProgress, .completed]

    var body: some View {
        let _ = model.engine?.revision
        let jobs = (model.engine?.store.jobs() ?? []).filter {
            $0.status != .cancelled && ($0.status != .completed || $0.completedAt.map(Calendar.current.isDateInToday) == true)
        }
        List(selection: $selection) {
            SyncBanner().listRowSeparator(.hidden)
            ForEach(Self.columns, id: \.self) { status in
                let items = jobs.filter { $0.status == status }
                SwiftUI.Section {
                    if items.isEmpty { Text(t("board.hint.\(status.rawValue)")).font(.callout).foregroundStyle(.secondary) }
                    ForEach(items) { job in
                        JobRow(job: job).tag(job.id).accessibilityIdentifier("job-\(job.plate)")
                    }
                } header: {
                    Label("\(t.status(status)) · \(items.count)", systemImage: status.symbol).foregroundStyle(status.tint)
                }
            }
        }
        .navigationTitle(t("board.title"))
        .refreshable { await model.engine?.sync() }
    }
}

struct JobRow: View {
    let job: Job
    @Environment(Localizer.self) private var t

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    PlateChip(plate: job.plate)
                    Text(job.packageName).font(.subheadline.weight(.semibold))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(Durations.short(elapsed(at: context.date))).font(.caption.monospacedDigit())
                        .foregroundStyle(job.status == .inProgress && elapsed(at: context.date) > 45 * 60 ? .orange : .secondary)
                    Text(t.money(job.priceUsd, currency: job.currency)).font(.caption.weight(.semibold))
                }
            }
        }
    }

    private func elapsed(at now: Date) -> Int {
        guard job.status.isOpen else { return job.elapsedSeconds }
        let start = job.status == .inProgress ? (job.startedAt ?? job.arrivalAt) : job.arrivalAt
        return max(0, Int(now.timeIntervalSince(start)))
    }
}

struct JobDetailView: View {
    let jobId: String
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var confirmCancel = false

    var body: some View {
        let _ = model.engine?.revision
        if let job = model.engine?.store.jobs().first(where: { $0.id == jobId }) { content(job) }
        else { DetailPlaceholder(symbol: "rectangle.split.3x1", text: t("ios.select.job")) }
    }

    private var canOperate: Bool { model.session?.canOperate == true }

    @ViewBuilder private func content(_ job: Job) -> some View {
        let catalog = model.engine?.store.document(Catalog.self, "catalog") ?? DemoBackend.defaultCatalog
        let exit = model.engine?.store.arrivals().first { $0.jobId == job.id && $0.cameraRole == .exit }
        let employees = (model.engine?.store.employees() ?? []).filter { employee in employee.active && !job.assignments.contains { $0.employeeId == employee.id } }
        List {
            SwiftUI.Section {
                HStack {
                    PlateChip(plate: job.plate, large: true)
                    Spacer()
                    StatusBadge(status: job.status)
                }
                if job.status == .inProgress, let exit {
                    Label(t("board.seenLeaving", ["time": t.clock(exit.capturedAt)]), systemImage: "rectangle.portrait.and.arrow.right")
                        .foregroundStyle(.green).accessibilityIdentifier("exit-hint")
                }
                LabeledContent(t("review.package"), value: job.packageName)
                LabeledContent(t("ios.job.vehicle"), value: catalog.vehicleClasses.first { $0.id == job.vehicleClass }?.localizedName(t.language) ?? job.vehicleClass)
                LabeledContent(t("ios.job.price"), value: t.money(job.priceUsd, currency: job.currency))
            }
            if job.isProvisional {
                SwiftUI.Section {
                    Label(t("ios.job.provisional"), systemImage: "icloud.and.arrow.up").foregroundStyle(.orange)
                        .accessibilityIdentifier("provisional-note")
                }
            }
            if canOperate && job.status.isOpen && !job.isProvisional {
                SwiftUI.Section {
                    if let next = job.status.next {
                        Button {
                            Task { await model.engine?.perform(.transition(jobId: job.id, to: next)) }
                        } label: {
                            Label(t("action.\(job.status.rawValue)"), systemImage: "arrow.right.circle.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent).tint(.brand).controlSize(.large)
                        .accessibilityIdentifier("advance-button")
                    }
                    Button(t("board.cancel"), role: .destructive) { confirmCancel = true }
                        .confirmationDialog(t("board.cancelConfirm", ["plate": job.plate]), isPresented: $confirmCancel, titleVisibility: .visible) {
                            Button(t("board.cancel"), role: .destructive) { Task { await model.engine?.perform(.transition(jobId: job.id, to: .cancelled)) } }
                        }
                }
            }
            SwiftUI.Section(t("ios.job.assigned")) {
                if job.assignments.isEmpty { Text(t("board.nobody")).foregroundStyle(.secondary) }
                ForEach(job.assignments, id: \.employeeId) { assignment in Label(assignment.employeeName, systemImage: "person") }
                if canOperate && job.status.isOpen && !job.isProvisional && !employees.isEmpty {
                    Menu {
                        ForEach(employees) { employee in
                            Button(employee.name) { Task { await model.engine?.perform(.assign(jobId: job.id, employeeId: employee.id)) } }
                        }
                    } label: { Label(t("board.assign"), systemImage: "person.badge.plus") }
                    .accessibilityIdentifier("assign-menu")
                }
            }
            SwiftUI.Section(t("ios.job.services")) {
                ForEach(job.services, id: \.self) { Text($0) }
            }
            SwiftUI.Section(t("ios.job.history")) {
                ForEach(Array(job.transitions.enumerated()).reversed(), id: \.offset) { _, transition in
                    HStack {
                        Label(t.status(transition.status), systemImage: transition.status.symbol).foregroundStyle(transition.status.tint)
                        Spacer()
                        Text(t.clock(transition.at)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle(job.plate)
    }
}
