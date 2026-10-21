import XCTest
@testable import SparkleKit

final class APIClientTests: XCTestCase {
    private let config = ServerConfig(baseURL: URL(string: "https://api.example.com/")!)

    func testRequestsCarryTheBearerTokenAndIdempotencyKeys() async throws {
        let job = try Fixture.data("job-transitioned")
        StubURLProtocol.install { _ in (200, job) }
        let api = HTTPSparkleAPI(config: config, token: "tok-123", session: StubURLProtocol.session())

        let result = try await api.transitionJob(id: "job1", to: .inProgress, idempotencyKey: "in_progress-job1")
        XCTAssertEqual(result.status, .queued) // whatever the fixture says; the request is what matters here
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/api/jobs/job1/transition")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok-123")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "in_progress-job1")
        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: String]
        XCTAssertEqual(body, ["status": "in_progress"])
    }

    func testPendingArrivalsQuery() async throws {
        let list = try Fixture.data("arrivals-pending")
        StubURLProtocol.install { _ in (200, list) }
        let api = HTTPSparkleAPI(config: config, token: "t", session: StubURLProtocol.session())
        _ = try await api.arrivals(pendingOnly: true, limit: 500)
        let url = try XCTUnwrap(StubURLProtocol.requests.last?.url)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "limit" }?.value, "100")
        XCTAssertEqual(items.first { $0.name == "pending" }?.value, "true")
    }

    func testStatusCodesMapToErrors() async throws {
        let api = HTTPSparkleAPI(config: config, token: "t", session: StubURLProtocol.session())
        let cases: [(Int, APIError)] = [(401, .unauthorized), (403, .forbidden), (404, .notFound),
                                         (409, .conflict("Another active device already uses this camera id")), (503, .unavailable), (500, .server(500))]
        let conflictBody = try Fixture.data("error-conflict")
        for (status, expected) in cases {
            StubURLProtocol.install { _ in (status, status == 409 ? conflictBody : Data()) }
            do {
                _ = try await api.devices()
                XCTFail("\(status) should throw")
            } catch let error as APIError {
                XCTAssertEqual(error, expected)
            }
        }
        XCTAssertTrue(APIError.offline.isRetryable)
        XCTAssertTrue(APIError.server(502).isRetryable)
        XCTAssertFalse(APIError.conflict(nil).isRetryable)
        XCTAssertFalse(APIError.unauthorized.isRetryable)
    }

    func testNetworkFailuresBecomeOffline() async {
        StubURLProtocol.install { _ in throw URLError(.notConnectedToInternet) }
        let api = HTTPSparkleAPI(config: config, token: "t", session: StubURLProtocol.session())
        do {
            _ = try await api.jobs()
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .offline)
        }
    }

    func testRegistrationSendsCleanedCarwashDetails() async throws {
        let register = try Fixture.data("register")
        StubURLProtocol.install { _ in (201, register) }
        let result = try await HTTPSparkleAPI.register(config: config, idToken: "google-id-token",
                                                       carwash: TenantInput(name: "  Lavado Central ", city: " ", phone: ""),
                                                       session: StubURLProtocol.session())
        XCTAssertEqual(result.role, .admin)
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/api/tenants/register")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["idToken"] as? String, "google-id-token")
        XCTAssertEqual(body["name"] as? String, "Lavado Central")
        XCTAssertNil(body["city"] as? String)
        XCTAssertEqual(body["timeZone"] as? String, "America/El_Salvador")
    }

    func testServerSentEventsParser() {
        var parser = ServerSentEvents()
        XCTAssertNil(parser.feed("retry: 3000"))
        XCTAssertNil(parser.feed(": heartbeat"))
        XCTAssertNil(parser.feed("event: change"))
        XCTAssertEqual(parser.feed("data: {\"topic\":\"jobs\"}"), .jobs)
        XCTAssertEqual(parser.feed("data:{\"topic\":\"arrivals\"}"), .arrivals)
        XCTAssertNil(parser.feed("data: {\"topic\":\"unknown\"}"))
        XCTAssertNil(parser.feed("data: not json"))
    }
}
