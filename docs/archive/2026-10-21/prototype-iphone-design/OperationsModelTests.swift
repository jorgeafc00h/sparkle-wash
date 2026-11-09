import XCTest
import SwiftData
import SwiftUI
@testable import SparkleWash

private final class OperationsURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var response: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.response!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}

final class OperationsModelTests: XCTestCase {
    private let endpoint = "http://localhost:8080"
    private let jobJSON = #"{"id":"j1","arrivalId":"a1","plate":"P123456","vehicleClass":"suv","packageId":"essential","packageName":"Essential Spa","services":["Lavado exterior","Aspirado"],"priceUsd":18,"status":"in_progress","arrivalAt":"2026-10-21T14:00:00Z","elapsedSeconds":1260,"activeSeconds":900,"assignments":[{"employeeId":"e1","employeeName":"Ana Flores"}]}"#

    @MainActor private func fixture(role: String = "operator", failMutation: Bool = false) throws -> (OperationsModel, ModelContainer) {
        let menu = try Data(contentsOf: XCTUnwrap(Bundle(for: SharedContractTests.self).url(forResource: "service-packages", withExtension: "json")))
        let job = jobJSON
        OperationsURLProtocol.response = { request in
            let path = request.url!.path
            if path == "/api/packages" { return (200, menu) }
            if path == "/api/auth/google" { return (200, Data("{\"sessionToken\":\"test-session\",\"role\":\"\(role)\",\"expiresAt\":\"2030-01-01T00:00:00Z\"}".utf8)) }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
            if request.httpMethod == "POST" {
                XCTAssertNotNil(request.value(forHTTPHeaderField: "Idempotency-Key"))
                return (failMutation ? 409 : 200, Data("{}".utf8))
            }
            let body: String
            switch path {
            case "/api/jobs": body = "[\(job)]"
            case "/api/arrivals": body = #"[{"id":"a2","cameraId":"entrance","plateCandidate":"P789012","confidence":0.94,"receivedAt":"2026-10-21T14:23:00Z","photoId":null,"confirmedPlate":null,"vehicleClass":null}]"#
            case "/api/jobs/summary": body = #"{"total":8,"arrived":1,"queued":2,"inProgress":1,"completed":4,"cancelled":0,"arrivalsTodayUtc":8,"completedTodayUtc":4,"averageCompletedSeconds":1800}"#
            case "/api/employees": body = #"[{"id":"e1","name":"Ana Flores","active":true},{"id":"e2","name":"Carlos Reyes","active":true}]"#
            case "/api/inventory/items": body = #"[{"item":{"id":"i1","sku":"SOAP","name":"Active foam","unit":"L","reorderPoint":5},"onHand":8,"reserved":2,"available":6,"needsReorder":false}]"#
            default: body = "{}"
            }
            return (200, Data(body.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OperationsURLProtocol.self]
        let model = OperationsModel(session: URLSession(configuration: config))
        let container = try ModelContainer(for: CachedOperationsSnapshot.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        model.connect(context: container.mainContext, endpoint: endpoint)
        return (model, container)
    }

    @MainActor func testPublicCatalogDoesNotClaimOfflineAndRejectsStaffMutations() async throws {
        let (model, container) = try fixture()
        await model.refresh(context: container.mainContext, endpoint: endpoint)
        XCTAssertFalse(model.catalogIsStale)
        XCTAssertNotNil(model.catalogUpdatedAt)
        XCTAssertFalse(model.signedIn)
        XCTAssertFalse(model.canChange)
        XCTAssertTrue(model.jobs.isEmpty)
        XCTAssertEqual(model.catalog?.packages.first?.price(for: "pickup"), 16)
    }

    @MainActor func testFailedTransitionRetainsAuthoritativeJobAndEndpointChangeClearsStaffData() async throws {
        let (model, container) = try fixture(failMutation: true)
        await model.exchangeGoogleToken("test-google-token", context: container.mainContext, endpoint: endpoint)
        XCTAssertTrue(model.canChange)
        XCTAssertEqual(model.pendingArrivals.count, 1)
        let job = try XCTUnwrap(model.jobs.first)
        await model.transition(job, to: "completed", context: container.mainContext, endpoint: endpoint)
        XCTAssertEqual(model.jobs.first?.status, "in_progress")
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.isMutating)
        model.connect(context: container.mainContext, endpoint: "http://other.example")
        XCTAssertFalse(model.signedIn)
        XCTAssertTrue(model.jobs.isEmpty)
        XCTAssertNil(model.catalog)
    }

    @MainActor func testViewerCannotChangeJobsAndSignOutClearsPrivateData() async throws {
        let (model, container) = try fixture(role: "viewer")
        await model.exchangeGoogleToken("test-google-token", context: container.mainContext, endpoint: endpoint)
        XCTAssertTrue(model.signedIn)
        XCTAssertFalse(model.canChange)
        XCTAssertEqual(model.jobs.count, 1)
        await model.signOut()
        XCTAssertFalse(model.signedIn)
        XCTAssertTrue(model.arrivals.isEmpty)
        XCTAssertTrue(model.employees.isEmpty)
        XCTAssertTrue(model.inventory.isEmpty)
    }

    @MainActor func testStaffScreensRenderWithContractFixtures() async throws {
        let (model, container) = try fixture()
        await model.exchangeGoogleToken("test-google-token", context: container.mainContext, endpoint: endpoint)
        for tab in [WorkTab.overview, .jobs, .team] {
            let root = OperationsView(model: model, initialTab: tab).modelContainer(container)
            try await capture(root, name: "staff-\(tab.rawValue.lowercased())-contract-fixture")
        }
        try await capture(OperationsView(model: model).environment(\.dynamicTypeSize, .accessibility5).modelContainer(container), name: "staff-overview-largest-text-contract-fixture")
        let job = try XCTUnwrap(model.jobs.first)
        let detail = NavigationStack { JobDetailView(model: model, job: job, endpoint: endpoint) }.modelContainer(container)
        try await capture(detail, name: "job-detail-contract-fixture")
        XCTAssertEqual(model.summary?.inProgress, 1)
        XCTAssertEqual(model.jobs.first?.assignments.first?.employeeName, "Ana Flores")
    }

    @MainActor private func capture<V: View>(_ root: V, name: String) async throws {
        let controller = UIHostingController(rootView: root)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = controller
        window.overrideUserInterfaceStyle = .light
        window.makeKeyAndVisible()
        try await Task.sleep(for: .milliseconds(350))
        controller.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        window.isHidden = true
    }
}
