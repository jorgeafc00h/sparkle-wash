// MARK: - SparkleWash App Entry Point
import SwiftUI
import SwiftData

@main
struct SparkleWashApp: App {
    @Environment(\.modelContext) private var modelContext
    
    let appViewModel = AppViewModel()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appViewModel)
                .modelContainer(for: [JobModel.self, EmployeeModel.self, DailyStatsModel.self])
        }
    }
}

// MARK: - Main ContentView (Tab Navigator)
struct ContentView: View {
    @EnvironmentObject var appViewModel: AppViewModel
    
    var body: some View {
        TabView {
            DashboardView(appViewModel: appViewModel)
                .tabItem { Label(systemImage: "chart.bar.fill", title: "Dashboard") }
            
            JobHistoryView(appViewModel: appViewModel)
                .tabItem { Label(systemImage: "square.and.arrow.up.fill", title: "Job History") }
                .accessibilityAdditiveLabels("Job history with YOLO plate detection")
            
            EmployeeView(appViewModel: appViewModel)
                .tabItem { Label(systemImage: "person.crop.circle.badge.checkmark.fill", title: "Employees") }
            
            StationView(appViewModel: appViewModel)
                .tabItem { Label(systemImage: "building.2.broken", title: "Stations") }
        }
    }
}

// MARK: - AppViewModel
@Observable final class AppViewModel {
    var stationMetrics = [StationMetric]()
    var alerts = [MetricAlert]()
    var jobs: [JobDTO] = []
    var activeEmployee: EmployeeModel?
    
    private var pollingTimer: DispatchSourceTimer?
    
    init() {
        startPolling(interval: 1)
    }
    
    deinit {
        stopPolling()
    }
}

extension AppViewModel {
    func startPolling(interval: TimeInterval = 5.0) {
        var timer: DispatchSourceTimer?
        var lastPollTime = Date()
        
        pollingTimer = DispatchSource.makeTimerSource(queue: .main, interval: interval) {
            let now = Date()
            let delta = now.timeIntervalSince(lastPollTime)
            
            if delta > 12.0 && !self.isPolling {
                self.isPolling = true
                Task { @MainActor [weak self] in
                    await self.fetchLiveMetrics()
                    await self.fetchAlerts()
                    await self.fetchJobs(limit: 10)
                    self.lastPollTime = Date()
                }
            } else if delta > 2.0 {
                fetchMetricsOrFallback()
            }
            
            self.lastPollTime = now
        }
        
        pollingTimer?.fire()
    }
    
    func stopPolling() {
        pollingTimer?.cancel()
        pollingTimer = nil
    }
}

// MARK: - JobDTO
struct JobDTO: Codable {
    let action: String
    let stationId: UUID?
    let plateNumber: String?
    let model: String?
    let color: String?
    let category: String?
    let durationMs: Int64?
    let revenue: Double?
    let status: String
}

// MARK: - API Request Models (for posting data to the webserver)
struct CarWashRequest: Encodable {
    var action: CameraAction
    var stationId: UUID?
    var photos: [String] = []
    var rainLevelMills: UInt16 = 0
    var waterLevelMills: UInt16 = 0
}

// File: sparklewash_app/SparkleWashApp.swift — complete app source
