import Foundation
import SparkleKit

/// Server and Google settings, read from Info.plist (filled from Config.xcconfig / Local.xcconfig at build time).
struct AppConfig: Equatable {
    var server: ServerConfig?
    var googleClientId: String?

    static func load(bundle: Bundle = .main) -> AppConfig {
        func value(_ key: String) -> String? {
            guard let text = bundle.object(forInfoDictionaryKey: key) as? String else { return nil }
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
        }
        return AppConfig(server: value("SPARKLEWASH_API_URL").flatMap(URL.init(string:)).map(ServerConfig.init(baseURL:)),
                         googleClientId: value("GOOGLE_IOS_CLIENT_ID"))
    }

    /// Live sign-in needs both a server and an iOS OAuth client.
    var canSignIn: Bool { server != nil && googleClientId != nil }

    /// Launch arguments used by the UI tests.
    static var isUITesting: Bool { ProcessInfo.processInfo.arguments.contains("-ui-testing") }

    /// Hosting unit tests: keep the cache in memory so runs don't share an on-disk store.
    static var isUnitTesting: Bool { ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil }
}
