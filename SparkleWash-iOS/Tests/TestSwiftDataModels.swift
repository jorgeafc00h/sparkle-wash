import XCTest
import SwiftData
@testable import SparkleWash

final class SharedContractTests: XCTestCase {
    func testSharedPackageCatalog() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "service-packages", withExtension: "json"))
        let catalog = try JSONDecoder().decode(ServiceCatalogDTO.self, from: Data(contentsOf: url))
        XCTAssertTrue(catalog.isValid)
        XCTAssertEqual(catalog.packages.map { $0.price(for: "car") }, [10, 15, 25, 35])
        XCTAssertEqual(catalog.packages.map { $0.price(for: "pickup") }, [16, 24, 40, 50])
        XCTAssertEqual(catalog.packages[3].items.last, "Limpieza de puntas de escape")
    }

    func testStationFixtureAndThresholds() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "stations", withExtension: "json"))
        let stations = try JSONDecoder().decode([StationDTO].self, from: Data(contentsOf: url))
        XCTAssertEqual(stations.count, 4)
        XCTAssertTrue(stations.allSatisfy(\.isValid))
        XCTAssertEqual(stations[0].stationId, "b4c3")
        XCTAssertEqual(stations[0].pressureState, "Good")
        XCTAssertEqual(stations[0].soapState, "Danger")
    }

    func testAlertFixture() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "alerts", withExtension: "json"))
        let alerts = try JSONDecoder().decode([AlertDTO].self, from: Data(contentsOf: url))
        XCTAssertEqual(alerts.count, 2)
        XCTAssertTrue(alerts.allSatisfy(\.isValid))
    }

    func testBoundaryLabelsAndEndpointValidation() {
        let base = StationDTO(stationId: "x", name: "Bay", status: "idle", pressurePsi: 60, soapLevelDm: 55, timestamp: "2026-10-18T00:00:00Z")
        XCTAssertEqual(base.pressureState, "Good")
        XCTAssertEqual(base.soapState, "Warning")
        XCTAssertTrue(EndpointValidation.isValid("http://localhost:8080"))
        XCTAssertTrue(EndpointValidation.isValid("http://localhost:8080/"))
        XCTAssertFalse(EndpointValidation.isValid("file:///tmp/data"))
        XCTAssertFalse(EndpointValidation.isValid("https://user:pass@example.com"))
        XCTAssertFalse(EndpointValidation.isValid("https://example.com?token=abc"))
        let liveTimestamp = StationDTO(stationId: "x", name: "Bay", status: "idle", pressurePsi: 60, soapLevelDm: 55,
                                       timestamp: "2026-10-18T19:41:49.7766750+00:00")
        XCTAssertTrue(liveTimestamp.isValid)
    }

    @MainActor
    func testSavedSnapshotIsScopedToEndpoint() throws {
        let container = try ModelContainer(for: CachedSnapshot.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = ModelContext(container)
        let stationURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "stations", withExtension: "json"))
        let alertURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "alerts", withExtension: "json"))
        context.insert(CachedSnapshot(endpoint: "http://first.example", stationsData: try Data(contentsOf: stationURL),
                                      alertsData: try Data(contentsOf: alertURL), savedAt: Date(), source: "demo"))
        try context.save()
        let model = DashboardModel()
        model.restore(context: context, endpoint: "http://second.example")
        XCTAssertTrue(model.stations.isEmpty)
        model.restore(context: context, endpoint: "http://first.example")
        XCTAssertEqual(model.stations.count, 4)
    }
}
