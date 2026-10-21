import Foundation
import XCTest
@testable import SparkleKit

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let url = try XCTUnwrapURL(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try SparkleJSON.decoder().decode(T.self, from: data(name))
    }

    private static func XCTUnwrapURL(_ url: URL?) throws -> URL {
        guard let url else { throw NSError(domain: "Fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing fixture"]) }
        return url
    }
}

/// Routes URLSession requests to a handler, so the HTTP client can be tested without a server.
final class StubURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (Int, Data)
    private static let lock = NSLock()
    private static var _handler: Handler?
    private static var _requests: [URLRequest] = []

    static func install(_ handler: @escaping Handler) {
        lock.lock(); defer { lock.unlock() }
        _handler = handler
        _requests = []
    }

    static var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return _requests }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var recorded = request
        // URLSession moves bodies into a stream; keep them readable for assertions.
        if recorded.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(buffer, maxLength: 4096)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            buffer.deallocate()
            stream.close()
            recorded.httpBody = data
        }
        Self.lock.lock()
        Self._requests.append(recorded)
        let handler = Self._handler
        Self.lock.unlock()
        do {
            guard let handler else { throw URLError(.badServerResponse) }
            let (status, data) = try handler(recorded)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

