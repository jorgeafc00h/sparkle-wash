import Foundation
import Network
import Observation
import SparkleKit

/// Keeps the SwiftData cache in step with the server:
/// - pull: refresh arrivals, jobs, devices, employees, catalog and summary;
/// - push: replay queued operations in order (idempotent, so retries are safe);
/// - live: the server's change feed triggers a pull; the connection status drives retries.
@MainActor
@Observable
final class SyncEngine {
    private(set) var isOnline = true
    private(set) var isSyncing = false
    private(set) var lastSync: Date?
    private(set) var pendingCount = 0
    /// Bumped after every change to the cache, so views re-read it.
    private(set) var revision = 0
    /// Messages for changes the server refused after they were made offline.
    var rejections: [String] = []

    @ObservationIgnored let api: SparkleAPI
    @ObservationIgnored let store: LocalStore
    @ObservationIgnored private let onUnauthorized: () -> Void
    @ObservationIgnored private var liveTask: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var monitor: NWPathMonitor?
    @ObservationIgnored private var describe: (APIError) -> String = { "\($0)" }

    init(api: SparkleAPI, store: LocalStore, onUnauthorized: @escaping () -> Void) {
        self.api = api
        self.store = store
        self.onUnauthorized = onUnauthorized
        pendingCount = store.pendingOperations().count
    }

    func setErrorDescriber(_ describe: @escaping (APIError) -> String) { self.describe = describe }

    func start() {
        guard liveTask == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let wasOnline = self.isOnline
                if path.status != .satisfied { self.isOnline = false }
                if path.status == .satisfied && !wasOnline { await self.sync() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "sparklewash.network"))
        self.monitor = monitor
        liveTask = Task { [weak self] in await self?.listen() }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await self?.sync()
            }
        }
        Task { await sync() }
    }

    func stop() {
        liveTask?.cancel()
        pollTask?.cancel()
        monitor?.cancel()
        liveTask = nil
        pollTask = nil
        monitor = nil
    }

    /// Push queued changes, then pull fresh data.
    func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        await flush()
        await pull()
    }

    /// Records a change locally (visible immediately) and tries to send it.
    func perform(_ operation: OutboxOperation) async {
        store.enqueue(operation)
        pendingCount = store.pendingOperations().count
        revision += 1
        await flush()
        if isOnline { await pull() }
    }

    func flush() async {
        for pending in store.pendingOperations() {
            guard let operation = pending.operation else { store.remove(pending); continue }
            let result = await OutboxProcessor.run(operation, on: api)
            switch result {
            case .done:
                store.remove(pending)
                isOnline = true
            case .retryLater:
                pending.attempts += 1
                store.save()
                isOnline = false
                pendingCount = store.pendingOperations().count
                revision += 1
                return // keep order: later operations may depend on this one
            case .rejected(let error):
                store.remove(pending)
                if error == .unauthorized { onUnauthorized(); return }
                rejections.append(describe(error))
            }
        }
        pendingCount = store.pendingOperations().count
        revision += 1
    }

    func pull() async {
        do {
            async let arrivals = api.arrivals(pendingOnly: false, limit: 100)
            async let jobs = api.jobs()
            async let summary = api.jobSummary()
            async let employees = api.employees()
            let (arrivalList, jobList, summaryValue, employeeList) = try await (arrivals, jobs, summary, employees)
            store.replaceArrivals(arrivalList)
            store.replaceJobs(jobList)
            store.putDocument(summaryValue, "summary")
            store.replaceEmployees(employeeList)
            if store.document(Catalog.self, "catalog") == nil || Int.random(in: 0..<20) == 0 {
                store.putDocument(try await api.catalog(), "catalog")
            }
            if let devices = try? await api.devices() { store.replaceDevices(devices) }
            isOnline = true
            lastSync = Date()
            revision += 1
        } catch let error as APIError {
            if error == .unauthorized { onUnauthorized() } else if error.isRetryable { isOnline = false }
        } catch is CancellationError {
        } catch {
            isOnline = false
        }
    }

    /// Fetches and caches an arrival photo (photos are kept so the review works offline).
    func photo(for arrival: ArrivalObservation) async -> Data? {
        if let cached = store.photo(arrivalId: arrival.id) { return cached }
        guard arrival.photoId != nil, let data = try? await api.arrivalPhoto(id: arrival.id) else { return nil }
        store.putPhoto(data, arrivalId: arrival.id)
        return data
    }

    private func listen() async {
        var delay: UInt64 = 2
        while !Task.isCancelled {
            do {
                for try await _ in api.changes() {
                    delay = 2
                    await pull()
                }
            } catch APIError.unauthorized {
                onUnauthorized()
                return
            } catch {}
            if Task.isCancelled { return }
            try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            delay = min(delay * 2, 30)
        }
    }
}
