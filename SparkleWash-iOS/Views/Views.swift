import SwiftUI
import SwiftData

@MainActor
final class DashboardModel: ObservableObject {
    @Published private(set) var stations: [StationDTO] = []
    @Published private(set) var alerts: [AlertDTO] = []
    @Published private(set) var savedAt: Date?
    @Published private(set) var source = "unknown"
    @Published private(set) var isStale = true
    @Published private(set) var isLoading = true
    @Published private(set) var error: String?
    @Published private(set) var refreshHistory: [String] = []
    private var activeEndpoint = ""

    func restore(context: ModelContext, endpoint: String) {
        activeEndpoint = endpoint
        stations = []
        alerts = []
        savedAt = nil
        source = "unknown"
        refreshHistory = []
        isStale = true
        isLoading = true
        error = nil
        do {
            guard let record = try context.fetch(FetchDescriptor<CachedSnapshot>()).first(where: { $0.endpoint == endpoint }) else { return }
            stations = try JSONDecoder().decode([StationDTO].self, from: record.stationsData)
            alerts = try JSONDecoder().decode([AlertDTO].self, from: record.alertsData)
            savedAt = record.savedAt
            source = record.source
            isLoading = false
        } catch {
            self.error = "Saved data could not be loaded: \(error.localizedDescription)"
        }
    }

    func refresh(context: ModelContext, endpoint: String) async {
        guard activeEndpoint == endpoint, EndpointValidation.isValid(endpoint) else { return }
        do {
            let base = endpoint.hasSuffix("/") ? String(endpoint.dropLast()) : endpoint
            var stationRequest = URLRequest(url: URL(string: base + "/api/metrics")!)
            stationRequest.timeoutInterval = 8
            var alertRequest = URLRequest(url: URL(string: base + "/api/metrics/alerts")!)
            alertRequest.timeoutInterval = 8
            let (stationData, stationResponse) = try await URLSession.shared.data(for: stationRequest)
            let (alertData, alertResponse) = try await URLSession.shared.data(for: alertRequest)
            guard (stationResponse as? HTTPURLResponse)?.statusCode == 200,
                  (alertResponse as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let decodedStations = try JSONDecoder().decode([StationDTO].self, from: stationData)
            let decodedAlerts = try JSONDecoder().decode([AlertDTO].self, from: alertData)
            guard decodedStations.allSatisfy(\.isValid), decodedAlerts.allSatisfy(\.isValid),
                  Set(decodedStations.map(\.stationId)).count == decodedStations.count else { throw URLError(.cannotParseResponse) }
            guard !Task.isCancelled, activeEndpoint == endpoint else { return }
            let now = Date()
            stations = decodedStations
            alerts = decodedAlerts
            savedAt = now
            source = (stationResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "X-SparkleWash-Data-Source") ?? "unknown"
            isStale = false
            isLoading = false
            error = nil
            refreshHistory.insert("\(now.formatted(date: .omitted, time: .shortened)): refreshed \(stations.count) stations", at: 0)
            refreshHistory = Array(refreshHistory.prefix(20))
            do {
                if let record = try context.fetch(FetchDescriptor<CachedSnapshot>()).first(where: { $0.endpoint == endpoint }) {
                    record.stationsData = stationData
                    record.alertsData = alertData
                    record.savedAt = now
                    record.source = source
                } else {
                    context.insert(CachedSnapshot(endpoint: endpoint, stationsData: stationData, alertsData: alertData, savedAt: now, source: source))
                }
                try context.save()
            } catch {
                self.error = "Readings loaded, but could not be saved: \(error.localizedDescription)"
            }
        } catch {
            guard !Task.isCancelled, activeEndpoint == endpoint else { return }
            isStale = true
            isLoading = false
            self.error = "Could not refresh station data: \(error.localizedDescription)"
        }
    }
}

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("apiBaseUrl") private var apiBaseUrl = "http://localhost:8080"
    @StateObject private var model = DashboardModel()

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        statusView
                        if geometry.size.width >= 900 && !dynamicTypeSize.isAccessibilitySize {
                            HStack(alignment: .top, spacing: 20) {
                                stationSection.frame(maxWidth: .infinity)
                                VStack(alignment: .leading, spacing: 20) { alertSection; historySection }
                                    .frame(width: max(280, geometry.size.width * 0.30))
                            }
                        } else {
                            stationSection
                            alertSection
                            historySection
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .navigationTitle("Station dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        Task { await model.refresh(context: modelContext, endpoint: apiBaseUrl) }
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Refresh station data")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: { Label("Settings", systemImage: "gearshape") }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .task(id: apiBaseUrl) {
                model.restore(context: modelContext, endpoint: apiBaseUrl)
                while !Task.isCancelled {
                    await model.refresh(context: modelContext, endpoint: apiBaseUrl)
                    try? await Task.sleep(for: .seconds(3))
                }
            }
        }
    }

    private var statusView: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.isLoading { ProgressView("Loading stations") }
            else if model.isStale { Text("Saved data · offline or refresh failed").fontWeight(.semibold) }
            else { Text("API checked \(model.savedAt?.formatted(date: .omitted, time: .shortened) ?? "")") }
            if model.source == "demo" { Text("Demo readings").fontWeight(.semibold) }
            if model.source == "station-ingest" && model.stations.contains(where: { station in
                guard let date = station.reportedAt else { return true }
                return Date().timeIntervalSince(date) > 30
            }) { Text("Some stations have not reported in 30 seconds") }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }

    private var stationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Stations").font(.title2).fontWeight(.semibold)
            if model.stations.isEmpty && !model.isLoading { Text("No stations available.") }
            ForEach(model.stations) { station in
                VStack(alignment: .leading, spacing: 8) {
                    Text(station.name).font(.headline)
                    Text("Station \(station.stationId) · \(station.status)").foregroundStyle(.secondary)
                    LabeledContent("Pressure", value: "\(station.pressurePsi.formatted()) psi · \(station.pressureState)")
                    LabeledContent("Soap level", value: "\(station.soapLevelDm.formatted()) dm · \(station.soapState)")
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var alertSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.source == "demo" ? "Demo alerts" : "Alerts").font(.title2).fontWeight(.semibold)
            if model.alerts.isEmpty { Text("No alerts.") }
            ForEach(model.alerts) { alert in
                Text("\(alert.code): \(alert.value.formatted()) (threshold \(alert.threshold.formatted())) · \(alert.severity)")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Local refresh history").font(.title2).fontWeight(.semibold)
            if model.refreshHistory.isEmpty { Text("No refreshes this session.") }
            ForEach(model.refreshHistory, id: \.self) { entry in Text(entry) }
        }
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("apiBaseUrl") private var apiBaseUrl = "http://localhost:8080"
    @State private var draft = ""

    var body: some View {
        Form {
            Section("API server") {
                TextField("Server URL", text: $draft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .accessibilityLabel("API server URL")
                if !draft.isEmpty && !EndpointValidation.isValid(draft) {
                    Text("Enter an HTTP or HTTPS address without credentials, query, or fragment.")
                        .foregroundStyle(.red)
                }
                Text("The simulator can use localhost:8080. On a device, enter the server's reachable address.")
                    .font(.footnote)
                Button("Save server") { apiBaseUrl = draft.trimmingCharacters(in: .whitespacesAndNewlines); dismiss() }
                    .disabled(!EndpointValidation.isValid(draft))
                    .frame(minHeight: 44)
            }
        }
        .navigationTitle("Settings")
        .onAppear { draft = apiBaseUrl }
    }
}
