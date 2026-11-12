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
    @StateObject private var model = OperationsModel.forLaunch()
    @Namespace private var jobNavigation
    @State private var demoDestination: String?
    @State private var pendingCompletion: JobDTO?

    private let jobColumns = [GridItem(.adaptive(minimum: 340), spacing: SW.Space.md, alignment: .top)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: SW.Space.xl, pinnedViews: [.sectionHeaders]) {
                    if !model.signedIn {
                        catalogIntro
                        if GoogleClientSettings.current != nil { signInSection }
                    }
                    if model.offlineHistoryAvailable && !model.signedIn {
                        historyLink("Historial de trabajos completados · Sin conexión")
                    }
                    if let summary = model.summary {
                        if DemoSupport.scrollTarget == nil {
                            summarySection(summary)
                            if model.signedIn { historyLink("Historial de trabajos completados") }
                            workboardSection("Llegadas por revisar", symbol: "camera.viewfinder", count: pendingArrivals.count) { arrivalsSection }
                        }
                        if DemoSupport.scrollTarget != "stock" {
                            workboardSection("Trabajos", symbol: "car.side.fill", count: model.jobs.count) { jobsSection }
                        }
                        employeeSection
                        inventorySection
                    }
                    packageSection
                    if !model.signedIn && GoogleClientSettings.current == nil { signInSection }
                }
                .frame(maxWidth: SW.maxContentWidth, alignment: .leading)
                .padding(.horizontal, SW.Space.lg)
                .padding(.bottom, SW.Space.xl)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: model.jobs.count) { _, count in
                if count > 0, demoDestination == nil, let key = DemoSupport.openTarget { demoDestination = key }
            }
            .swScreenBackground()
            .safeAreaInset(edge: .top, spacing: 0) {
                if model.signedIn || model.error != nil {
                    statusView
                        .frame(maxWidth: SW.maxContentWidth)
                        .padding(.horizontal, SW.Space.lg)
                        .padding(.vertical, SW.Space.sm)
                        .frame(maxWidth: .infinity)
                        .background(Color.swBackground)
                }
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.25),
                       value: model.jobs.map { "\($0.id):\($0.status)" })
            .confirmationDialog("¿Completar este trabajo?", isPresented: Binding(
                get: { pendingCompletion != nil }, set: { if !$0 { pendingCompletion = nil } }),
                titleVisibility: .visible, presenting: pendingCompletion) { job in
                Button("Completar \(job.plate)") {
                    Task { await model.transition(job, to: "completed", context: context, endpoint: endpoint) }
                }
            } message: { job in
                Text("El vehículo \(job.plate) pasará a Completado.")
            }
            .navigationDestination(item: $demoDestination) { key in demoDestinationView(key) }
            .navigationTitle(model.signedIn ? "Tablero" : "Car Spa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.signedIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Salir") { model.signOut(context: context) }
                            .accessibilityLabel("Cerrar sesión")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Actualizar", systemImage: "arrow.clockwise") { Task { await model.refresh(context: context, endpoint: endpoint) } }
                        .labelStyle(.iconOnly)
                        .frame(minWidth: SW.minTouch, minHeight: SW.minTouch)
                        .accessibilityLabel("Actualizar operaciones")
                        .disabled(model.isLoading)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: { Label("Ajustes", systemImage: "gearshape").labelStyle(.iconOnly) }
                        .frame(minWidth: SW.minTouch, minHeight: SW.minTouch)
                        .accessibilityLabel("Ajustes del servidor")
                }
            }
            .task(id: RefreshScope(endpoint: endpoint, active: scenePhase == .active, signedIn: model.signedIn)) {
                if model.endpoint != endpoint {
                    model.restore(context: context, endpoint: endpoint)
                }
                await model.demoSignInIfRequested(context: context, endpoint: endpoint)
                
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
        .tint(Color.swBrand)
    }

    @ViewBuilder
    private func demoDestinationView(_ key: String) -> some View {
        #if DEBUG
        switch key {
        case "job": if let job = model.jobs.first { JobDetailView(model: model, job: job, endpoint: endpoint) }
        case "arrival": if let arrival = model.arrivals.first { ArrivalReviewView(model: model, arrival: arrival, endpoint: endpoint) }
        case "history": CompletedHistoryView(model: model)
        default: EmptyView()
        }
        #else
        EmptyView()
        #endif
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

    private var pendingArrivals: [ArrivalDTO] {
        let linked = Set(model.jobs.map(\.arrivalId))
        return model.arrivals.filter { !linked.contains($0.id) }
    }

    // MARK: Status banner

    private var statusView: some View {
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            HStack(spacing: SW.Space.sm) {
                if model.isLoading {
                    ProgressView().controlSize(.small)
                    Text("Actualizando operaciones…")
                } else if model.isStale {
                    Image(systemName: "wifi.slash").foregroundStyle(Color.swWarning).accessibilityHidden(true)
                    Text(model.savedAt == nil ? "Operaciones no disponibles" : "Mostrando la última sincronización").fontWeight(.semibold)
                } else {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.swSuccess).accessibilityHidden(true)
                    Text("Actualizado \(model.savedAt?.formatted(date: .omitted, time: .shortened) ?? "")")
                }
                Spacer(minLength: 0)
            }
            .font(.swBody)
            .contentTransition(.opacity)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.isStale)
            if let error = model.error { SWBanner(kind: .danger, text: error) }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Signed-out hero and sign-in

    private var catalogIntro: some View {
        VStack(alignment: .leading, spacing: SW.Space.md) {
            HStack(spacing: SW.Space.md) {
                SWBrandMark(size: 52, onDark: true)
                Text("Car Spa").font(.system(.title3, design: .rounded, weight: .bold)).foregroundStyle(.white)
            }
            Text("Tu auto, como nuevo")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Text("Compara los paquetes de detallado y consulta el precio para tu vehículo.")
                .font(.swBody)
                .foregroundStyle(.white.opacity(0.92))
            Label("Precios por tipo de vehículo", systemImage: "tag.fill")
                .font(.swPill)
                .foregroundStyle(Color.swOnCoral)
                .padding(.horizontal, SW.Space.md).padding(.vertical, 6)
                .background(Color.swCoral, in: Capsule())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(SW.Space.xl)
        .background(LinearGradient(colors: [Color(0x13213A), Color(0x0F766E)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: SW.Radius.lg, style: .continuous))
        .padding(.top, SW.Space.sm)
    }

    private var signInSection: some View {
        VStack(alignment: .leading, spacing: SW.Space.md) {
            Label("Acceso del personal", systemImage: "person.badge.key.fill").font(.swSection).foregroundStyle(Color.swInk)
            if let ids = GoogleClientSettings.current {
                Text("Inicia sesión con tu cuenta de Google autorizada para ver el tablero de trabajo.")
                    .font(.swBody).foregroundStyle(Color.swTextSecondary)
                GoogleSignInButton {
                    Task { await signIn(ids) }
                }
                .frame(maxWidth: 320, minHeight: 48)
                .accessibilityLabel("Iniciar sesión con Google como personal de Car Spa")
            } else {
                SWBanner(kind: .info, text: "El acceso del personal no está disponible en este dispositivo.", symbol: "lock.fill")
            }
        }
        .swCard()
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

    // MARK: Floor summary

    private func summarySection(_ summary: JobSummaryDTO) -> some View {
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            SWSectionHeader(title: "Resumen del piso", symbol: "gauge.with.dots.needle.67percent")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: SW.Space.md)], spacing: SW.Space.md) {
                SWMetricTile(label: "En proceso", value: summary.inProgress.formatted(), symbol: "sparkles", tint: .swInfo)
                SWMetricTile(label: "En espera", value: (summary.arrived + summary.queued).formatted(), symbol: "clock.fill", tint: .swWarning)
                SWMetricTile(label: "Completados hoy (UTC)", value: summary.completedTodayUtc.formatted(), symbol: "checkmark.circle.fill", tint: .swSuccess)
                SWMetricTile(label: "Promedio en sitio", value: SWFormat.duration(seconds: summary.averageCompletedSeconds ?? 0),
                             symbol: "stopwatch.fill", tint: .swBrand)
                if model.jobs.contains(where: JobPaymentPresentation.hasPaymentInfo) {
                    SWMetricTile(label: "Por cobrar", value: JobPaymentPresentation.receivableCount(model.jobs).formatted(),
                                 symbol: "dollarsign.circle.fill", tint: .swAlert)
                        .accessibilityIdentifier("receivable-count")
                }
            }
        }
    }

    private func historyLink(_ title: String) -> some View {
        NavigationLink { CompletedHistoryView(model: model) } label: {
            HStack(spacing: SW.Space.md) {
                Image(systemName: "clock.arrow.circlepath").foregroundStyle(Color.swBrand).accessibilityHidden(true)
                Text(title).font(.headline).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.swTextSecondary).accessibilityHidden(true)
            }
            .frame(minHeight: SW.minTouch)
            .swCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func workboardSection<Content: View>(_ title: String, symbol: String, count: Int, @ViewBuilder content: () -> Content) -> some View {
        Section {
            content()
        } header: {
            SWSectionHeader(title: title, symbol: symbol, count: count)
                .background(Color.swBackground)
        }
    }

    // MARK: Arrivals

    private var arrivalsSection: some View {
        VStack(alignment: .leading, spacing: SW.Space.md) {
            let pending = pendingArrivals
            if pending.isEmpty {
                SWEmptyState(symbol: "camera.viewfinder", title: "No hay llegadas esperando un trabajo")
            }
            LazyVGrid(columns: jobColumns, spacing: SW.Space.md) {
                ForEach(pending) { arrival in
                    NavigationLink {
                        ArrivalReviewView(model: model, arrival: arrival, endpoint: endpoint)
                    } label: {
                        HStack(alignment: .center, spacing: SW.Space.md) {
                            VStack(alignment: .leading, spacing: SW.Space.sm) {
                                if let plate = arrival.confirmedPlate ?? arrival.plateCandidate {
                                    SWPlate(plate: plate)
                                } else {
                                    Text("Placa ilegible").font(.swPlate).foregroundStyle(Color.swTextSecondary)
                                }
                                SWFlowLayout(spacing: SW.Space.sm) {
                                    if arrival.confirmedPlate == nil {
                                        SWChip(text: "Por revisar", symbol: "exclamationmark.triangle.fill", tint: .swWarning)
                                    } else {
                                        SWChip(text: "Confirmada", symbol: "checkmark.seal.fill", tint: .swSuccess)
                                    }
                                    if let confidence = arrival.confidence {
                                        SWChip(text: "Confianza \(Int(confidence * 100)) %", symbol: "scope", tint: .swNeutral)
                                    }
                                }
                                Label("Cámara \(arrival.cameraId)", systemImage: "camera.fill")
                                    .font(.swMeta).foregroundStyle(Color.swTextSecondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.swTextSecondary).accessibilityHidden(true)
                        }
                        .frame(minHeight: SW.minTouch)
                        .swCard(stripe: .swWarning)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(arrivalAccessibilityLabel(arrival))
                }
            }
        }
    }

    // MARK: Job board

    private var jobsSection: some View {
        VStack(alignment: .leading, spacing: SW.Space.md) {
                        if model.jobs.isEmpty {
                SWEmptyState(symbol: "car.side", title: "Aún no hay trabajos de vehículos")
            }
            LazyVGrid(columns: jobColumns, spacing: SW.Space.md) {
                ForEach(model.jobs) { job in jobCard(job) }
            }
        }
    }

    private func jobCard(_ job: JobDTO) -> some View {
        let status = JobStatus(raw: job.status)
        return VStack(alignment: .leading, spacing: SW.Space.md) {
            NavigationLink {
                let detail = JobDetailView(model: model, job: job, endpoint: endpoint)
                if reduceMotion {
                    detail
                } else {
                    detail.navigationTransition(.zoom(sourceID: job.id, in: jobNavigation))
                }
            } label: {
                VStack(alignment: .leading, spacing: SW.Space.sm) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center) {
                            SWPlate(plate: job.plate).fixedSize()
                            Spacer(minLength: SW.Space.sm)
                            StatusPill(status: status)
                        }
                        VStack(alignment: .leading, spacing: SW.Space.sm) {
                            SWPlate(plate: job.plate)
                            StatusPill(status: status)
                        }
                    }
                    Text("\(job.packageName) · \(SWFormat.vehicleClassName(job.vehicleClass))")
                        .font(.swCardTitle)
                    SWFlowLayout(spacing: SW.Space.md) {
                        Label(SWFormat.duration(seconds: job.elapsedSeconds), systemImage: "stopwatch")
                        Label(job.assignments.isEmpty ? "Sin asignar" : job.assignments.map(\.employeeName).joined(separator: ", "),
                              systemImage: job.assignments.isEmpty ? "person.crop.circle.badge.questionmark" : "person.2.fill")
                        Text(JobPaymentPresentation.money(job.priceUsd)).monospacedDigit().fontWeight(.semibold)
                    }
                    .font(.swBody)
                    .foregroundStyle(Color.swTextSecondary)
                    JobPosInfoView(job: job)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .matchedTransitionSource(id: job.id, in: jobNavigation)
            .buttonStyle(.plain)
            .accessibilityLabel(jobAccessibilityLabel(job))

            if model.canOperate, let next = status.next {
                Button {
                    if next.status == "completed" {
                        pendingCompletion = job
                    } else {
                        Task { await model.transition(job, to: next.status, context: context, endpoint: endpoint) }
                    }
                } label: {
                    Label(next.title, systemImage: next.symbol)
                }
                .buttonStyle(SWButtonStyle(kind: next.status == "completed" ? .primary : .secondary))
                .accessibilityLabel("\(next.title) para \(job.plate)")
                .accessibilityIdentifier("job-next-action")
            }
        }
        .swCard(stripe: status.tint)
    }

    private func arrivalAccessibilityLabel(_ arrival: ArrivalDTO) -> String {
        let plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? "placa ilegible"
        let reviewState = arrival.confirmedPlate == nil ? "Requiere revisión del personal" : "Placa confirmada"
        let confidence = arrival.confidence.map { "Confianza del candidato \(Int(($0 * 100).rounded())) por ciento" }
        return ["Revisar llegada de \(plate)", "Cámara \(arrival.cameraId)", reviewState, confidence]
            .compactMap { $0 }
            .joined(separator: ". ")
    }

    private func jobAccessibilityLabel(_ job: JobDTO) -> String {
        let assignment = job.assignments.isEmpty
            ? "Sin personal asignado"
            : "Asignado a " + job.assignments.map(\.employeeName).joined(separator: ", ")
        let pos = [JobPaymentPresentation.ticketLabel(job), job.isDesktopPos ? JobPaymentPresentation.sourceBadge : nil,
                   job.customerName, JobPaymentPresentation.hasPaymentInfo(job) ? JobPaymentPresentation.chip(for: job).text : nil].compactMap { $0 }.joined(separator: ", ")
        return "Trabajo de \(job.plate). \(pos). \(JobStatus(raw: job.status).label). \(job.packageName), \(SWFormat.vehicleClassName(job.vehicleClass)). \(job.priceUsd.formatted(.currency(code: "USD"))). \(SWFormat.duration(seconds: job.elapsedSeconds)) en sitio. \(assignment)."
    }

    // MARK: Team and stock

    private var employeeSection: some View {
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            SWSectionHeader(title: "Empleados", symbol: "person.2.fill", count: model.employees.count)
            if model.employees.isEmpty { SWEmptyState(symbol: "person.2", title: "Aún no hay empleados") }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: SW.Space.md, alignment: .top)], spacing: SW.Space.md) {
                ForEach(model.employees) { employee in
                    HStack(spacing: SW.Space.md) {
                        Text(String(employee.name.split(separator: " ").prefix(2).compactMap(\.first)))
                            .font(.system(.subheadline, design: .rounded, weight: .bold))
                            .foregroundStyle(employee.active ? Color.swBrand : Color.swNeutral)
                            .frame(width: 40, height: 40)
                            .background((employee.active ? Color.swBrand : Color.swNeutral).opacity(0.14), in: Circle())
                            .accessibilityHidden(true)
                        Text(employee.name).font(.headline)
                        Spacer(minLength: SW.Space.sm)
                        SWChip(text: employee.active ? "Activo" : "Inactivo",
                               symbol: employee.active ? "checkmark.circle.fill" : "pause.circle.fill",
                               tint: employee.active ? .swSuccess : .swNeutral)
                    }
                    .frame(minHeight: SW.minTouch)
                    .swCard(padding: SW.Space.md)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var inventorySection: some View {
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            SWSectionHeader(title: "Recursos e inventario", symbol: "shippingbox.fill", count: model.inventory.count)
            if model.inventory.isEmpty { SWEmptyState(symbol: "shippingbox", title: "Aún no hay compuestos ni insumos") }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: SW.Space.md, alignment: .top)], spacing: SW.Space.md) {
                ForEach(model.inventory) { stock in
                    VStack(alignment: .leading, spacing: SW.Space.sm) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(stock.item.name).font(.headline)
                            Spacer(minLength: SW.Space.sm)
                            if stock.needsReorder {
                                SWChip(text: "Reordenar", symbol: "exclamationmark.triangle.fill", tint: .swAlert)
                            }
                        }
                        Text("\(stock.available.formatted()) \(stock.item.unit) disponibles · \(stock.reserved.formatted()) reservados")
                            .font(.swBody).foregroundStyle(Color.swTextSecondary)
                    }
                    .swCard(stripe: stock.needsReorder ? .swAlert : nil)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    // MARK: Package catalog

    private var packageSection: some View {
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            SWSectionHeader(title: "Paquetes de detallado", symbol: "sparkles")
            if let catalog = model.catalog {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: SW.Space.md, alignment: .top)], spacing: SW.Space.md) {
                    ForEach(catalog.packages) { package in
                        VStack(alignment: .leading, spacing: SW.Space.md) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(package.name).font(.title3.weight(.bold)).foregroundStyle(Color.swInk)
                                Text(package.subtitle).font(.swBody).foregroundStyle(Color.swTextSecondary)
                            }
                            if let from = package.prices.values.min() {
                                Text("Desde \(Decimal(from).formatted(.currency(code: catalog.currency).precision(.fractionLength(0))))")
                                    .font(.swPill).foregroundStyle(Color.swBrand)
                                    .padding(.horizontal, SW.Space.sm).padding(.vertical, 4)
                                    .background(Color.swBrand.opacity(0.12), in: Capsule())
                            }
                            Divider()
                            ForEach(catalog.vehicleClasses, id: \.id) { vehicle in
                                if let price = package.price(for: vehicle.id) {
                                    SWInfoRow(label: vehicle.name,
                                              value: Decimal(price).formatted(.currency(code: catalog.currency).precision(.fractionLength(0))))
                                }
                            }
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(package.items, id: \.self) { item in
                                        Label(item, systemImage: "checkmark").font(.swBody)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, SW.Space.xs)
                            } label: {
                                Text("\(package.items.count) servicios incluidos")
                                    .font(.swBody.weight(.medium))
                                    .frame(minHeight: SW.minTouch)
                            }
                        }
                        .swCard(padding: SW.Space.lg)
                    }
                }
            } else if model.error == nil {
                ProgressView("Cargando el menú de servicios…")
            } else {
                SWBanner(kind: .info, text: "El menú de servicios no está disponible. Usa Actualizar para reintentar.")
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

// MARK: - Arrival review

private struct ArrivalReviewView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: OperationsModel
    let arrival: ArrivalDTO
    let endpoint: String
    @State private var plate = ""
    @State private var vehicleClass = "car"
    @State private var packageId = "essential"

    private var canSubmit: Bool { plate.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SW.Space.lg) {
                VStack(alignment: .leading, spacing: SW.Space.md) {
                    Label("Observación de cámara", systemImage: "camera.viewfinder").font(.swSection).foregroundStyle(Color.swInk)
                    if let candidate = arrival.plateCandidate {
                        SWPlate(plate: candidate, font: .system(.largeTitle, design: .rounded, weight: .heavy))
                    } else {
                        Text("Placa ilegible").font(.system(.title, design: .rounded, weight: .heavy)).foregroundStyle(Color.swTextSecondary)
                    }
                    SWFlowLayout(spacing: SW.Space.sm) {
                        SWChip(text: "Cámara \(arrival.cameraId)", symbol: "camera.fill", tint: .swNeutral)
                        SWChip(text: arrival.confidence.map { "Confianza \(Int($0 * 100)) %" } ?? "Confianza no disponible",
                               symbol: "scope", tint: .swNeutral)
                        if let received = arrival.receivedDate {
                            SWChip(text: "Recibida \(received.formatted(date: .omitted, time: .shortened))", symbol: "clock", tint: .swNeutral)
                        }
                    }
                    SWBanner(kind: .warning, text: "Un candidato necesita confirmación del personal antes de abrir un trabajo.")
                }
                .swCard()

                VStack(alignment: .leading, spacing: SW.Space.md) {
                    Label("Confirmar vehículo", systemImage: "checkmark.seal.fill").font(.swSection).foregroundStyle(Color.swInk)
                    VStack(alignment: .leading, spacing: SW.Space.xs) {
                        Text("Placa").font(.swMeta.weight(.semibold)).foregroundStyle(Color.swTextSecondary)
                        TextField("Número de placa", text: $plate)
                            .font(.swPlate)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .disabled(arrival.confirmedPlate != nil)
                            .padding(SW.Space.md)
                            .frame(minHeight: SW.minTouch)
                            .background(Color.swBackground, in: RoundedRectangle(cornerRadius: SW.Radius.sm, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: SW.Radius.sm, style: .continuous).strokeBorder(Color.swBorder, lineWidth: 1.5))
                    }
                    pickerRow("Tipo de vehículo") {
                        Picker("Tipo de vehículo", selection: $vehicleClass) {
                            ForEach(model.catalog?.vehicleClasses ?? [], id: \.id) { item in Text(item.name).tag(item.id) }
                        }.disabled(arrival.vehicleClass != nil)
                    }
                    pickerRow("Paquete de detallado") {
                        Picker("Paquete de detallado", selection: $packageId) {
                            ForEach(model.catalog?.packages ?? []) { item in Text(item.name).tag(item.id) }
                        }
                    }
                    if let package = model.catalog?.packages.first(where: { $0.id == packageId }), let price = package.price(for: vehicleClass) {
                        SWBanner(kind: .info, text: "Sugerido: \(package.name) · $\(price). Confirma la elección antes de abrir el trabajo.", symbol: "tag.fill")
                    }
                }
                .swCard()

                if model.canOperate {
                    Button {
                        Task {
                            await model.confirmAndOpen(arrival, plate: plate, vehicleClass: vehicleClass,
                                packageId: packageId, context: context, endpoint: endpoint)
                            if model.error == nil { dismiss() }
                        }
                    } label: {
                        Label(arrival.confirmedPlate == nil ? "Confirmar y abrir trabajo" : "Abrir trabajo", systemImage: "checkmark.circle.fill")
                    }
                    .buttonStyle(.swPrimary)
                    .disabled(!canSubmit)
                } else {
                    SWBanner(kind: .info, text: "Tu rol es de solo lectura: no puedes abrir trabajos.", symbol: "lock.fill")
                }
                if let error = model.error { SWBanner(kind: .danger, text: error) }
            }
            .frame(maxWidth: 720)
            .padding(SW.Space.lg)
            .frame(maxWidth: .infinity)
        }
        .swScreenBackground()
        .navigationTitle("Revisar llegada")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? ""; vehicleClass = arrival.vehicleClass ?? "car" }
    }

    private func pickerRow<P: View>(_ title: String, @ViewBuilder picker: () -> P) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                Text(title).font(.swBody).foregroundStyle(Color.swTextSecondary)
                Spacer(minLength: SW.Space.sm)
                picker().labelsHidden().pickerStyle(.menu)
            }
            VStack(alignment: .leading, spacing: SW.Space.xs) {
                Text(title).font(.swBody).foregroundStyle(Color.swTextSecondary)
                picker().labelsHidden().pickerStyle(.menu)
            }
        }
        .frame(minHeight: SW.minTouch)
    }
}

// MARK: - Completed history

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
                            Label("Última sincronización \(synced.formatted(date: .abbreviated, time: .shortened))",
                                  systemImage: model.isStale ? "wifi.slash" : "checkmark.circle.fill")
                                .font(.swBody)
                        }
                        if isSyncing { ProgressView("Sincronizando archivo…") }
                        if let syncError { Text(syncError).font(.swMeta).foregroundStyle(Color.swTextSecondary) }
                    }
                    .listRowBackground(Color.swSurface)
                    Section("Trabajos completados") {
                        if completed.isEmpty { Text("No hay trabajos completados recientes").foregroundStyle(Color.swTextSecondary) }
                        ForEach(completed) { job in
                            historyRow(job.plate, package: job.packageName, date: job.completedAt.flatMap(OperationsDate.parse))
                        }
                    }
                    .listRowBackground(Color.swSurface)
                    Section("Archivo") {
                        if let archived {
                            Text("Guardado \(archived.syncedAt.formatted(date: .abbreviated, time: .shortened))")
                                .font(.swMeta).foregroundStyle(Color.swTextSecondary)
                            if archived.jobs.isEmpty { Text("No hay trabajos archivados").foregroundStyle(Color.swTextSecondary) }
                            ForEach(archived.jobs) { job in
                                historyRow(job.plate, package: job.packageName, date: job.completedDate)
                            }
                        } else if !isSyncing {
                            Text("No hay archivo guardado").foregroundStyle(Color.swTextSecondary)
                        }
                    }
                    .listRowBackground(Color.swSurface)
                }
                .scrollContentBackground(.hidden)
                .refreshable { await syncArchive() }
            } else {
                ContentUnavailableView("Historial no disponible", systemImage: "lock",
                    description: Text("Conéctate e inicia sesión para actualizar tus trabajos guardados."))
            }
            }
            .onChange(of: timeline.date) { _, date in
                model.purgeExpiredOfflineHistory(context: context, at: date)
            }
        }
        .swScreenBackground()
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.purgeExpiredOfflineHistory(context: context, at: .now) }
        }
        .navigationTitle("Historial completado")
        .navigationBarTitleDisplayMode(.inline)
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
            syncError = "Se retiró un lote del archivo. Desliza hacia abajo para sincronizar los trabajos disponibles."
        } catch is CancellationError {
            return
        } catch {
            syncError = "No se pudo sincronizar el archivo. Desliza hacia abajo para reintentar."
        }
    }

    private func historyRow(_ plate: String, package: String, date: Date?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: SW.Space.md) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.swSuccess).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(plate).font(.system(.headline, design: .rounded, weight: .heavy))
                Text(package).font(.swBody).foregroundStyle(Color.swTextSecondary)
                if let date { Text(date, format: .dateTime.month().day().hour().minute()).font(.swMeta).foregroundStyle(Color.swTextSecondary) }
            }
        }
        .frame(minHeight: SW.minTouch, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - POS info

private struct PaymentChipView: View {
    let chip: JobPaymentPresentation.Chip

    var body: some View {
        switch chip.kind {
        case .paid: SWChip(text: chip.text, symbol: "checkmark.seal.fill", tint: .swSuccess)
        case .partial: SWChip(text: chip.text, symbol: "circle.lefthalf.filled", tint: .swWarning)
        case .unpaid: SWChip(text: chip.text, symbol: "exclamationmark.circle.fill", tint: .swAlert)
        }
    }
}

/// Work-ticket number, source badge, customer, note and payment chip shown in job list rows.
private struct JobPosInfoView: View {
    let job: JobDTO

    var body: some View {
        let hasChips = job.isDesktopPos || JobPaymentPresentation.hasPaymentInfo(job)
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            if JobPaymentPresentation.ticketLabel(job) != nil || hasChips {
                SWFlowLayout(spacing: SW.Space.sm) {
                    if let ticket = JobPaymentPresentation.ticketLabel(job) {
                        Text(ticket).font(.swBody.weight(.medium)).monospacedDigit().accessibilityIdentifier("job-ticket-number")
                    }
                    if job.isDesktopPos {
                        SWChip(text: JobPaymentPresentation.sourceBadge, symbol: "desktopcomputer", tint: .swPOS)
                    }
                    if JobPaymentPresentation.hasPaymentInfo(job) {
                        PaymentChipView(chip: JobPaymentPresentation.chip(for: job)).accessibilityIdentifier("job-payment-status")
                    }
                }
            }
            if let name = job.customerName, !name.isEmpty {
                Label(name, systemImage: "person.fill").font(.swBody)
            }
            if let note = job.note, !note.isEmpty {
                Text(note).font(.swMeta).foregroundStyle(Color.swTextSecondary).lineLimit(2)
            }
        }
    }
}

// MARK: - Job detail

private struct JobDetailView: View {
    @Environment(\.modelContext) private var context
    @ObservedObject var model: OperationsModel
    let job: JobDTO
    let endpoint: String
    @State private var selectedEmployee = ""
    @State private var confirmingCompletion = false
    private var currentJob: JobDTO { model.jobs.first(where: { $0.id == job.id }) ?? job }

    var body: some View {
        let current = currentJob
        let status = JobStatus(raw: current.status)
        ScrollView {
            VStack(alignment: .leading, spacing: SW.Space.lg) {
                // Header: the plate is the primary datum.
                VStack(alignment: .leading, spacing: SW.Space.md) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center) {
                            SWPlate(plate: current.plate, font: .system(.largeTitle, design: .rounded, weight: .heavy)).fixedSize()
                            Spacer(minLength: SW.Space.sm)
                            StatusPill(status: status)
                        }
                        VStack(alignment: .leading, spacing: SW.Space.sm) {
                            SWPlate(plate: current.plate, font: .system(.largeTitle, design: .rounded, weight: .heavy))
                            StatusPill(status: status)
                        }
                    }
                    Text("\(current.packageName) · \(SWFormat.vehicleClassName(current.vehicleClass))").font(.swCardTitle)
                    SWFlowLayout(spacing: SW.Space.lg) {
                        Label(SWFormat.duration(seconds: current.elapsedSeconds), systemImage: "stopwatch")
                        Label(JobPaymentPresentation.money(current.priceUsd), systemImage: "dollarsign.circle")
                    }
                    .font(.swBody).foregroundStyle(Color.swTextSecondary)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Tiempo en sitio \(SWFormat.duration(seconds: current.elapsedSeconds)). Precio \(JobPaymentPresentation.money(current.priceUsd))")
                }
                .swCard(stripe: status.tint)

                ticketCard(current)

                VStack(alignment: .leading, spacing: SW.Space.sm) {
                    Label("Lista de servicios", systemImage: "checklist").font(.swSection).foregroundStyle(Color.swInk)
                    ForEach(current.services, id: \.self) { service in
                        Label(service, systemImage: "checkmark.circle").font(.swBody)
                            .frame(minHeight: 32, alignment: .leading)
                    }
                }
                .swCard()

                teamCard(current)

                if let error = model.error { SWBanner(kind: .danger, text: error) }
            }
            .frame(maxWidth: 720)
            .padding(SW.Space.lg)
            .frame(maxWidth: .infinity)
        }
        .swScreenBackground()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if model.canOperate, let next = status.next {
                Button {
                    if next.status == "completed" { confirmingCompletion = true }
                    else { Task { await model.transition(current, to: next.status, context: context, endpoint: endpoint) } }
                } label: {
                    Label(next.title, systemImage: next.symbol)
                }
                .buttonStyle(.swPrimary)
                .accessibilityIdentifier("job-detail-next-action")
                .padding(.horizontal, SW.Space.lg).padding(.vertical, SW.Space.md)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .background(.bar)
            }
        }
        .confirmationDialog("¿Completar este trabajo?", isPresented: $confirmingCompletion, titleVisibility: .visible) {
            Button("Completar \(current.plate)") {
                Task { await model.transition(current, to: "completed", context: context, endpoint: endpoint) }
            }
        }
        .navigationTitle("Trabajo \(job.plate)")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func ticketCard(_ current: JobDTO) -> some View {
        VStack(alignment: .leading, spacing: SW.Space.md) {
            Label("Ticket y cobro", systemImage: "receipt").font(.swSection).foregroundStyle(Color.swInk)
            if let ticket = current.ticketNumber, !ticket.isEmpty {
                SWInfoRow(label: "Ticket de trabajo", value: ticket).accessibilityIdentifier("job-ticket-number")
            }
            if current.isDesktopPos { SWInfoRow(label: "Origen", value: JobPaymentPresentation.sourceBadge) }
            if let name = current.customerName, !name.isEmpty { SWInfoRow(label: "Cliente", value: name) }
            if let note = current.note, !note.isEmpty { SWInfoRow(label: "Nota", value: note) }
            if JobPaymentPresentation.hasPaymentInfo(current) {
                HStack {
                    Text("Pago").font(.swBody).foregroundStyle(Color.swTextSecondary)
                    Spacer(minLength: SW.Space.sm)
                    PaymentChipView(chip: JobPaymentPresentation.chip(for: current)).accessibilityIdentifier("job-payment-status")
                }
            }
            ForEach(current.payments ?? []) { payment in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(JobPaymentPresentation.methodLabel(payment.method)).font(.swBody)
                        Spacer()
                        Text(JobPaymentPresentation.money(payment.amountUsd)).monospacedDigit().fontWeight(.semibold)
                    }
                    let detail = [payment.ticketNumber.map { "Venta \($0)" },
                                  payment.recordedDate.map { $0.formatted(date: .abbreviated, time: .shortened) }]
                        .compactMap { $0 }.joined(separator: " · ")
                    if !detail.isEmpty {
                        Text(detail).font(.swMeta).foregroundStyle(Color.swTextSecondary)
                    }
                }
                .padding(SW.Space.md)
                .background(Color.swBackground, in: RoundedRectangle(cornerRadius: SW.Radius.sm, style: .continuous))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("job-payment-row")
            }
        }
        .swCard()
    }

    private func teamCard(_ current: JobDTO) -> some View {
        VStack(alignment: .leading, spacing: SW.Space.md) {
            Label("Empleados", systemImage: "person.2.fill").font(.swSection).foregroundStyle(Color.swInk)
            if current.assignments.isEmpty { Text("Sin asignar").font(.swBody).foregroundStyle(Color.swTextSecondary) }
            ForEach(current.assignments, id: \.employeeId) { employee in
                Label(employee.employeeName, systemImage: "person.fill").font(.swBody)
                    .frame(minHeight: 32, alignment: .leading)
            }
            if model.canOperate && current.status != "completed" && current.status != "cancelled" {
                Divider()
                Picker("Asignar empleado", selection: $selectedEmployee) {
                    Text("Seleccionar empleado").tag("")
                    ForEach(model.employees.filter(\.active)) { employee in Text(employee.name).tag(employee.id) }
                }
                .frame(minHeight: SW.minTouch)
                Button {
                    Task { await model.assign(selectedEmployee, to: current, context: context, endpoint: endpoint) }
                } label: {
                    Label("Asignar", systemImage: "person.badge.plus")
                }
                .buttonStyle(.swSecondary)
                .disabled(selectedEmployee.isEmpty)
            }
        }
        .swCard()
    }
}
