import XCTest
@testable import SparkleKit

/// Runs against a real SparkleWash API when SPARKLEWASH_API_URL is set (CI starts one; see .github/workflows/ios.yml).
/// Covers what doesn't need a Google account: public endpoints, auth errors and device-style ingestion.
final class IntegrationTests: XCTestCase {
    private var config: ServerConfig!
    private var ingestKey: String?

    override func setUpWithError() throws {
        guard let url = ProcessInfo.processInfo.environment["SPARKLEWASH_API_URL"].flatMap(URL.init(string:)) else {
            throw XCTSkip("Set SPARKLEWASH_API_URL to run against a live API")
        }
        config = ServerConfig(baseURL: url)
        ingestKey = ProcessInfo.processInfo.environment["SPARKLEWASH_INGEST_KEY"]
    }

    func testCatalogFromTheLiveAPIMatchesTheDemo() async throws {
        let (data, _) = try await URLSession.shared.data(from: config.baseURL.appending(path: "/api/packages"))
        let catalog = try SparkleJSON.decoder().decode(Catalog.self, from: data)
        XCTAssertEqual(catalog, DemoBackend.defaultCatalog)
    }

    func testRegistrationFlagAndRejectedTokens() async throws {
        _ = await HTTPSparkleAPI.registrationOpen(config: config)
        do {
            _ = try await HTTPSparkleAPI.signIn(config: config, idToken: "not-a-google-token")
            XCTFail("a fake token must not sign in")
        } catch let error as APIError {
            XCTAssertTrue([.unauthorized, .unavailable].contains(error), "\(error)")
        }
    }

    func testStaffEndpointsRequireASession() async throws {
        let api = HTTPSparkleAPI(config: config, token: "bogus")
        do {
            _ = try await api.jobs()
            XCTFail("should be unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
    }

    func testIngestedObservationDecodes() async throws {
        let key = try XCTUnwrap(ingestKey, "SPARKLEWASH_INGEST_KEY")
        var request = URLRequest(url: config.baseURL.appending(path: "/api/arrivals/observations"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "X-SparkleWash-Ingest-Key")
        let event = "ios-\(UUID().uuidString.prefix(8))"
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "deviceEventId": event, "cameraId": "entrance-cam", "plateCandidate": "IOS-\(Int.random(in: 100...999))",
            "confidence": 0.9, "capturedAt": SparkleJSON.formatDate(Date()),
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 201)
        struct Observed: Decodable { let observation: ArrivalObservation }
        let observed = try SparkleJSON.decoder().decode(Observed.self, from: data)
        XCTAssertEqual(observed.observation.deviceEventId, event)
        XCTAssertTrue(observed.observation.isPending)
    }
}
