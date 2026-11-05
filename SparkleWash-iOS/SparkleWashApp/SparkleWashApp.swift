import SwiftUI
import SwiftData
import GoogleSignIn

@main
struct SparkleWashApp: App {
    var body: some Scene {
        WindowGroup {
            OperationsView()
                .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }
        }
        .modelContainer(for: [CachedSnapshot.self, CachedOperationsSnapshot.self])
    }
}
