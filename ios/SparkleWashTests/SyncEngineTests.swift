import SparkleKit
import SwiftData
import XCTest
@testable import SparkleWash

/// The engine against the demo backend behind an on/off "network" switch: offline changes must show up
/// locally at once, survive refreshes, and reach the server in order when the connection returns.
@MainActor
final class SyncEngineTests: XCTestCase {
    private var demo: DemoBackend!
    private var network: OfflineSwitchAPI!
    private var engine: SyncEngine!
    private var container: ModelContainer! // the engine's context needs its container alive
    private var expired = 0

    override func setUp() async throws {
        demo = DemoBackend()
        network = OfflineSwitchAPI(base: demo)
        container = try CacheSchema.container(inMemory: true)
        let session = try await demo.session()
        let store = LocalStore(context: container.mainContext, tenantId: session.tenant.id)
        engine = SyncEngine(api: network, store: store) { [weak self] in self?.expired += 1 }
        await engine.sync()
    }

    func testPullFillsTheCache() async throws {
        let serverJobs = try await demo.jobs()
        XCTAssertEqual(Set(engine.store.jobs().map(\.id)), Set(serverJobs.map(\.id)))
        XCTAssertFalse(engine.store.pendingArrivals().isEmpty)
        XCTAssertFalse(engine.store.devices().isEmpty)
        XCTAssertNotNil(engine.store.document(Catalog.self, "catalog"))
        XCTAssertNotNil(engine.store.document(JobSummary.self, "summary"))
        XCTAssertTrue(engine.isOnline)
        XCTAssertNotNil(engine.lastSync)
    }

    func testOfflineConfirmQueuesThenSyncsWhenBackOnline() async throws {
        let arrival = try XCTUnwrap(engine.store.pendingArrivals().first)
        network.offline = true

        await engine.perform(.confirmAndOpen(arrivalId: arrival.id, plate: try XCTUnwrap(arrival.displayPlate), vehicleClass: "car", packageId: "quick"))
        XCTAssertFalse(engine.isOnline)
        XCTAssertEqual(engine.pendingCount, 1)
        XCTAssertTrue(engine.store.jobs().contains { $0.id == Job.provisionalId(arrivalId: arrival.id) })
        let serverBefore = try await demo.jobs()
        XCTAssertFalse(serverBefore.contains { $0.arrivalId == arrival.id })

        // A refresh attempt while offline changes nothing.
        await engine.sync()
        XCTAssertEqual(engine.pendingCount, 1)

        network.offline = false
        await engine.sync()
        XCTAssertTrue(engine.isOnline)
        XCTAssertEqual(engine.pendingCount, 0)
        let serverJob = try await demo.jobs().first { $0.arrivalId == arrival.id }
        XCTAssertEqual(serverJob?.packageId, "quick")
        // The provisional job is replaced by the server's.
        XCTAssertFalse(engine.store.jobs().contains(where: \.isProvisional))
        XCTAssertTrue(engine.store.jobs().contains { $0.id == serverJob?.id })
    }

    func testQueuedOperationsReplayInOrder() async throws {
        let job = try XCTUnwrap(engine.store.jobs().first { $0.status == .arrived })
        network.offline = true
        await engine.perform(.transition(jobId: job.id, to: .queued))
        await engine.perform(.transition(jobId: job.id, to: .inProgress))
        XCTAssertEqual(engine.store.jobs().first { $0.id == job.id }?.status, .inProgress)
        XCTAssertEqual(engine.pendingCount, 2)

        network.offline = false
        await engine.sync()
        XCTAssertEqual(engine.pendingCount, 0)
        XCTAssertTrue(engine.rejections.isEmpty)
        let server = try await demo.jobs().first { $0.id == job.id }
        XCTAssertEqual(server?.status, .inProgress)
    }

    func testRejectedChangeIsReportedAndDropped() async throws {
        let done = try XCTUnwrap(engine.store.jobs().first { $0.status == .completed })
        await engine.perform(.transition(jobId: done.id, to: .inProgress))
        XCTAssertEqual(engine.pendingCount, 0)
        XCTAssertEqual(engine.rejections.count, 1)
        XCTAssertEqual(engine.store.jobs().first { $0.id == done.id }?.status, .completed)
        XCTAssertEqual(expired, 0)
    }

    func testDismissOffline() async throws {
        let arrival = try XCTUnwrap(engine.store.pendingArrivals().first)
        network.offline = true
        await engine.perform(.dismiss(arrivalId: arrival.id, reason: .notACustomer))
        XCTAssertFalse(engine.store.pendingArrivals().contains { $0.id == arrival.id })
        network.offline = false
        await engine.sync()
        let pendingOnServer = try await demo.arrivals(pendingOnly: true, limit: 100)
        XCTAssertFalse(pendingOnServer.contains { $0.id == arrival.id })
    }

    func testPhotosAreCachedForOfflineReview() async throws {
        let arrival = try XCTUnwrap(engine.store.pendingArrivals().first { $0.photoId != nil })
        let first = await engine.photo(for: arrival)
        XCTAssertNotNil(first)
        network.offline = true
        let again = await engine.photo(for: arrival)
        XCTAssertEqual(again, first)
    }
}
