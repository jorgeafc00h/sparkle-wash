import SparkleKit
import SwiftData
import XCTest
@testable import SparkleWash

@MainActor
final class LocalStoreTests: XCTestCase {
    private var container: ModelContainer!
    private var store: LocalStore!
    private let demo = DemoBackend()

    override func setUp() async throws {
        container = try CacheSchema.container(inMemory: true)
        store = LocalStore(context: container.mainContext, tenantId: "t1")
        store.replaceArrivals(try await demo.arrivals(pendingOnly: false, limit: 100))
        store.replaceJobs(try await demo.jobs())
        store.replaceEmployees(try await demo.employees())
        store.putDocument(try await demo.catalog(), "catalog")
    }

    func testReplaceKeepsOneRecordPerId() async throws {
        let jobs = try await demo.jobs()
        store.replaceJobs(jobs)
        store.replaceJobs(jobs)
        XCTAssertEqual(store.jobs().count, jobs.count)
        XCTAssertEqual(store.jobs().map(\.id), jobs.sorted { $0.arrivalAt > $1.arrivalAt }.map(\.id))
    }

    func testTenantsAreSeparate() {
        let other = LocalStore(context: container.mainContext, tenantId: "t2")
        XCTAssertTrue(other.jobs().isEmpty)
        XCTAssertTrue(other.arrivals().isEmpty)
        XCTAssertFalse(store.jobs().isEmpty)
    }

    func testConfirmOfflineCreatesProvisionalJobAndClearsTheArrival() throws {
        let arrival = try XCTUnwrap(store.pendingArrivals().first)
        store.enqueue(.confirmAndOpen(arrivalId: arrival.id, plate: "P123456", vehicleClass: "car", packageId: "quick"))

        XCTAssertFalse(store.pendingArrivals().contains { $0.id == arrival.id })
        let job = try XCTUnwrap(store.jobs().first { $0.id == Job.provisionalId(arrivalId: arrival.id) })
        XCTAssertTrue(job.isProvisional)
        XCTAssertEqual(job.plate, "P123456")
        XCTAssertEqual(job.status, .arrived)
        XCTAssertEqual(store.pendingOperations().count, 1)
    }

    func testPendingChangesSurviveAServerRefresh() async throws {
        let arrival = try XCTUnwrap(store.pendingArrivals().first)
        store.enqueue(.dismiss(arrivalId: arrival.id, reason: .notACustomer))
        // The server hasn't seen the dismissal yet: a refresh must not bring the arrival back.
        store.replaceArrivals(try await demo.arrivals(pendingOnly: false, limit: 100))
        XCTAssertFalse(store.pendingArrivals().contains { $0.id == arrival.id })
    }

    func testTransitionAppliesLocally() throws {
        let job = try XCTUnwrap(store.jobs().first { $0.status == .arrived })
        store.enqueue(.transition(jobId: job.id, to: .inProgress))
        let updated = try XCTUnwrap(store.jobs().first { $0.id == job.id })
        XCTAssertEqual(updated.status, .inProgress)
        XCTAssertNotNil(updated.startedAt)
        XCTAssertEqual(updated.transitions.last?.actor, "local")
    }

    func testAssignAppliesOnceForAKnownEmployee() throws {
        let job = try XCTUnwrap(store.jobs().first { $0.status.isOpen })
        let employee = try XCTUnwrap(store.employees().first { e in !job.assignments.contains { $0.employeeId == e.id } })
        store.enqueue(.assign(jobId: job.id, employeeId: employee.id))
        store.enqueue(.assign(jobId: job.id, employeeId: employee.id))
        let updated = try XCTUnwrap(store.jobs().first { $0.id == job.id })
        XCTAssertEqual(updated.assignments.filter { $0.employeeId == employee.id }.count, 1)

        store.enqueue(.assign(jobId: job.id, employeeId: "nobody"))
        XCTAssertEqual(store.jobs().first { $0.id == job.id }?.assignments.count, updated.assignments.count)
    }

    func testDocumentsAndPhotos() throws {
        let catalog = try XCTUnwrap(store.document(Catalog.self, "catalog"))
        XCTAssertFalse(catalog.packages.isEmpty)
        store.putPhoto(DemoBackend.placeholderJPEG, arrivalId: "a1")
        store.putPhoto(Data([1, 2, 3]), arrivalId: "a1") // first photo wins
        XCTAssertEqual(store.photo(arrivalId: "a1"), DemoBackend.placeholderJPEG)
        XCTAssertNil(LocalStore(context: container.mainContext, tenantId: "t2").photo(arrivalId: "a1"))
    }

    func testClearRemovesOnlyThisTenant() async throws {
        let other = LocalStore(context: container.mainContext, tenantId: "t2")
        other.replaceJobs(try await demo.jobs())
        store.enqueue(.dismiss(arrivalId: "x", reason: .notACustomer))
        store.clear()
        XCTAssertTrue(store.jobs().isEmpty)
        XCTAssertTrue(store.pendingOperations().isEmpty)
        XCTAssertNil(store.document(Catalog.self, "catalog"))
        XCTAssertFalse(other.jobs().isEmpty)
    }

    func testOperationsRoundTripThroughSwiftData() throws {
        let operations: [OutboxOperation] = [
            .confirmAndOpen(arrivalId: "a", plate: "P1", vehicleClass: "suv", packageId: "renew"),
            .transition(jobId: "j", to: .completed),
            .dismiss(arrivalId: "a", reason: .notACustomer),
            .assign(jobId: "j", employeeId: "e"),
        ]
        for operation in operations { store.enqueue(operation) }
        XCTAssertEqual(store.pendingOperations().compactMap(\.operation), operations)
    }
}
