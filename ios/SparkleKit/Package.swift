// swift-tools-version: 5.9
import PackageDescription

// SparkleKit: everything in the iOS app that doesn't need UIKit/SwiftUI/SwiftData —
// API models and client, offline outbox, live-update stream, Google OAuth (PKCE),
// demo backend, and the ESP32-CAM Wi-Fi/Bluetooth protocols. Tested with `swift test`.
let package = Package(
    name: "SparkleKit",
    defaultLocalization: "es",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "SparkleKit", targets: ["SparkleKit"])],
    targets: [
        .target(name: "SparkleKit"),
        .testTarget(name: "SparkleKitTests", dependencies: ["SparkleKit"], resources: [.copy("Fixtures")]),
    ]
)
