import XCTest
@testable import SparkleKit

final class OutboxTests: XCTestCase {
    func testIdempotencyKeysAreStableForReplays() {
        XCTAssertEqual(OutboxOperation.transition(jobId: "j1", to: .inProgress), .transition(jobId: "j1", to: .inProgress))
        guard case let .transition(_, _, key) = OutboxOperation.transition(jobId: "j1", to: .inProgress) else { return XCTFail() }
        XCTAssertEqual(key, "in_progress-j1")
        guard case let .confirmAndOpen(_, _, _, _, _, openKey) = OutboxOperation.confirmAndOpen(arrivalId: "a1", plate: "P1", vehicleClass: "car", packageId: "quick") else { return XCTFail() }
        XCTAssertEqual(openKey, "open-a1-quick")
    }

    func testOperationsQueuedOfflineApplyOnceWhenBackOnline() async throws {
        let demo = DemoBackend()
        let api = OfflineSwitchAPI(base: demo)
        let pending = try await demo.arrivals(pendingOnly: true, limit: 10)
        let arrival = try XCTUnwrap(pending.first)
        let open = OutboxOperation.confirmAndOpen(arrivalId: arrival.id, plate: "zz-1234", vehicleClass: "car", packageId: "quick")

        api.offline = true
        let offlineResult = await OutboxProcessor.run(open, on: api)
        XCTAssertEqual(offlineResult, .retryLater)

        api.offline = false
        let first = await OutboxProcessor.run(open, on: api)
        XCTAssertEqual(first, .done)
        // A replay (e.g. the response was lost) must not create a second job.
        let replay = await OutboxProcessor.run(open, on: api)
        XCTAssertEqual(replay, .done)
        let jobs = try await demo.jobs().filter { $0.plate == "ZZ1234" }
        XCTAssertEqual(jobs.count, 1)
    }

    func testDrainStopsAtTheFirstOperationThatMustWaitAndKeepsOrder() async throws {
        let demo = DemoBackend()
        let api = OfflineSwitchAPI(base: demo)
        let jobs = try await demo.jobs()
        let arrived = try XCTUnwrap(jobs.first { $0.status == .arrived })
        let queue: [OutboxOperation] = [.transition(jobId: arrived.id, to: .queued), .transition(jobId: arrived.id, to: .inProgress)]

        api.offline = true
        let offline = await OutboxProcessor.drain(queue, on: api)
        XCTAssertEqual(offline.map(\.1), [.retryLater])

        api.offline = false
        let online = await OutboxProcessor.drain(queue, on: api)
        XCTAssertEqual(online.map(\.1), [.done, .done])
        let after = try await demo.jobs()
        let status = after.first { $0.id == arrived.id }?.status
        XCTAssertEqual(status, .inProgress)
    }

    func testServerRejectionsAreNotRetried() async throws {
        let demo = DemoBackend()
        let jobs = try await demo.jobs()
        let done = try XCTUnwrap(jobs.first { $0.status == .completed })
        let result = await OutboxProcessor.run(.transition(jobId: done.id, to: .inProgress), on: demo)
        XCTAssertEqual(result, .rejected(.conflict("Invalid job transition")))
        let missing = await OutboxProcessor.run(.dismiss(arrivalId: "nope", reason: .misread), on: demo)
        XCTAssertEqual(missing, .rejected(.notFound))
    }
}
