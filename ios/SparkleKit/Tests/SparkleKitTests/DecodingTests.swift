import XCTest
@testable import SparkleKit

/// Fixtures are real responses captured from the .NET API (see ios/README.md), so these tests
/// catch any drift between the server's JSON and the app's models.
final class DecodingTests: XCTestCase {
    func testDotNetDatesWithSevenFractionalDigitsAndOffsets() throws {
        let date = try XCTUnwrap(SparkleJSON.parseDate("2026-10-21T20:55:28.7290608+00:00"))
        XCTAssertEqual(date.timeIntervalSince1970, 1_792_616_128.7290608, accuracy: 0.0001)
        XCTAssertEqual(SparkleJSON.parseDate("2026-10-21T14:55:28-06:00")?.timeIntervalSince1970, 1_792_616_128)
        XCTAssertNotNil(SparkleJSON.parseDate("2026-10-21T20:55:28.648461Z"))
        XCTAssertNil(SparkleJSON.parseDate("yesterday"))
        XCTAssertNil(SparkleJSON.parseDate("2026-10-21T20:55:28.+00:00"))
    }

    func testRegistrationAndSession() throws {
        let login = try Fixture.decode(LoginResult.self, "register")
        XCTAssertEqual(login.role, .admin)
        XCTAssertEqual(login.tenant?.name, "Lavado Central")
        let session = try Fixture.decode(StaffSession.self, "session")
        XCTAssertEqual(session.email, "ana@lavado.com")
        XCTAssertEqual(session.tenant.country, "SV")
        XCTAssertTrue(session.isAdmin)
    }

    func testCatalogMatchesThePriceSheet() throws {
        let catalog = try Fixture.decode(Catalog.self, "catalog")
        XCTAssertEqual(catalog.packages.map(\.id), ["quick", "essential", "renew", "supreme"])
        XCTAssertEqual(catalog.price(package: "supreme", vehicleClass: "pickup"), 50)
        XCTAssertEqual(catalog.vehicleClasses.first { $0.id == "suv" }?.localizedName("en"), "SUV")
        XCTAssertEqual(catalog.packages[1].localizedItems("en")[1], "Snow foam")
        // The demo ships the same catalog as the API.
        XCTAssertEqual(catalog.packages.map(\.prices), DemoBackend.defaultCatalog.packages.map(\.prices))
    }

    func testArrivalsJobsAndTimeline() throws {
        struct Observed: Decodable { let observation: ArrivalObservation; let trackedJobId: String?; let duplicate: Bool }
        let observed = try Fixture.decode(Observed.self, "observation")
        XCTAssertEqual(observed.observation.plateCandidate, "P123456")
        XCTAssertEqual(observed.observation.cameraRole, .entry)
        XCTAssertTrue(observed.observation.isPending)
        XCTAssertEqual(try Fixture.decode([ArrivalObservation].self, "arrivals-pending").count, 1)
        let confirmed = try Fixture.decode(ArrivalObservation.self, "arrival-confirmed")
        XCTAssertEqual(confirmed.confirmedPlate, "P123456")
        XCTAssertEqual(confirmed.vehicleClass, "suv")

        let job = try Fixture.decode(Job.self, "job-assigned")
        XCTAssertEqual(job.status, .queued)
        XCTAssertEqual(job.priceUsd, 30)
        XCTAssertEqual(job.transitions.map(\.status), [.arrived, .queued])
        XCTAssertEqual(job.assignments.first?.employeeName, "Maria Garcia")
        XCTAssertEqual(try Fixture.decode([Job].self, "jobs").count, 1)

        let summary = try Fixture.decode(JobSummary.self, "summary")
        XCTAssertEqual(summary.total, 1)
        XCTAssertEqual(summary.onSite, 1)
        XCTAssertNotNil(summary.completedToday)

        let timeline = try Fixture.decode(PlateTimeline.self, "timeline")
        XCTAssertEqual(timeline.plate, "P123456")
        XCTAssertEqual(timeline.openJob?.id, job.id)
        XCTAssertEqual(timeline.visits, 1)
    }

    func testAdminPayloads() throws {
        let created = try Fixture.decode(DeviceWithKey.self, "device-created")
        XCTAssertTrue(created.deviceKey.hasPrefix("swd."))
        XCTAssertEqual(created.device.state, .never)
        let devices = try Fixture.decode([Device].self, "devices")
        XCTAssertEqual(devices.first?.state, .online)
        XCTAssertEqual(devices.first?.lastStatus?.signalBars, 4)
        XCTAssertEqual(devices.first?.lastStatus?.firmware, "sparklewash-cam/1.2")

        let team = try Fixture.decode(Team.self, "team")
        XCTAssertEqual(team.members.first?.role, .admin)
        XCTAssertEqual(team.invitations.first?.email, "carla@example.com")
        XCTAssertEqual(team.you, team.members.first?.subject)
        XCTAssertEqual(try Fixture.decode([Employee].self, "employees").first?.name, "Maria Garcia")
        XCTAssertEqual(try Fixture.decode(Tenant.self, "tenant").city, "San Salvador")
        XCTAssertEqual(try Fixture.decode(Bays.self, "bays").stations.count, 0)
    }
}
