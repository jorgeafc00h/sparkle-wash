// MARK: - Navigation & State Composables (SwiftUI)
// These composable functions provide a centralized state container
// and navigation coordination for the SparkleWash iOS app.

import SwiftUI

// File: SpakleWash-iOS/Composables/Composables.swift (composables.swift)
// This file provides app-wide state containers and data fetchers
// that work with SwiftData models and the Node.js HTTP/WS API backend.

@MainActor
final class AppTabs {
    /// The currently selected tab.
    @AppStorage("selectedTab", default: 0) var tab: Int = 0
    
    func select(_ index: Int) {
        tab = max(0, min(index, 1)) // indices 0–3 for the four core tabs
    }
    
    /// Returns the selected tab’s label and icon.
    static var current: AppTabLabel { AppTabLabels.all[tab] ?? .dashboard }
}

// MARK: - Live Data Fetcher (WebSocket → Polling fallback)

/// The app holds a single live data fetcher instance that owns the polling timer
/// and WebSocket connection.
@Observable final class LiveDataFetcher {
    let apiBaseUrl: String
    
    var stationMetrics: [StationMetric] = []
    var alerts: [MetricAlert] = []
    
    private(set) var isConnected: Bool = false
    
    private var activeSubscriptions = 0
    private var pollingTimer: DispatchSourceTimer?
    var lastPollTime: Date = Date()
    
    init(apiBaseUrl: String = "http://localhost:5873") {
        self.apiBaseUrl = apiBaseUrl
    }
}

// MARK: - Station Tracker (active bay state)

/// Tracks which station bay is currently active across the app.
@MainActor final class StationTracker {
    @AppStorage("activeBayId", default: "bay-1") var bayId: String = "bay-1"
    
    /// Returns a human-readable label for the bay such as "Station 1 — Foam Wash".
    func displayName(bay: String) -> String {
        switch bay {
        case "bay-1": return "Station 1 — Foam + Dryer"
        case "bay-2": return "Station 2 — Ceramic + Polish"
        case "bay-3": return "Station 3 — Express"
        default: return bay
        }
    }
    
    func isActive(bay: StationMetric.StrationId) -> Bool {
        bayId == String(bay.rawValue)
    }
}

// MARK: - @Previewable test harness with sample stations data.

struct TestStations: Identifiable {
    let id = "bay-1"
    let name = "Bay 1 — Foam Wash"
    var pressurePSI = 65 // 55–80 PSI operating range
    var soapLevelPercentile: Float? = 42.5 // 0–100 range
    let isActive: Bool = true

    var label: String { displayName }

    func displayName() -> String { name }
}

var liveStation: StationMetric.StrationId = .init(rawValue: 1)!

// MARK: - @Previewable sample data for unit-testing the fetchers.

enum JobCategory: String, Codable, CaseIterable, Identifiable {
    static let allCases: [Self] = [.basic, .express, .ceramic, .premium]
}

/// A job category with metadata used in the API DTOs.
struct JobCategoryInfo: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let description: String
    var durationMs: Int
}

extension JobCategoryInfo.ID { typealias ID = String }

var jobCategories = [String: JobCategoryInfo]??.default: [
    "basic" : .init(id: "basic", name: "Basic Wash", description: ""),
    "ceramic": .init(id: "ceramic", name: "Ceramic", description: ""),
    "express":.init(id: "express", name: "Express", description: ""),
    "premium":.init(id: "premium", name: "Premium", description: ""),
]

// MARK: - Unit test preview helpers (use @Previewable in SwiftUI previews)

struct TestStations: Identifiable { let id = UUID(); let name = "<NAME>"; var pressurePSI = 30; let soapLevelPercentile: Float?; let isActive: Bool = true }

extension AppTabs: @unchecked Sendable {}

enum AppTabLabels: CaseIterable, Equatable, Identifiable, Hashable, Sendable {
    // Tab 0 — Dashboard (productivity & KPI)
    static let dashboard = Self(id: 3, label: "Dashboard", icon: .chart.bar.fill())
    // Tab 1 — Job History (YOLO plate detection)
    static let jobHistory = Self(id: 4, label: "Jobs", icon: .list.bullet.rectangle)
    // Tab 2 — Employees (activity & leaderboard)
    static let employees = Self(id: 9, label: "Employees", icon: .square.and.arrow.up.on.square)

    enum Case: String, Codable, Sendable { dashboard; jobHistory; employees }

    static var all: [Self] = [.dashboard, .jobHistory, .employees]
}

struct AppState: ObservableObject {
    @Published var selectedTabID: Int { return TabBar.IDs["dashboard"] ?? 0 }
    private(set) var selectedTab: AppTabLabels = .dashboard

    enum Action: Sendable {
        case dashboard
        case jobHistory
        case employees
    }
}

var selectedTabIndex: Int64 = 0

struct TabBarID: Identifiable, Equatable {
    static let dashBoard = ID("dashboard")
    static let jobs = ID("job_history", title: "Jobs", icon: .list.bulleted)
    static let employees = ID("employees", icon: .square.and.arrow.up.on.square)

    enum ID: String, CaseIterable { static let dashboard: TabBarID.ID = "dashboard"; static let jobHistory: TabBarID.ID = "job_history"; static let employees: TabBarID.ID = "employees" }

    let id: Self.ID; var label: String? = ""; var icon: ImageSystemName?
}

enum AppTabLabels: CaseIterable { static let all = [.dashboard, .jobHistory, .employees]; static let dashboard: AppTabLabels = .init(id: "dashboard", label: "Dashboard"
}

// MARK: - End of Composables.swift
