import SparkleKit
import SwiftUI

struct PlateListView: View {
    @Binding var selection: String?
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var query = ""

    var body: some View {
        let _ = model.engine?.revision
        let recent = Array(NSOrderedSet(array: (model.engine?.store.arrivals() ?? []).compactMap(\.displayPlate))).compactMap { $0 as? String }
        let filtered = query.isEmpty ? recent : recent.filter { $0.contains(Plate.normalize(query) ?? query.uppercased()) }
        List(selection: $selection) {
            if let typed = Plate.normalize(query), !recent.contains(typed) {
                Label(t("plates.track") + " " + typed, systemImage: "magnifyingglass").tag(typed)
            }
            SwiftUI.Section(t("plates.recent")) {
                ForEach(filtered.prefix(40), id: \.self) { plate in PlateChip(plate: plate).tag(plate) }
            }
        }
        .searchable(text: $query, prompt: t("plates.number"))
        .textInputAutocapitalization(.characters)
        .navigationTitle(t("plates.title"))
    }
}

struct PlateTimelineView: View {
    let plate: String
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var timeline: PlateTimeline?
    @State private var error: String?

    var body: some View {
        List {
            if let timeline {
                SwiftUI.Section {
                    PlateChip(plate: timeline.plate, large: true)
                    if let open = timeline.openJob {
                        HStack { StatusBadge(status: open.status); Text(open.packageName).font(.headline) }
                        Text(t("plates.onSite", ["duration": Durations.short(open.elapsedSeconds)])).foregroundStyle(.secondary)
                    } else {
                        Pill(text: t("plates.noOpenJob"))
                    }
                    if let left = timeline.leftAt { Pill(text: t("plates.leftAt", ["time": t.clock(left)]), symbol: "arrow.right", tint: .green) }
                    LabeledContent(t("plates.visits"), value: "\(timeline.visits)")
                    LabeledContent(t("plates.spent"), value: t.money(timeline.jobs.filter { $0.status == .completed }.reduce(0) { $0 + $1.priceUsd }))
                    LabeledContent(t("plates.lastSeen"), value: t.ago(timeline.lastSeenAt))
                }
                SwiftUI.Section(t("plates.timeline")) {
                    ForEach(entries(timeline)) { entry in
                        HStack {
                            Image(systemName: entry.symbol).foregroundStyle(entry.tint).frame(width: 26)
                            VStack(alignment: .leading) {
                                Text(entry.title).font(.subheadline.weight(.semibold))
                                Text("\(t.clock(entry.at)) · \(t.ago(entry.at))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else if let error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(plate)
        .task(id: plate) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            timeline = try await model.engine?.api.plateTimeline(plate)
            error = nil
        } catch {
            self.error = t.error(error)
        }
    }

    struct Entry: Identifiable {
        let id: String
        let at: Date
        let title: String
        let symbol: String
        let tint: Color
    }

    private func entries(_ timeline: PlateTimeline) -> [Entry] {
        let sightings = timeline.sightings.map { s in
            Entry(id: "s-\(s.id)", at: s.capturedAt,
                  title: s.cameraRole == .exit ? t("plates.left", ["camera": t.camera(s.cameraId)]) : t("plates.seenBy", ["camera": t.camera(s.cameraId)]),
                  symbol: s.cameraRole == .exit ? "rectangle.portrait.and.arrow.right" : "camera", tint: s.cameraRole == .exit ? .green : .secondary)
        }
        let steps = timeline.jobs.flatMap { job in
            job.transitions.enumerated().map { index, transition in
                Entry(id: "t-\(job.id)-\(index)", at: transition.at, title: "\(t.status(transition.status)) · \(job.packageName)",
                      symbol: transition.status.symbol, tint: transition.status.tint)
            }
        }
        return (sightings + steps).sorted { $0.at > $1.at }
    }
}

struct BayListView: View {
    @Binding var selection: String?
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var bays: Bays?

    var body: some View {
        List(selection: $selection) {
            if let bays, bays.stations.isEmpty { ContentUnavailableView(t("bays.none"), systemImage: "gauge.with.dots.needle.0percent") }
            ForEach(bays?.stations ?? []) { station in
                HStack {
                    VStack(alignment: .leading) {
                        Text(station.name).font(.headline)
                        Text("\(station.pressurePsi.formatted()) psi · \(station.soapLevelDm.formatted()) dm").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Pill(text: t("bays.status.\(station.status)"), tint: station.status == "error" ? .red : station.status == "idle" ? .secondary : .brandSky)
                }
                .tag(station.stationId)
            }
        }
        .navigationTitle(t("bays.title"))
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async { bays = try? await model.engine?.api.bays() }
}

struct BayDetailView: View {
    let stationId: String
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var station: Station?

    var body: some View {
        List {
            if let station {
                SwiftUI.Section {
                    Gauge(value: min(station.pressurePsi, 100), in: 0...100) { Text(t("bays.pressure")) } currentValueLabel: { Text("\(station.pressurePsi.formatted()) psi") }
                        .tint(station.pressurePsi >= 45 && station.pressurePsi <= 60 ? .green : .orange)
                    Text(t("bays.pressureNormal", ["min": 45, "max": 60])).font(.caption).foregroundStyle(.secondary)
                    Gauge(value: min(station.soapLevelDm, 100), in: 0...100) { Text(t("bays.soap")) } currentValueLabel: { Text("\(station.soapLevelDm.formatted()) dm") }
                        .tint(station.soapLevelDm >= 35 ? .green : .orange)
                    Text(t("bays.soapRefill", ["low": 35])).font(.caption).foregroundStyle(.secondary)
                    LabeledContent("ID", value: station.stationId)
                    LabeledContent(t("plates.lastSeen"), value: t.ago(station.timestamp))
                }
            }
        }
        .navigationTitle(station?.name ?? stationId)
        .task(id: stationId) { station = try? await model.engine?.api.bays().stations.first { $0.stationId == stationId } }
    }
}
