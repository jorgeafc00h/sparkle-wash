import Foundation
import Observation
import SparkleKit
import SwiftData

enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case floor, review, board, plates, bays, admin
    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .floor: "nav.floor"
        case .review: "nav.review"
        case .board: "nav.board"
        case .plates: "nav.plates"
        case .bays: "nav.bays"
        case .admin: "nav.admin"
        }
    }

    var symbol: String {
        switch self {
        case .floor: "square.grid.2x2"
        case .review: "viewfinder"
        case .board: "rectangle.split.3x1"
        case .plates: "clock.arrow.circlepath"
        case .bays: "gauge.with.dots.needle.50percent"
        case .admin: "gearshape"
        }
    }
}

/// Who is signed in, to which carwash, and the sync engine for it.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case signedOut, signedIn }

    private(set) var phase: Phase = .signedOut
    private(set) var session: StaffSession?
    private(set) var engine: SyncEngine?
    var section: AppSection? = .floor
    /// Shown on the sign-in screen (session expired, Google error…).
    var notice: String?
    var busy = false

    let config: AppConfig
    let localizer: Localizer
    let container: ModelContainer
    @ObservationIgnored private var offlineSwitch: OfflineSwitchAPI?
    @ObservationIgnored private var demoTicker: Task<Void, Never>?
    private static let tokenAccount = "staff-session"

    init(config: AppConfig = .load(), localizer: Localizer = Localizer(), inMemory: Bool = AppConfig.isUITesting || AppConfig.isUnitTesting) {
        self.config = config
        self.localizer = localizer
        // Falling back to memory keeps the app usable if the on-disk store can't be opened.
        container = (try? CacheSchema.container(inMemory: inMemory)) ?? (try! CacheSchema.container(inMemory: true))
    }

    var api: SparkleAPI? { engine?.api }
    var isDemo: Bool { engine?.api.isDemo ?? false }

    /// Only in the demo: cut the "network" to show changes queuing and syncing back.
    var simulateOffline: Bool {
        get { demoOffline }
        set {
            demoOffline = newValue
            offlineSwitch?.offline = newValue
            if !newValue { Task { await engine?.sync() } }
        }
    }
    /// Tracked copy of the switch, so the Settings toggle redraws.
    private var demoOffline = false

    // MARK: - Start

    func restore() async {
        guard phase == .signedOut, let server = config.server, let token = Keychain.read(account: Self.tokenAccount) else { return }
        await start(api: HTTPSparkleAPI(config: server, token: token), live: true)
    }

    func startDemo(carwash: TenantInput? = nil) async {
        let demo = DemoBackend(seed: carwash == nil, carwash: carwash)
        let offline = OfflineSwitchAPI(base: demo)
        offlineSwitch = offline
        await start(api: offline, live: false)
        if phase == .signedIn {
            section = carwash == nil ? .floor : .admin
            demoTicker = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: AppConfig.isUITesting ? 3_600_000_000_000 : 9_000_000_000)
                    if !offline.offline { await demo.tick() }
                }
            }
        }
    }

    func signInWithGoogle() async {
        guard let server = config.server, let clientId = config.googleClientId else { return }
        busy = true
        defer { busy = false }
        do {
            let idToken = try await GoogleSignIn(clientId: clientId).idToken()
            let login = try await HTTPSparkleAPI.signIn(config: server, idToken: idToken)
            Keychain.save(login.sessionToken, account: Self.tokenAccount)
            await start(api: HTTPSparkleAPI(config: server, token: login.sessionToken), live: true)
        } catch GoogleSignIn.Failure.cancelled {
            notice = localizer("ios.signin.cancelled")
        } catch let error as APIError {
            notice = error == .unauthorized ? localizer("signin.notStaff") : localizer.error(error)
        } catch {
            notice = localizer("error.generic")
        }
    }

    func register(_ carwash: TenantInput) async {
        guard let server = config.server, let clientId = config.googleClientId else { return }
        busy = true
        defer { busy = false }
        do {
            let idToken = try await GoogleSignIn(clientId: clientId).idToken()
            let login = try await HTTPSparkleAPI.register(config: server, idToken: idToken, carwash: carwash)
            Keychain.save(login.sessionToken, account: Self.tokenAccount)
            await start(api: HTTPSparkleAPI(config: server, token: login.sessionToken), live: true)
            section = .admin
        } catch GoogleSignIn.Failure.cancelled {
            notice = localizer("ios.signin.cancelled")
        } catch let error as APIError {
            switch error {
            case .conflict: notice = localizer("register.already")
            case .forbidden: notice = localizer("register.closed")
            default: notice = localizer("register.failed")
            }
        } catch {
            notice = localizer("register.failed")
        }
    }

    private func start(api: SparkleAPI, live: Bool) async {
        do {
            let session: StaffSession
            do {
                session = try await api.session()
                if live { Self.rememberSession(session) }
            } catch let error as APIError where live && error.isRetryable {
                // No signal: open with the last known session and the cached data; sync catches up later.
                guard let cached = Self.rememberedSession() else { throw error }
                session = cached
            }
            let store = LocalStore(context: container.mainContext, tenantId: session.tenant.id)
            let engine = SyncEngine(api: api, store: store) { [weak self] in self?.expire() }
            engine.setErrorDescriber { [localizer] in localizer.error($0) }
            self.session = session
            self.engine = engine
            notice = nil
            phase = .signedIn
            engine.start()
        } catch APIError.unauthorized {
            Keychain.delete(account: Self.tokenAccount)
            notice = live ? localizer("shell.sessionExpired") : nil
        } catch {
            notice = localizer.error(error)
        }
    }

    private static let sessionDefaultsKey = "sparklewash.session"

    private static func rememberSession(_ session: StaffSession?) {
        if let session, let data = try? SparkleJSON.encoder().encode(session) {
            UserDefaults.standard.set(data, forKey: sessionDefaultsKey)
        } else {
            UserDefaults.standard.removeObject(forKey: sessionDefaultsKey)
        }
    }

    private static func rememberedSession() -> StaffSession? {
        UserDefaults.standard.data(forKey: sessionDefaultsKey).flatMap { try? SparkleJSON.decoder().decode(StaffSession.self, from: $0) }
    }

    /// The server said the session is no longer valid (expired, role changed, removed from the team).
    func expire() {
        tearDown()
        Keychain.delete(account: Self.tokenAccount)
        notice = localizer("shell.sessionExpired")
    }

    func signOut() async {
        await engine?.api.signOut()
        if isDemo { engine?.store.clear() }
        Keychain.delete(account: Self.tokenAccount)
        tearDown()
    }

    private func tearDown() {
        if !isDemo { Self.rememberSession(nil) }
        demoTicker?.cancel()
        demoTicker = nil
        engine?.stop()
        engine = nil
        offlineSwitch = nil
        demoOffline = false
        session = nil
        phase = .signedOut
        section = .floor
    }

    /// Re-reads the session (role or carwash name may have changed).
    func refreshSession() async {
        guard let api, let fresh = try? await api.session() else { return }
        session = fresh
    }
}
