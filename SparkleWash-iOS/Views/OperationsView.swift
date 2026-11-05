import SwiftUI
import SwiftData
import GoogleSignIn
import GoogleSignInSwift

@MainActor
final class OperationsModel: ObservableObject {
    @Published private(set) var catalog: ServiceCatalogDTO?
    @Published private(set) var arrivals: [ArrivalDTO] = []
    @Published private(set) var jobs: [JobDTO] = []
    @Published private(set) var summary: JobSummaryDTO?
    @Published private(set) var employees: [EmployeeDTO] = []
    @Published private(set) var inventory: [InventoryDTO] = []
    @Published private(set) var role: String?
    @Published private(set) var savedAt: Date?
    @Published private(set) var isStale = true
    @Published private(set) var offlineHistoryAvailable = false
    @Published private(set) var isLoading = false
    @Published var error: String?
    @Published private(set) var navigationSession = UUID()
    private var token: String?
    private var sessionExpiry: Date?
    private var signInGeneration = UUID()
    private(set) var endpoint = ""
    private var staffScope: Data?
    private var offlineEntitlement: OfflineEntitlementDTO?
    private var trustedOfflineSigningKey: Data?
    private var actionKeys: [String: String] = [:]
    private let send: (URLRequest) async throws -> (Data, URLResponse)
    private let offlineKeyStore: any OfflineEntitlementKeyStoreProtocol

    init(keyStore: any OfflineEntitlementKeyStoreProtocol = KeychainOfflineEntitlementKeyStore(),
         send: @escaping (URLRequest) async throws -> (Data, URLResponse) = {
        try await URLSession.shared.data(for: $0)
    }) {
        self.send = send
        self.offlineKeyStore = keyStore
    }

    var canOperate: Bool { role == "operator" || role == "admin" }
    var signedIn: Bool { token != nil }
    var currentSignInGeneration: UUID { signInGeneration }

    func canReadSavedHistory(at date: Date) -> Bool {
        guard let staffScope, let origin = EndpointValidation.origin(endpoint) else { return false }
        if signedIn, let sessionExpiry, let savedAt, date < sessionExpiry,
           date < savedAt.addingTimeInterval(86_400) { return true }
        guard let offlineEntitlement else { return false }
        return OfflineEntitlementVerifier.verify(offlineEntitlement, origin: origin, staffScope: staffScope,
                                                 trustedPublicKey: trustedOfflineSigningKey ?? Data(), at: date) != nil
    }

    func savedArchiveHistory(context: ModelContext) throws -> SavedArchiveHistory? {
        try purgeExpiredLocalData(context: context)
        guard canReadSavedHistory(at: .now), let staffScope else { return nil }
        guard let snapshot = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: {
            $0.endpoint == endpoint && $0.staffScope == staffScope
        }) else { return nil }
        let rows = try context.fetch(FetchDescriptor<CachedArchivedJob>()).filter {
            $0.endpoint == endpoint && $0.staffScope == staffScope
        }
        if !rows.isEmpty {
            guard let revision = snapshot.archiveHistoryRevision,
                  let grantData = snapshot.offlineEntitlementData,
                  let grant = try? JSONDecoder().decode(OfflineEntitlementDTO.self, from: grantData),
                  grant.revision == revision else { return nil }
            guard let syncedAt = rows.map(\.syncedAt).max(), Date().timeIntervalSince(syncedAt) < 86_400 else {
                return nil
            }
            return SavedArchiveHistory(jobs: rows.map(\.dto).sorted {
                ($0.completedDate ?? .distantPast, $0.id) > ($1.completedDate ?? .distantPast, $1.id)
            }, syncedAt: syncedAt)
        }
        if let revision = snapshot.archiveHistoryRevision,
           let grantData = snapshot.offlineEntitlementData,
           let grant = try? JSONDecoder().decode(OfflineEntitlementDTO.self, from: grantData),
           grant.revision == revision,
           let syncedAt = snapshot.archiveHistorySyncedAt,
           Date().timeIntervalSince(syncedAt) < 86_400 {
            return SavedArchiveHistory(jobs: [], syncedAt: syncedAt)
        }

        // Move the earlier single-blob cache into individual SwiftData rows.
        guard let data = snapshot.archiveHistoryData else { return nil }
        let legacy = try JSONDecoder().decode(SavedArchiveHistory.self, from: data)
        guard Date().timeIntervalSince(legacy.syncedAt) < 86_400 else { return nil }
        for job in legacy.jobs {
            context.insert(CachedArchivedJob(endpoint: endpoint, staffScope: staffScope, batch: "legacy",
                                             job: job, syncedAt: legacy.syncedAt))
        }
        snapshot.archiveHistoryData = nil
        try context.save()
        return legacy
    }

    enum ArchiveSyncError: Error {
        case batchWithdrawn
        case archiveChanged
    }

    func syncArchiveHistory(context: ModelContext) async throws -> SavedArchiveHistory {
        struct Index: Decodable {
            let batches: [String]
            let nextAfter: String?
            let revision: String
            let offlineEntitlement: OfflineEntitlementDTO
        }
        struct Page: Decodable { let batch: String; let jobs: [ArchivedJobDTO]; let nextOffset: Int? }

        guard canReadSavedHistory(at: .now), let staffScope, let token else {
            throw URLError(.userAuthenticationRequired)
        }
        let origin = endpoint
        guard let canonicalOrigin = EndpointValidation.origin(origin) else { throw URLError(.badURL) }
        guard let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: {
            $0.endpoint == origin && $0.staffScope == staffScope
        }) else { throw URLError(.cannotWriteToFile) }
        func checkScope() throws {
            guard !Task.isCancelled, self.endpoint == origin, self.token == token,
                  self.staffScope == staffScope, canReadSavedHistory(at: .now) else { throw CancellationError() }
        }

        func clearRowsAndGrant() throws {
            clearArchiveState(record)
            for row in try context.fetch(FetchDescriptor<CachedArchivedJob>())
                where row.endpoint == origin && row.staffScope == staffScope { context.delete(row) }
            offlineEntitlement = nil
            offlineHistoryAvailable = false
        }

        let decoder = JSONDecoder()
        do {
            var pageCursor = record.archiveSyncAfter
            var latestEntitlement: OfflineEntitlementDTO?
            var archiveRevision: String?
            while true {
                let query = pageCursor.map { "&after=\($0)" } ?? ""
                let data = try await request("/api/history/archive?limit=20" + query, endpoint: origin)
                try checkScope()
                let index = try decoder.decode(Index.self, from: data)
                guard index.revision.utf8.count == 64,
                      index.revision.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                      index.offlineEntitlement.revision == index.revision,
                      OfflineEntitlementVerifier.verify(index.offlineEntitlement, origin: canonicalOrigin,
                          staffScope: staffScope,
                          trustedPublicKey: Data(base64Encoded: index.offlineEntitlement.publicKey) ?? Data(),
                          at: .now) != nil,
                      let signingKey = Data(base64Encoded: index.offlineEntitlement.publicKey) else {
                    throw URLError(.cannotParseResponse)
                }
                try offlineKeyStore.pin(signingKey, for: canonicalOrigin)
                trustedOfflineSigningKey = signingKey
                if let archiveRevision, archiveRevision != index.revision { throw ArchiveSyncError.archiveChanged }
                archiveRevision = index.revision
                latestEntitlement = index.offlineEntitlement
                guard index.batches.count <= 20 else { throw URLError(.cannotParseResponse) }
                var previousBatch = pageCursor ?? ""
                for batch in index.batches {
                    guard batch.utf8.count == 64,
                          batch.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                          batch > previousBatch else { throw URLError(.cannotParseResponse) }
                    previousBatch = batch
                }
                if let next = index.nextAfter {
                    guard !index.batches.isEmpty, next == index.batches.last else {
                        throw URLError(.cannotParseResponse)
                    }
                }
                if record.archiveHistoryRevision == index.revision && record.archiveSyncRevision == nil {
                    record.offlineEntitlementData = try JSONEncoder().encode(index.offlineEntitlement)
                    record.archiveHistorySyncedAt = .now
                    for row in try context.fetch(FetchDescriptor<CachedArchivedJob>())
                        where row.endpoint == origin && row.staffScope == staffScope { row.syncedAt = .now }
                    try context.save()
                    offlineEntitlement = index.offlineEntitlement
                    offlineHistoryAvailable = true
                    let rows = try context.fetch(FetchDescriptor<CachedArchivedJob>()).filter {
                        $0.endpoint == origin && $0.staffScope == staffScope
                    }
                    return SavedArchiveHistory(jobs: rows.map(\.dto).sorted {
                        ($0.completedDate ?? .distantPast, $0.id) > ($1.completedDate ?? .distantPast, $1.id)
                    }, syncedAt: rows.map(\.syncedAt).max() ?? .now)
                }
                if record.archiveSyncRevision != index.revision {
                    let mustRestartFromFirstBatch = pageCursor != nil
                    try clearRowsAndGrant()
                    record.archiveSyncRevision = index.revision
                    record.archiveSyncAfter = nil
                    record.archiveSyncBatch = nil
                    record.archiveSyncOffset = 0
                    try context.save()
                    if mustRestartFromFirstBatch { throw ArchiveSyncError.archiveChanged }
                }

                let checkpointAfter = pageCursor
                let checkpointBatch = record.archiveSyncAfter == checkpointAfter ? record.archiveSyncBatch : nil
                for batch in index.batches {
                    if let checkpointBatch, batch < checkpointBatch { continue }
                    if let checkpointBatch, batch == checkpointBatch, record.archiveSyncOffset == nil { continue }
                    if checkpointBatch != batch {
                        record.archiveSyncAfter = checkpointAfter
                        record.archiveSyncBatch = batch
                        record.archiveSyncOffset = 0
                        try context.save()
                    }
                    while true {
                        let offset = record.archiveSyncOffset ?? 0
                        let pageData: Data
                        do {
                            pageData = try await request("/api/history/archive/\(batch)?limit=100&offset=\(offset)", endpoint: origin)
                        } catch let error as URLError where error.code == .resourceUnavailable {
                            try checkScope()
                            try clearRowsAndGrant()
                            record.archiveSyncRevision = nil
                            record.archiveSyncAfter = nil
                            record.archiveSyncBatch = nil
                            record.archiveSyncOffset = nil
                            try context.save()
                            throw ArchiveSyncError.batchWithdrawn
                        }
                        try checkScope()
                        let page = try decoder.decode(Page.self, from: pageData)
                        guard page.batch == batch, page.jobs.count <= 100 else { throw URLError(.cannotParseResponse) }
                        for job in page.jobs {
                            guard !job.id.isEmpty, !job.plate.isEmpty, !job.packageName.isEmpty, job.completedDate != nil else {
                                throw URLError(.cannotParseResponse)
                            }
                            let key = CachedArchivedJob.makeKey(endpoint: origin, staffScope: staffScope, jobID: job.id)
                            var rowQuery = FetchDescriptor<CachedArchivedJob>(predicate: #Predicate { $0.key == key })
                            rowQuery.fetchLimit = 1
                            if let existing = try context.fetch(rowQuery).first {
                                existing.batch = batch
                                existing.plate = job.plate
                                existing.packageName = job.packageName
                                existing.completedAt = job.completedAt
                                existing.syncedAt = .now
                            } else {
                                context.insert(CachedArchivedJob(endpoint: origin, staffScope: staffScope,
                                    batch: batch, job: job, syncedAt: .now))
                            }
                        }
                        if let next = page.nextOffset {
                            guard !page.jobs.isEmpty, next == offset + page.jobs.count else {
                                throw URLError(.cannotParseResponse)
                            }
                            record.archiveSyncOffset = next
                        } else {
                            record.archiveSyncOffset = nil
                        }
                        try context.save()
                        guard page.nextOffset != nil else { break }
                    }
                }

                if !index.batches.isEmpty {
                    record.archiveSyncAfter = index.batches.last
                    record.archiveSyncBatch = nil
                    record.archiveSyncOffset = 0
                    try context.save()
                    pageCursor = record.archiveSyncAfter
                    continue
                }
                guard index.nextAfter == nil else { throw URLError(.cannotParseResponse) }
                break
            }
            try checkScope()
            guard let entitlement = latestEntitlement, let archiveRevision,
                  record.archiveSyncRevision == archiveRevision else { throw URLError(.cannotParseResponse) }
            record.archiveHistoryData = nil
            record.offlineEntitlementData = try JSONEncoder().encode(entitlement)
            record.archiveHistoryRevision = archiveRevision
            record.archiveHistorySyncedAt = .now
            record.archiveSyncRevision = nil
            record.archiveSyncAfter = nil
            record.archiveSyncBatch = nil
            record.archiveSyncOffset = nil
            try context.save()
            offlineEntitlement = entitlement
            offlineHistoryAvailable = true
            let rows = try context.fetch(FetchDescriptor<CachedArchivedJob>()).filter {
                $0.endpoint == origin && $0.staffScope == staffScope
            }
            return SavedArchiveHistory(jobs: rows.map(\.dto).sorted {
                ($0.completedDate ?? .distantPast, $0.id) > ($1.completedDate ?? .distantPast, $1.id)
            }, syncedAt: rows.map(\.syncedAt).max() ?? .now)
        } catch {
            if (error as? URLError)?.code == .userAuthenticationRequired,
               self.endpoint == origin, self.token == token {
                signOut(context: context)
                self.error = "Session expired. Sign in again."
            }
            throw error
        }
    }

    func restore(context: ModelContext, endpoint: String) {
        if self.endpoint != endpoint { signInGeneration = UUID() }
        self.endpoint = endpoint
        token = nil
        sessionExpiry = nil
        staffScope = nil
        offlineEntitlement = nil
        trustedOfflineSigningKey = nil
        offlineHistoryAvailable = false
        role = nil
        actionKeys.removeAll()
        catalog = nil
        arrivals = []
        jobs = []
        summary = nil
        employees = []
        inventory = []
        savedAt = nil
        isStale = true
        error = nil
        do {
            try purgeExpiredLocalData(context: context)
            guard let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: { $0.endpoint == endpoint }) else { return }
            let decoder = JSONDecoder()
            let menu = try decoder.decode(ServiceCatalogDTO.self, from: record.catalogData)
            guard menu.isValid else { throw URLError(.cannotParseResponse) }
            self.catalog = menu
            if let data = record.offlineEntitlementData, let scope = record.staffScope,
               let grant = try? decoder.decode(OfflineEntitlementDTO.self, from: data),
               let origin = EndpointValidation.origin(endpoint) {
                // Preserve protected data if Keychain is temporarily unavailable (for example before
                // first unlock after restart). A missing or mismatched pin is a trust failure and purges it.
                guard let signingKey = try offlineKeyStore.publicKey(for: origin) else {
                    try clearUntrustedArchive(record, scope: scope, context: context)
                    return
                }
                if OfflineEntitlementVerifier.verify(grant, origin: origin, staffScope: scope,
                                                       trustedPublicKey: signingKey) != nil {
                    staffScope = scope
                    offlineEntitlement = grant
                    trustedOfflineSigningKey = signingKey
                    offlineHistoryAvailable = true
                } else {
                    try clearUntrustedArchive(record, scope: scope, context: context)
                }
            } else if record.offlineEntitlementData != nil {
                clearArchiveState(record)
                if let scope = record.staffScope {
                    for row in try context.fetch(FetchDescriptor<CachedArchivedJob>())
                        where row.endpoint == endpoint && row.staffScope == scope { context.delete(row) }
                }
                try context.save()
            }
        } catch { self.error = "Saved operations could not be loaded: \(error.localizedDescription)" }
    }

    private func clearUntrustedArchive(_ record: CachedOperationsSnapshot, scope: Data, context: ModelContext) throws {
        clearArchiveState(record)
        for row in try context.fetch(FetchDescriptor<CachedArchivedJob>())
            where row.endpoint == endpoint && row.staffScope == scope { context.delete(row) }
        try context.save()
    }

    private func clearArchiveState(_ record: CachedOperationsSnapshot) {
        record.archiveHistoryData = nil
        record.offlineEntitlementData = nil
        record.archiveHistoryRevision = nil
        record.archiveHistorySyncedAt = nil
        record.archiveSyncRevision = nil
        record.archiveSyncAfter = nil
        record.archiveSyncBatch = nil
        record.archiveSyncOffset = nil
    }

    private func purgeExpiredLocalData(context: ModelContext, now: Date = .now) throws {
        let records = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>())
        let archivedRows = try context.fetch(FetchDescriptor<CachedArchivedJob>())
        var changed = false
        let emptyList = Data("[]".utf8)
        for record in records {
            if now.timeIntervalSince(record.savedAt) >= 86_400 {
                if record.staffScope != nil || record.archiveHistoryData != nil || record.savedAt != .distantPast {
                    record.staffScope = nil
                    record.archiveHistoryData = nil
                    record.offlineEntitlementData = nil
                    record.archiveHistoryRevision = nil
                    record.archiveHistorySyncedAt = nil
                    record.archiveSyncRevision = nil
                    record.archiveSyncAfter = nil
                    record.archiveSyncBatch = nil
                    record.archiveSyncOffset = nil
                    record.arrivalsData = emptyList
                    record.jobsData = emptyList
                    record.summaryData = Data("{}".utf8)
                    record.employeesData = emptyList
                    record.inventoryData = emptyList
                    record.savedAt = .distantPast
                    changed = true
                }
                continue
            }

            guard let archivedData = record.archiveHistoryData else { continue }
            guard let archive = try? JSONDecoder().decode(SavedArchiveHistory.self, from: archivedData),
                  now.timeIntervalSince(archive.syncedAt) < 86_400 else {
                record.archiveHistoryData = nil
                record.archiveHistorySyncedAt = nil
                changed = true
                continue
            }
        }
        for row in archivedRows where now.timeIntervalSince(row.syncedAt) >= 86_400 {
            context.delete(row)
            changed = true
        }
        if changed { try context.save() }
    }

    func purgeExpiredOfflineHistory(context: ModelContext, at date: Date) {
        guard !signedIn, let staffScope, !canReadSavedHistory(at: date) else { return }
        do {
            for row in try context.fetch(FetchDescriptor<CachedArchivedJob>())
                where row.endpoint == endpoint && row.staffScope == staffScope { context.delete(row) }
            if let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: {
                $0.endpoint == endpoint && $0.staffScope == staffScope
            }) {
                clearArchiveState(record)
            }
            try context.save()
        } catch { self.error = "Expired offline history could not be removed: \(error.localizedDescription)" }
        self.staffScope = nil
        offlineEntitlement = nil
        trustedOfflineSigningKey = nil
        offlineHistoryAvailable = false
    }

    private func restoreStaffSnapshot(context: ModelContext) throws {
        guard let staffScope,
              let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: {
                  $0.endpoint == endpoint && $0.staffScope == staffScope
              }),
              Date().timeIntervalSince(record.savedAt) < 86_400 else { return }

        let decoder = JSONDecoder()
        let arrivals = try decoder.decode([ArrivalDTO].self, from: record.arrivalsData)
        let jobs = try decoder.decode([JobDTO].self, from: record.jobsData)
        let summary = try decoder.decode(JobSummaryDTO.self, from: record.summaryData)
        let employees = try decoder.decode([EmployeeDTO].self, from: record.employeesData)
        let inventory = try decoder.decode([InventoryDTO].self, from: record.inventoryData)
        guard arrivals.allSatisfy(\.isValid), jobs.allSatisfy(\.isValid),
              summary.isValid, inventory.allSatisfy(\.isValid) else { throw URLError(.cannotParseResponse) }
        self.arrivals = arrivals
        self.jobs = jobs
        self.summary = summary
        self.employees = employees
        self.inventory = inventory
        savedAt = record.savedAt
    }

    func refresh(context: ModelContext, endpoint: String) async {
        guard !isLoading, self.endpoint == endpoint, EndpointValidation.isValid(endpoint) else { return }
        isLoading = true
        defer { isLoading = false }
        let sessionToken = token
        do {
            let menu: ServiceCatalogDTO
            let catalogData: Data
            if let catalog {
                menu = catalog
                catalogData = try JSONEncoder().encode(catalog)
            } else {
                catalogData = try await request("/api/packages", endpoint: endpoint, authenticated: false)
                menu = try JSONDecoder().decode(ServiceCatalogDTO.self, from: catalogData)
            }
            guard menu.isValid else { throw URLError(.cannotParseResponse) }
            guard !Task.isCancelled, self.endpoint == endpoint, token == sessionToken else { return }
            catalog = menu
            guard let sessionToken else { return }
            let arrivalsData = try await request("/api/arrivals", endpoint: endpoint)
            let jobsData = try await request("/api/jobs", endpoint: endpoint)
            let summaryData = try await request("/api/jobs/summary", endpoint: endpoint)
            let employeesData = try await request("/api/employees", endpoint: endpoint)
            let inventoryData = try await request("/api/inventory/items", endpoint: endpoint)
            let decoder = JSONDecoder()
            let incomingArrivals = try decoder.decode([ArrivalDTO].self, from: arrivalsData)
            let incomingJobs = try decoder.decode([JobDTO].self, from: jobsData)
            let incomingSummary = try decoder.decode(JobSummaryDTO.self, from: summaryData)
            let incomingEmployees = try decoder.decode([EmployeeDTO].self, from: employeesData)
            let incomingInventory = try decoder.decode([InventoryDTO].self, from: inventoryData)
            guard incomingArrivals.allSatisfy(\.isValid), incomingJobs.allSatisfy(\.isValid),
                  incomingSummary.isValid, incomingInventory.allSatisfy(\.isValid) else { throw URLError(.cannotParseResponse) }
            guard !Task.isCancelled, self.endpoint == endpoint, token == sessionToken else { return }
            arrivals = incomingArrivals
            jobs = incomingJobs
            summary = incomingSummary
            employees = incomingEmployees
            inventory = incomingInventory
            savedAt = Date()
            isStale = false
            error = nil
            do {
                if let record = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).first(where: { $0.endpoint == endpoint }) {
                    if record.staffScope != staffScope {
                        clearArchiveState(record)
                        for row in try context.fetch(FetchDescriptor<CachedArchivedJob>())
                            where row.endpoint == endpoint { context.delete(row) }
                    }
                    record.staffScope = staffScope
                    record.arrivalsData = arrivalsData
                    record.jobsData = jobsData
                    record.summaryData = summaryData
                    record.employeesData = employeesData
                    record.inventoryData = inventoryData
                    record.catalogData = catalogData
                    record.savedAt = savedAt!
                } else {
                    let record = CachedOperationsSnapshot(endpoint: endpoint, arrivalsData: arrivalsData, jobsData: jobsData,
                        summaryData: summaryData, employeesData: employeesData, inventoryData: inventoryData,
                        catalogData: catalogData, savedAt: savedAt!)
                    record.staffScope = staffScope
                    context.insert(record)
                }
                try context.save()
            } catch { self.error = "Operations loaded, but offline copy could not be saved: \(error.localizedDescription)" }
        } catch {
            guard !Task.isCancelled, self.endpoint == endpoint, token == sessionToken else { return }
            if (error as? URLError)?.code == .userAuthenticationRequired {
                signOut(context: context)
                self.error = "Session expired. Sign in again."
                return
            }
            isStale = true
            self.error = "Could not refresh operations: \(error.localizedDescription)"
        }
    }

    func beginSignInAttempt() -> UUID {
        signInGeneration = UUID()
        return signInGeneration
    }

    func exchangeGoogleToken(_ idToken: String, context: ModelContext, endpoint: String,
                             generation: UUID? = nil) async {
        guard EndpointValidation.isValid(endpoint), let url = URL(string: endpoint + "/api/auth/google") else { return }
        let attempt = generation ?? beginSignInAttempt()
        guard attempt == signInGeneration else { return }
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 12
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(["idToken": idToken])
            let (data, response) = try await send(request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
            let session = try JSONDecoder().decode(StaffSessionDTO.self, from: data)
            guard !session.sessionToken.isEmpty, ["viewer", "operator", "admin"].contains(session.role),
                  let expiry = OperationsDate.parse(session.expiresAt), expiry > Date() else {
                throw URLError(.cannotParseResponse)
            }
            guard !Task.isCancelled, self.endpoint == endpoint, signInGeneration == attempt else { return }
            restore(context: context, endpoint: endpoint)
            token = session.sessionToken
            sessionExpiry = expiry
            navigationSession = UUID()
            role = session.role
            if let tenant = session.tenant, !tenant.id.isEmpty, let subject = session.subject, !subject.isEmpty {
                staffScope = try JSONEncoder().encode([tenant.id, subject, session.role])
                do { try restoreStaffSnapshot(context: context) }
                catch { self.error = "Saved operations could not be loaded: \(error.localizedDescription)" }
            }
            await refresh(context: context, endpoint: endpoint)
        } catch {
            guard signInGeneration == attempt, self.endpoint == endpoint else { return }
            self.error = "Staff sign-in failed: \(error.localizedDescription)"
        }
    }

    func signOut(context: ModelContext) {
        signInGeneration = UUID()
        do {
            let records = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>())
            for record in records where record.endpoint == endpoint { context.delete(record) }
            for row in try context.fetch(FetchDescriptor<CachedArchivedJob>()) where row.endpoint == endpoint {
                context.delete(row)
            }
            try context.save()
        } catch { self.error = "Could not remove saved operations: \(error.localizedDescription)" }
        GIDSignIn.sharedInstance.signOut()
        navigationSession = UUID()
        token = nil
        sessionExpiry = nil
        staffScope = nil
        offlineEntitlement = nil
        offlineHistoryAvailable = false
        role = nil
        arrivals = []
        jobs = []
        summary = nil
        employees = []
        inventory = []
        actionKeys.removeAll()
        savedAt = nil
        isStale = true
    }

    func confirmAndOpen(_ arrival: ArrivalDTO, plate: String, vehicleClass: String, packageId: String,
                        context: ModelContext, endpoint: String) async {
        do {
            if arrival.confirmedPlate == nil {
                _ = try await mutate("/api/arrivals/\(arrival.id)/confirm", body: ["plate": plate, "vehicleClass": vehicleClass],
                    key: "confirm-\(arrival.id)", endpoint: endpoint)
            }
            _ = try await mutate("/api/jobs", body: ["arrivalId": arrival.id, "packageId": packageId],
                key: "open-\(arrival.id)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch is CancellationError {
            return
        } catch { self.error = "Could not open job: \(error.localizedDescription)" }
    }

    func transition(_ job: JobDTO, to status: String, context: ModelContext, endpoint: String) async {
        do {
            _ = try await mutate("/api/jobs/\(job.id)/transition", body: ["status": status],
                key: "\(status)-\(job.id)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch is CancellationError {
            return
        } catch { self.error = "Could not update job: \(error.localizedDescription)" }
    }

    func assign(_ employeeId: String, to job: JobDTO, context: ModelContext, endpoint: String) async {
        do {
            _ = try await mutate("/api/jobs/\(job.id)/employees", body: ["employeeId": employeeId],
                key: "assign-\(job.id)-\(employeeId)", endpoint: endpoint)
            await refresh(context: context, endpoint: endpoint)
        } catch is CancellationError {
            return
        } catch { self.error = "Could not assign employee: \(error.localizedDescription)" }
    }

    private func request(_ path: String, endpoint: String, authenticated: Bool = true) async throws -> Data {
        guard let url = URL(string: endpoint + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        if let origin = EndpointValidation.origin(endpoint) {
            request.setValue(origin, forHTTPHeaderField: "X-SparkleWash-Client-Origin")
        }
        if authenticated {
            guard let token else { throw URLError(.userAuthenticationRequired) }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await send(request)
        let status = (response as? HTTPURLResponse)?.statusCode
        if authenticated, status == 401 || status == 403 { throw URLError(.userAuthenticationRequired) }
        if status == 404, path.hasPrefix("/api/history/archive/") { throw URLError(.resourceUnavailable) }
        guard status == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    private func mutate(_ path: String, body: [String: String], key: String, endpoint: String) async throws -> Data {
        guard self.endpoint == endpoint, let token, let url = URL(string: endpoint + path) else {
            throw URLError(.userAuthenticationRequired)
        }
        let operationKey = actionKeys[key] ?? UUID().uuidString
        actionKeys[key] = operationKey
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(operationKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await send(request)
        guard !Task.isCancelled, self.endpoint == endpoint, self.token == token else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        actionKeys.removeValue(forKey: key)
        return data
    }
}

struct OperationsView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("apiBaseUrl") private var endpoint = "http://localhost:8080"
    @StateObject private var model = OperationsModel()
    @Namespace private var jobNavigation

    var body: some View {
        NavigationStack {
            ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16, pinnedViews: [.sectionHeaders]) {
                        if !model.signedIn {
                            catalogIntro
                            if GoogleClientSettings.current != nil { signInSection }
                        }
                        if model.offlineHistoryAvailable && !model.signedIn {
                            NavigationLink { CompletedHistoryView(model: model) } label: {
                                Label("Completed job history · Offline", systemImage: "clock.arrow.circlepath")
                                    .frame(minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                        }
                        if let summary = model.summary {
                            summarySection(summary)
                            if model.signedIn {
                                NavigationLink { CompletedHistoryView(model: model) } label: {
                                    Label("Completed job history", systemImage: "clock.arrow.circlepath")
                                        .frame(minHeight: 44)
                                }
                                .buttonStyle(.bordered)
                            }
                            workboardSection("Arrivals to review") { arrivalsSection }
                            workboardSection("Jobs") { jobsSection }
                            employeeSection
                            inventorySection
                        }
                        packageSection
                        if !model.signedIn && GoogleClientSettings.current == nil { signInSection }
                    }
                    .frame(maxWidth: 1200, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.bottom)
                    .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if model.signedIn || model.error != nil {
                    statusView
                        .frame(maxWidth: 1200)
                        .padding(.horizontal)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(Color(.systemBackground))
                }
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.25),
                       value: model.jobs.map { "\($0.id):\($0.status)" })
            .navigationTitle(model.signedIn ? "Workboard" : "SparkleWash")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.signedIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Sign out") { model.signOut(context: context) }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh(context: context, endpoint: endpoint) } }
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(model.isLoading)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: { Label("Settings", systemImage: "gearshape") }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .task(id: RefreshScope(endpoint: endpoint, active: scenePhase == .active, signedIn: model.signedIn)) {
                if model.endpoint != endpoint {
                    model.restore(context: context, endpoint: endpoint)
                }
                guard scenePhase == .active else { return }
                var delay = 30
                repeat {
                    await model.refresh(context: context, endpoint: endpoint)
                    guard model.signedIn || model.catalog == nil else { return }
                    delay = model.error == nil ? 30 : min(delay * 2, 300)
                    do { try await Task.sleep(for: .seconds(delay)) }
                    catch { return }
                } while !Task.isCancelled
            }
        }
        .id(NavigationScope(endpoint: endpoint, session: model.navigationSession))
    }

    private struct NavigationScope: Hashable {
        let endpoint: String
        let session: UUID
    }

    private struct RefreshScope: Equatable {
        let endpoint: String
        let active: Bool
        let signedIn: Bool
    }

    private var statusView: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.isLoading { ProgressView("Refreshing operations") }
            else if model.isStale { Text(model.savedAt == nil ? "Operations unavailable" : "Showing last synced operations").fontWeight(.semibold) }
            else { Text("API checked \(model.savedAt?.formatted(date: .omitted, time: .shortened) ?? "")") }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .font(.subheadline)
        .contentTransition(.opacity)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.isStale)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }

    private var catalogIntro: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "sparkles")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.teal)
                .accessibilityHidden(true)
            Text("Car care, your way")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Compare detailing packages and see prices for your vehicle.")
                .font(.subheadline)
                .foregroundStyle(Color.primary.opacity(0.72))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(.teal.opacity(0.10), in: RoundedRectangle(cornerRadius: 20))
    }

    private var signInSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Staff access").font(.title2).fontWeight(.semibold)
            if let ids = GoogleClientSettings.current {
                GoogleSignInButton {
                    Task { await signIn(ids) }
                }
                .frame(maxWidth: 260, minHeight: 44)
                .accessibilityLabel("Sign in with Google for SparkleWash staff")
            } else {
                Text("Staff sign-in is unavailable on this device.")
                    .foregroundStyle(Color.primary.opacity(0.72))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func signIn(_ ids: GoogleClientSettings) async {
        let generation = model.beginSignInAttempt()
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
              let controller = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
            model.error = "Could not open Google sign-in."
            return
        }
        do {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: ids.ios, serverClientID: ids.server)
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: controller)
            let user = try await result.user.refreshTokensIfNeeded()
            guard let token = user.idToken?.tokenString else { throw URLError(.userAuthenticationRequired) }
            await model.exchangeGoogleToken(token, context: context, endpoint: endpoint, generation: generation)
        } catch {
            guard generation == model.currentSignInGeneration else { return }
            model.error = "Google sign-in failed: \(error.localizedDescription)"
        }
    }

    private func summarySection(_ summary: JobSummaryDTO) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Whole-carwash jobs").font(.title2).fontWeight(.semibold)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                metric("Active work", summary.inProgress)
                metric("Waiting", summary.arrived + summary.queued)
                metric("Completed today UTC", summary.completedTodayUtc)
                metric("Average site minutes", (summary.averageCompletedSeconds ?? 0) / 60)
            }
        }
    }

    private func metric(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(label).font(.subheadline).foregroundStyle(Color.primary.opacity(0.72)); Text(value.formatted()).font(.title).bold() }
            .frame(maxWidth: .infinity, alignment: .leading).padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
    }

    private func workboardSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        Section {
            content()
        } header: {
            Text(title)
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .background(Color(.systemBackground))
        }
    }

    private var arrivalsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            let linkedArrivals = Set(model.jobs.map(\.arrivalId))
            let pending = model.arrivals.filter { !linkedArrivals.contains($0.id) }
            if pending.isEmpty { Text("No arrivals waiting for a job.").foregroundStyle(Color.primary.opacity(0.72)) }
            ForEach(pending) { arrival in
                NavigationLink {
                    ArrivalReviewView(model: model, arrival: arrival, endpoint: endpoint)
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(arrival.confirmedPlate ?? arrival.plateCandidate ?? "Unreadable plate").font(.headline)
                        Text("Camera \(arrival.cameraId) · \(arrival.confirmedPlate == nil ? "Needs review" : "Confirmed")")
                            .font(.subheadline).foregroundStyle(Color.primary.opacity(0.72))
                        if let confidence = arrival.confidence { Text("Candidate confidence \(Int(confidence * 100))%") }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(arrivalAccessibilityLabel(arrival))
            }
        }
    }

    private var jobsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.jobs.isEmpty { Text("No vehicle jobs yet.").foregroundStyle(Color.primary.opacity(0.72)) }
            ForEach(model.jobs) { job in
                NavigationLink {
                    let detail = JobDetailView(model: model, job: job, endpoint: endpoint)
                    if reduceMotion {
                        detail
                    } else {
                        detail.navigationTransition(.zoom(sourceID: job.id, in: jobNavigation))
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        ViewThatFits(in: .horizontal) {
                            HStack {
                                Text(job.plate).font(.headline).fixedSize()
                                Spacer()
                                jobStatus(job.status)
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Text(job.plate).font(.headline)
                                jobStatus(job.status)
                            }
                        }
                        Text("\(job.packageName) · $\(job.priceUsd.formatted()) · \(job.vehicleClass.uppercased())")
                            .font(.subheadline).foregroundStyle(Color.primary.opacity(0.72))
                        Text("Time on site \(job.elapsedSeconds / 60) min · \(job.assignments.count) assigned")
                            .font(.subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }
                .matchedTransitionSource(id: job.id, in: jobNavigation)
                .buttonStyle(.plain)
                .accessibilityLabel(jobAccessibilityLabel(job))
            }
        }
    }

    private func arrivalAccessibilityLabel(_ arrival: ArrivalDTO) -> String {
        let plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? "unreadable plate"
        let reviewState = arrival.confirmedPlate == nil ? "Needs staff review" : "Plate confirmed"
        let confidence = arrival.confidence.map { "Candidate confidence \(Int(($0 * 100).rounded())) percent" }
        return ["Review arrival for \(plate)", "Camera \(arrival.cameraId)", reviewState, confidence]
            .compactMap { $0 }
            .joined(separator: ". ")
    }

    private func jobAccessibilityLabel(_ job: JobDTO) -> String {
        let status = switch job.status {
        case "arrived": "Arrived"
        case "queued": "Queued"
        case "in_progress": "In progress"
        case "completed": "Completed"
        case "cancelled": "Cancelled"
        default: job.status.replacingOccurrences(of: "_", with: " ")
        }
        let assignment = job.assignments.isEmpty
            ? "No staff assigned"
            : "Assigned to " + job.assignments.map(\.employeeName).joined(separator: ", ")
        return "Job for \(job.plate). \(status). \(job.packageName), \(job.vehicleClass). \(job.priceUsd.formatted(.currency(code: "USD"))). \(job.elapsedSeconds / 60) minutes on site. \(assignment)."
    }

    private func jobStatus(_ status: String) -> some View {
        let appearance: (label: String, symbol: String, tint: Color) = switch status {
        case "arrived": ("Arrived", "car", .secondary)
        case "queued": ("Queued", "clock", .orange)
        case "in_progress": ("In progress", "sparkles", .teal)
        case "completed": ("Completed", "checkmark.circle", .green)
        case "cancelled": ("Cancelled", "xmark.circle", .secondary)
        default: (status.replacingOccurrences(of: "_", with: " "), "circle", .secondary)
        }
        return Label(appearance.label, systemImage: appearance.symbol)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(appearance.tint.opacity(0.15), in: Capsule())
    }

    private var employeeSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Employees").font(.title2).fontWeight(.semibold)
            if model.employees.isEmpty { Text("No employees added.").foregroundStyle(Color.primary.opacity(0.72)) }
            ForEach(model.employees) { employee in
                LabeledContent(employee.name, value: employee.active ? "Active" : "Inactive")
                    .padding().background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var inventorySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Resources and stock").font(.title2).fontWeight(.semibold)
            if model.inventory.isEmpty { Text("No compounds or supplies added.").foregroundStyle(Color.primary.opacity(0.72)) }
            ForEach(model.inventory) { stock in
                VStack(alignment: .leading, spacing: 4) {
                    Text(stock.item.name).font(.headline)
                    Text("\(stock.available.formatted()) \(stock.item.unit) available · \(stock.reserved.formatted()) reserved")
                    if stock.needsReorder { Text("Reorder needed").foregroundStyle(.orange).fontWeight(.semibold) }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding()
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var packageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Detailing packages").font(.title2).fontWeight(.semibold)
            if let catalog = model.catalog {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                    ForEach(catalog.packages) { package in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(package.name).font(.title3.weight(.semibold))
                            Text(package.subtitle).font(.subheadline).foregroundStyle(Color.primary.opacity(0.72))
                            Divider()
                            ForEach(catalog.vehicleClasses, id: \.id) { vehicle in
                                if let price = package.price(for: vehicle.id) {
                                    LabeledContent(vehicle.name) {
                                        Text(price, format: .currency(code: catalog.currency).precision(.fractionLength(0)))
                                            .monospacedDigit()
                                            .fontWeight(.semibold)
                                    }
                                    .font(.subheadline)
                                }
                            }
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(package.items, id: \.self) { item in
                                        Label(item, systemImage: "checkmark").font(.subheadline)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            } label: {
                                Text("\(package.items.count) included services")
                                    .font(.subheadline.weight(.medium))
                                    .frame(minHeight: 44)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
                    }
                }
            } else if model.error == nil {
                ProgressView("Loading service menu…")
            } else {
                Text("The service menu is unavailable. Use Refresh to try again.")
                    .foregroundStyle(Color.primary.opacity(0.72))
            }
        }
    }
}

private struct GoogleClientSettings {
    let ios: String
    let server: String
    static var current: Self? {
        guard let ios = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              let server = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String,
              ios.contains(".apps.googleusercontent.com"), server.contains(".apps.googleusercontent.com") else { return nil }
        return Self(ios: ios, server: server)
    }
}

private struct ArrivalReviewView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: OperationsModel
    let arrival: ArrivalDTO
    let endpoint: String
    @State private var plate = ""
    @State private var vehicleClass = "car"
    @State private var packageId = "essential"

    var body: some View {
        Form {
            Section("Camera observation") {
                LabeledContent("Camera", value: arrival.cameraId)
                LabeledContent("Candidate", value: arrival.plateCandidate ?? "Unreadable")
                LabeledContent("Confidence", value: arrival.confidence.map { "\(Int($0 * 100))%" } ?? "Unavailable")
                Text("A candidate needs staff confirmation before a job is opened.").font(.footnote)
            }
            Section("Confirm vehicle") {
                TextField("Plate number", text: $plate).textInputAutocapitalization(.characters)
                    .autocorrectionDisabled().disabled(arrival.confirmedPlate != nil)
                Picker("Vehicle class", selection: $vehicleClass) {
                    ForEach(model.catalog?.vehicleClasses ?? [], id: \.id) { item in Text(item.name).tag(item.id) }
                }.disabled(arrival.vehicleClass != nil)
                Picker("Detailing package", selection: $packageId) {
                    ForEach(model.catalog?.packages ?? []) { item in Text(item.name).tag(item.id) }
                }
                if let package = model.catalog?.packages.first(where: { $0.id == packageId }), let price = package.price(for: vehicleClass) {
                    Text("Suggested \(package.name) · $\(price). Confirm choice before opening.")
                        .font(.footnote).foregroundStyle(Color.primary.opacity(0.72))
                }
            }
            if model.canOperate {
                Button(arrival.confirmedPlate == nil ? "Confirm and open job" : "Open job") {
                    Task {
                        await model.confirmAndOpen(arrival, plate: plate, vehicleClass: vehicleClass,
                            packageId: packageId, context: context, endpoint: endpoint)
                        if model.error == nil { dismiss() }
                    }
                }
                .disabled(plate.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                .frame(minHeight: 44)
            }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("Review arrival")
        .onAppear { plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? ""; vehicleClass = arrival.vehicleClass ?? "car" }
    }
}

private struct CompletedHistoryView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var model: OperationsModel
    @State private var archive: SavedArchiveHistory?
    @State private var isSyncing = false
    @State private var syncError: String?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { timeline in
            Group {
            if model.canReadSavedHistory(at: timeline.date) {
                let archived = archive.flatMap { timeline.date.timeIntervalSince($0.syncedAt) < 86_400 ? $0 : nil }
                let archivedIds = Set(archived?.jobs.map(\.id) ?? [])
                let completed = model.jobs.filter { $0.status == "completed" && !archivedIds.contains($0.id) }.sorted {
                    ($0.completedAt.flatMap(OperationsDate.parse) ?? $0.arrivalDate ?? .distantPast) >
                    ($1.completedAt.flatMap(OperationsDate.parse) ?? $1.arrivalDate ?? .distantPast)
                }
                List {
                    Section {
                        if let synced = model.savedAt {
                            Label("Last synced \(synced.formatted(date: .abbreviated, time: .shortened))",
                                  systemImage: model.isStale ? "wifi.slash" : "checkmark.circle")
                                .font(.subheadline)
                        }
                        if isSyncing { ProgressView("Syncing archive…") }
                        if let syncError { Text(syncError).font(.footnote).foregroundStyle(Color.primary.opacity(0.72)) }
                    }
                    Section("Completed jobs") {
                        if completed.isEmpty { Text("No recent completed jobs").foregroundStyle(Color.primary.opacity(0.72)) }
                        ForEach(completed) { job in
                            historyRow(job.plate, package: job.packageName, date: job.completedAt.flatMap(OperationsDate.parse))
                        }
                    }
                    Section("Archive") {
                        if let archived {
                            Text("Saved \(archived.syncedAt.formatted(date: .abbreviated, time: .shortened))")
                                .font(.footnote).foregroundStyle(Color.primary.opacity(0.72))
                            if archived.jobs.isEmpty { Text("No archived jobs").foregroundStyle(Color.primary.opacity(0.72)) }
                            ForEach(archived.jobs) { job in
                                historyRow(job.plate, package: job.packageName, date: job.completedDate)
                            }
                        } else if !isSyncing {
                            Text("No saved archive").foregroundStyle(Color.primary.opacity(0.72))
                        }
                    }
                }
                .refreshable { await syncArchive() }
            } else {
                ContentUnavailableView("History unavailable", systemImage: "lock",
                    description: Text("Connect and sign in to refresh your saved jobs."))
            }
            }
            .onChange(of: timeline.date) { _, date in
                model.purgeExpiredOfflineHistory(context: context, at: date)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.purgeExpiredOfflineHistory(context: context, at: .now) }
        }
        .navigationTitle("Completed history")
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            archive = try? model.savedArchiveHistory(context: context)
            await syncArchive()
        }
    }

    private func syncArchive() async {
        guard !isSyncing, model.canReadSavedHistory(at: .now) else { return }
        guard model.signedIn else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            archive = try await model.syncArchiveHistory(context: context)
            syncError = nil
        } catch OperationsModel.ArchiveSyncError.batchWithdrawn {
            archive = nil
            syncError = "An archive batch was removed. Pull down to sync available jobs."
        } catch is CancellationError {
            return
        } catch {
            syncError = "Archive could not sync. Pull down to retry."
        }
    }

    private func historyRow(_ plate: String, package: String, date: Date?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(plate).font(.headline)
            Text(package).foregroundStyle(Color.primary.opacity(0.72))
            if let date { Text(date, format: .dateTime.month().day().hour().minute()).font(.caption) }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct JobDetailView: View {
    @Environment(\.modelContext) private var context
    @ObservedObject var model: OperationsModel
    let job: JobDTO
    let endpoint: String
    @State private var selectedEmployee = ""
    private var currentJob: JobDTO { model.jobs.first(where: { $0.id == job.id }) ?? job }

    var body: some View {
        Form {
            Section("Vehicle and time") {
                LabeledContent("Plate", value: currentJob.plate)
                LabeledContent("Status", value: currentJob.status.replacingOccurrences(of: "_", with: " "))
                LabeledContent("Time on site", value: "\(currentJob.elapsedSeconds / 60) min")
                LabeledContent("Package", value: currentJob.packageName)
                LabeledContent("Price", value: "$\(currentJob.priceUsd.formatted())")
            }
            Section("Service checklist") { ForEach(currentJob.services, id: \.self) { service in Text(service) } }
            Section("Employees") {
                if currentJob.assignments.isEmpty { Text("Unassigned").foregroundStyle(Color.primary.opacity(0.72)) }
                ForEach(currentJob.assignments, id: \.employeeId) { employee in Text(employee.employeeName) }
                if model.canOperate && currentJob.status != "completed" && currentJob.status != "cancelled" {
                    Picker("Assign employee", selection: $selectedEmployee) {
                        Text("Select employee").tag("")
                        ForEach(model.employees.filter(\.active)) { employee in Text(employee.name).tag(employee.id) }
                    }
                    Button("Assign") { Task { await model.assign(selectedEmployee, to: currentJob, context: context, endpoint: endpoint) } }
                        .disabled(selectedEmployee.isEmpty).frame(minHeight: 44)
                }
            }
            if model.canOperate {
                Section("Job controls") {
                    if currentJob.status == "arrived" { transitionButton("Queue job", "queued") }
                    if currentJob.status == "queued" { transitionButton("Start work", "in_progress") }
                    if currentJob.status == "in_progress" { transitionButton("Complete job", "completed") }
                }
            }
            if let error = model.error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("Job \(job.plate)")
    }

    private func transitionButton(_ label: String, _ status: String) -> some View {
        Button(label) { Task { await model.transition(currentJob, to: status, context: context, endpoint: endpoint) } }
            .frame(minHeight: 44)
    }
}
