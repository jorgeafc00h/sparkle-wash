import SparkleKit
import SwiftUI

/// "En vivo": today's numbers, the camera feed and equipment alerts.
struct FloorView: View {
    @Binding var selectedPlate: String?
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var alerts: [StationAlert] = []

    var body: some View {
        let store = model.engine?.store
        let _ = model.engine?.revision
        let summary = store?.document(JobSummary.self, "summary")
        let sightings = Array((store?.arrivals() ?? []).prefix(30))
        List(selection: $selectedPlate) {
            SyncBanner().listRowSeparator(.hidden)
            SwiftUI.Section {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                    Kpi(title: t("floor.waiting"), value: "\(store?.pendingArrivals().count ?? 0)", symbol: "viewfinder", tint: .orange)
                    Kpi(title: t("floor.inBays"), value: summary.map { "\($0.onSite)" } ?? "—", symbol: "drop", tint: .brandSky)
                    Kpi(title: t("floor.doneToday"), value: summary.map { "\($0.doneToday)" } ?? "—", symbol: "checkmark.circle", tint: .green)
                    Kpi(title: t("floor.avgVisit"), value: Durations.short(summary?.averageCompletedSeconds), symbol: "timer", tint: .purple)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            }
            if !alerts.isEmpty {
                SwiftUI.Section(t("floor.equipment")) {
                    ForEach(Array(alerts.enumerated()), id: \.offset) { _, alert in
                        Label("\(t("alert.\(alert.code)")) · \(alert.value.formatted()) (\(t("floor.limit", ["value": alert.threshold.formatted()])))",
                              systemImage: "exclamationmark.triangle")
                            .foregroundStyle(alert.severity == "danger" ? .red : .orange)
                    }
                }
            }
            SwiftUI.Section(t("floor.feed")) {
                if sightings.isEmpty {
                    Text(t("floor.noPlatesBody")).foregroundStyle(.secondary)
                }
                ForEach(sightings) { sighting in
                    HStack(spacing: 12) {
                        Image(systemName: sighting.cameraRole == .exit ? "rectangle.portrait.and.arrow.right" : "camera")
                            .frame(width: 32, height: 32).background(Circle().fill(Color.secondary.opacity(0.12)))
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                PlateChip(plate: sighting.displayPlate)
                                if sighting.cameraRole == .exit { Pill(text: t("floor.leaving"), symbol: "arrow.right", tint: .green) }
                                else if sighting.jobId != nil { Pill(text: t("floor.onJob"), symbol: "link", tint: .brandSky) }
                                else if sighting.dismissedAt != nil { Pill(text: t("review.dismissed"), tint: .secondary) }
                                else if sighting.confirmedAt != nil { Pill(text: t("floor.confirmed"), tint: .green) }
                                else { Pill(text: t("floor.needsReview"), symbol: "viewfinder", tint: .orange) }
                            }
                            Text("\(t.camera(sighting.cameraId)) · \(t.ago(sighting.receivedAt))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .tag(sighting.displayPlate ?? "")
                }
            }
        }
        .navigationTitle(t("floor.title"))
        .refreshable { await model.engine?.sync() }
        .task { alerts = (try? await model.engine?.api.bays().alerts) ?? [] }
    }
}

struct Kpi: View {
    let title: String
    let value: String
    let symbol: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(.caption.weight(.semibold)).foregroundStyle(tint)
            Text(value).font(.title.weight(.bold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemGroupedBackground)))
        .accessibilityElement(children: .combine)
    }
}
