import XCTest
@testable import SparkleKit

final class DemoBackendTests: XCTestCase {
    func testSeededCarwashMatchesTheWebDemo() async throws {
        let demo = DemoBackend()
        let pending = try await demo.arrivals(pendingOnly: true, limit: 50)
        XCTAssertEqual(pending.compactMap(\.plateCandidate), ["P9O3377", "P482913"])
        let jobs = try await demo.jobs()
        XCTAssertEqual(Set(jobs.map(\.status)), [.arrived, .queued, .inProgress, .completed])
        let devices = try await demo.devices()
        XCTAssertEqual(devices.map(\.role), [.entry, .bay, .exit])
        let session = try await demo.session()
        XCTAssertEqual(session.role, .admin)
        XCTAssertEqual(DemoBackend.placeholderJPEG.prefix(2), Data([0xFF, 0xD8]))
    }

    func testJobStateMachineAndConflicts() async throws {
        let demo = DemoBackend()
        let pending = try await demo.arrivals(pendingOnly: true, limit: 50)
        let arrival = try XCTUnwrap(pending.first)
        await XCTAssertThrowsErrorAsync(try await demo.openJob(arrivalId: arrival.id, packageId: "quick", idempotencyKey: "k-1234567")) {
            XCTAssertEqual($0 as? APIError, .conflict("Arrival needs staff confirmation"))
        }
        _ = try await demo.confirmArrival(id: arrival.id, plate: "AB-123", vehicleClass: "pickup")
        let job = try await demo.openJob(arrivalId: arrival.id, packageId: "supreme", idempotencyKey: "k-1234567")
        XCTAssertEqual(job.priceUsd, 50)
        XCTAssertEqual(job.plate, "AB123")
        await XCTAssertThrowsErrorAsync(try await demo.transitionJob(id: job.id, to: .completed, idempotencyKey: "x-1234567")) {
            XCTAssertEqual($0 as? APIError, .conflict("Invalid job transition"))
        }
        for status in [JobStatus.queued, .inProgress, .completed] {
            _ = try await demo.transitionJob(id: job.id, to: status, idempotencyKey: "\(status.rawValue)-\(job.id)")
        }
        let timeline = try await demo.plateTimeline("ab-123")
        XCTAssertNil(timeline.openJob)
        XCTAssertEqual(timeline.visits, 1)
    }

    func testChangeNotifications() async throws {
        let demo = DemoBackend()
        let stream = demo.changes()
        try await Task.sleep(nanoseconds: 50_000_000) // let the listener register
        let pending = try await demo.arrivals(pendingOnly: true, limit: 50)
        let arrival = try XCTUnwrap(pending.first)
        _ = try await demo.dismissArrival(id: arrival.id, reason: .staff)
        var iterator = stream.makeAsyncIterator()
        let topic = try await iterator.next()
        XCTAssertEqual(topic, .arrivals)
        let after = try await demo.arrivals(pendingOnly: true, limit: 50)
        XCTAssertFalse(after.contains { $0.id == arrival.id })
    }

    func testAdminRules() async throws {
        let demo = DemoBackend(seed: false, carwash: TenantInput(name: "Lavado Nuevo"))
        let tenant = try await demo.tenant()
        XCTAssertEqual(tenant.name, "Lavado Nuevo")
        XCTAssertNil(tenant.city)
        let bays = try await demo.bays()
        XCTAssertTrue(bays.stations.isEmpty)
        let linked = try await demo.createDevice(DeviceInput(name: "Entrada", cameraId: "Entrance-Cam", role: .entry))
        XCTAssertEqual(linked.device.cameraId, "entrance-cam")
        XCTAssertTrue(linked.deviceKey.hasPrefix("swd.demo.\(linked.device.id)."))
        await XCTAssertThrowsErrorAsync(try await demo.createDevice(DeviceInput(name: "Otra", cameraId: "entrance-cam", role: .entry))) {
            XCTAssertEqual($0 as? APIError, .conflict("Another active device already uses this camera id"))
        }
        let rotated = try await demo.rotateDevice(id: linked.device.id)
        XCTAssertNotEqual(rotated.deviceKey, linked.deviceKey)
        try await demo.invite(email: " Pedro@Ejemplo.com ", role: .operator)
        await XCTAssertThrowsErrorAsync(try await demo.invite(email: "pedro@ejemplo.com", role: .viewer)) { XCTAssertEqual($0 as? APIError, .conflict("Already invited or already on the team")) }
        await XCTAssertThrowsErrorAsync(try await demo.setMemberRole(subject: "demo", role: .viewer)) { XCTAssertEqual($0 as? APIError, .conflict("A carwash needs at least one admin")) }
        await XCTAssertThrowsErrorAsync(try await demo.removeMember(subject: "demo")) { XCTAssertEqual($0 as? APIError, .conflict("You can't remove yourself")) }
        let employee = try await demo.addEmployee(name: "Rosa")
        let employees = try await demo.employees()
        XCTAssertEqual(employees, [employee])
    }

    func testTenantValidation() {
        XCTAssertEqual(TenantInput(name: "X").validationErrors, [.name])
        XCTAssertEqual(TenantInput(name: "Lavado", phone: "abc").validationErrors, [.phone])
        XCTAssertTrue(TenantInput(name: "Lavado", phone: "+503 2222-3333").validationErrors.isEmpty)
        XCTAssertEqual(EmailAddress.normalize(" Ana@Lavado.com "), "ana@lavado.com")
        XCTAssertNil(EmailAddress.normalize("ana@lavado"))
        XCTAssertNil(EmailAddress.normalize("a b@c.com"))
    }

    func testPlateAndDurations() {
        XCTAssertEqual(Plate.normalize("p-123 456"), "P123456")
        XCTAssertNil(Plate.normalize("ab"))
        XCTAssertEqual(Plate.confidence(0.92), .high)
        XCTAssertEqual(Plate.confidence(nil), .low)
        XCTAssertEqual(Durations.short(125), "2m 05s")
        XCTAssertEqual(Durations.short(3 * 3600 + 7 * 60), "3h 07m")
        XCTAssertEqual(JobStatus.queued.next, .inProgress)
        XCTAssertNil(JobStatus.completed.next)
    }
}

func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T, file: StaticString = #filePath, line: UInt = #line,
                                  _ handler: (Error) -> Void = { _ in }) async {
    do {
        _ = try await expression()
        XCTFail("Expected an error", file: file, line: line)
    } catch {
        handler(error)
    }
}
