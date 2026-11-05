import SwiftUI
import SwiftData

@main
struct SparkleWashApp: App {
    private let modelContainer = ModelContainer(
        models: [
            Station.schema,
            UploadedPhoto.schema,
            StationStack.schema,
            SensorCalibration.schema,
            UserPreferences.schema,
        ],
        storeDirectory: "./Documents/SparkleWash",
        configuration: .backgroundContextQueue()
    )

    init() {
        Task { @MainActor in
            try? await modelContainer.loadPersistentStore(name: "default")
            try? await modelContainer.loadPersistentStore(name: "readonly")
        }
    }

    var body: some Scene {
        WindowGroup{
            ContentView()
        }
        .modelContext(modelContainer.mainContext)
    }
}

// MARK: - Model Container Registry with Offline/Online Contexts
struct ModelManager: @unchecked Sendable {
    static let shared = ModelManager()

    let mainContext: NSManagedObjectContext
    let uiContext: NSManagedObjectContext

    init() {
        self.mainContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        self.uiContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
    }
}

// MARK: - SwiftData Models
struct Station: Model {
    @Attribute(.unique) var id: String
    var name: String
    var status: Int // 0=idle,1=washing,2=cleaning,3=error
    var pressurePsi: Int
    var soapLevelDm: Double
    var lastActiveAt: Date
    @Relationship(deleteRule: .cascade) var photos: [UploadedPhoto]
}

extension Station {
    enum Status: CaseIterable {
        case idle   = 0
        case washing = 1
        case cleaning = 2
        case error = 3

        var label: String { ["idle","washing","cleaning","error"][rawValue].uppercased() }
    }
}

struct UploadedPhoto: Model, Identifiable {
    @Attribute(.unique) var uuid: UUID
    @Relationship var station: Station
    var data: Data
    var timestamp: Date
}

struct StationStack: Model {
    @Relationship(.inverse: "children") var parent: StationStack?
    @Relationship(deleteRule: .cascade, inverse: "parentStack") var children: [StationStack]

    static let top = StationStack()
}

struct SensorCalibration: Model {
    @Attribute(.unique) var sensorType: String
    @Attribute var stationId: String
    var offsetMv: Double
}

struct UserPreferences: Model {
    @Attribute(.unique) let key: String
    var value: String?
    static let vibration = Self.init(key: "vibration")!
    static let notifications = Self.init(key: "notifications")!
    static let autoReconnect = Self.init(key: "auto_reconnect_ws")!
}

