import SwiftData
import SwiftUI

@main
struct SparkleWashApp: App {
    @State private var model: AppModel

    init() {
        let localizer = Localizer()
        // UI tests always start in Spanish (the default) unless they ask for another language.
        if AppConfig.isUITesting {
            localizer.language = ProcessInfo.processInfo.arguments.contains("-lang-en") ? "en" : "es"
        }
        _model = State(initialValue: AppModel(localizer: localizer))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.localizer)
                .modelContainer(model.container)
                .tint(.brand)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var restored = false

    var body: some View {
        Group {
            switch model.phase {
            case .signedOut:
                if restored { SignInView() } else { ProgressView().controlSize(.large) }
            case .signedIn:
                MainSplitView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.phase)
        .task {
            await model.restore()
            restored = true
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.engine?.sync() } }
        }
    }
}
