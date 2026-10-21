import SparkleKit
import SwiftUI

/// iPad: sidebar · list · detail, side by side. iPhone: the same columns collapse into a navigation stack.
struct MainSplitView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var visibility: NavigationSplitViewVisibility = .all
    @State private var selection = Selection()
    @State private var showingSettings = false

    /// What is selected in the content column of each section (drives the detail column).
    struct Selection {
        var arrivalId: String?
        var jobId: String?
        var plate: String?
        var stationId: String?
        var admin: AdminDestination?
    }

    private var sections: [AppSection] {
        AppSection.allCases.filter { $0 != .admin || model.session?.isAdmin == true }
    }

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $visibility) {
            List(selection: $model.section) {
                ForEach(sections) { section in
                    NavigationLink(value: section) {
                        Label(t(section.titleKey), systemImage: section.symbol)
                    }
                    .badge(section == .review ? pendingCount : 0)
                    .accessibilityIdentifier("section-\(section.rawValue)")
                }
            }
            .navigationTitle(model.session?.tenant.name ?? "SparkleWash")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingSettings = true } label: { Label(t("ios.settings"), systemImage: "person.crop.circle") }
                        .accessibilityIdentifier("settings-button")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let session = model.session {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.role(session.role)).font(.caption.weight(.semibold))
                        if let last = model.engine?.lastSync {
                            Text(t("ios.syncedAgo", ["ago": t.ago(last)])).font(.caption2).foregroundStyle(.secondary)
                        }
                        if model.isDemo { Pill(text: t("shell.demoData"), symbol: "flask", tint: .purple) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
            }
        } content: {
            content
                .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 480)
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .onChange(of: model.section) { selection = Selection() }
    }

    private var pendingCount: Int {
        _ = model.engine?.revision
        return model.engine?.store.pendingArrivals().count ?? 0
    }

    @ViewBuilder private var content: some View {
        switch model.section ?? .floor {
        case .floor: FloorView(selectedPlate: $selection.plate)
        case .review: ReviewListView(selection: $selection.arrivalId)
        case .board: JobListView(selection: $selection.jobId)
        case .plates: PlateListView(selection: $selection.plate)
        case .bays: BayListView(selection: $selection.stationId)
        case .admin: AdminMenuView(selection: $selection.admin)
        }
    }

    @ViewBuilder private var detail: some View {
        NavigationStack {
            switch model.section ?? .floor {
            case .floor, .plates:
                if let plate = selection.plate { PlateTimelineView(plate: plate) } else { DetailPlaceholder(symbol: "car", text: t("ios.select.plate")) }
            case .review:
                if let id = selection.arrivalId { ReviewDetailView(arrivalId: id) { selection.arrivalId = nil } }
                else { DetailPlaceholder(symbol: "viewfinder", text: t("ios.select.arrival")) }
            case .board:
                if let id = selection.jobId { JobDetailView(jobId: id) } else { DetailPlaceholder(symbol: "rectangle.split.3x1", text: t("ios.select.job")) }
            case .bays:
                if let id = selection.stationId { BayDetailView(stationId: id) } else { DetailPlaceholder(symbol: "gauge.with.dots.needle.50percent", text: t("ios.select.station")) }
            case .admin:
                if let destination = selection.admin { AdminDetailView(destination: destination) } else { DetailPlaceholder(symbol: "gearshape", text: t("ios.select.admin")) }
            }
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

    private func signOut() {
        dismiss()
        Task { await model.signOut() }
    }

    var body: some View {
        @Bindable var localizer = t
        NavigationStack {
            Form {
                if let session = model.session {
                    SwiftUI.Section(t("ios.account")) {
                        LabeledContent(t("register.name"), value: session.tenant.name)
                        LabeledContent(t("link.role"), value: t.role(session.role))
                        if let email = session.email { LabeledContent(t("team.email"), value: email) }
                    }
                }
                SwiftUI.Section(t("shell.language")) {
                    Picker(t("shell.language"), selection: $localizer.language) {
                        Text("Español").tag("es")
                        Text("English").tag("en")
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("language-picker")
                }
                if model.isDemo {
                    SwiftUI.Section {
                        Toggle(t("ios.offlineDemo"), isOn: Binding(get: { model.simulateOffline }, set: { model.simulateOffline = $0 }))
                            .accessibilityIdentifier("offline-toggle")
                    } footer: { Text(t("ios.offlineDemoHelp")) }
                }
                SwiftUI.Section {
                    Button(model.isDemo ? t("shell.exitDemo") : t("shell.signOut"), role: .destructive) {
                        if (model.engine?.pendingCount ?? 0) > 0 { confirmSignOut = true } else { signOut() }
                    }
                    .accessibilityIdentifier("sign-out-button")
                    .confirmationDialog(t("ios.signOutPending", ["count": model.engine?.pendingCount ?? 0]), isPresented: $confirmSignOut, titleVisibility: .visible) {
                        Button(model.isDemo ? t("shell.exitDemo") : t("shell.signOut"), role: .destructive) { signOut() }
                    }
                }
            }
            .navigationTitle(t("ios.settings"))
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() }.accessibilityIdentifier("settings-close") } }
        }
    }
}
