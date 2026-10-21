import XCTest
@testable import SparkleKit

final class GoogleOAuthTests: XCTestCase {
    private let oauth = GoogleOAuth(clientId: "1234-abcd.apps.googleusercontent.com")

    func testPKCEMatchesTheRFC7636Example() {
        let pkce = GoogleOAuth.PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(pkce.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let random = GoogleOAuth.PKCE.random()
        XCTAssertGreaterThanOrEqual(random.verifier.count, 43)
        XCTAssertNotEqual(random, GoogleOAuth.PKCE.random())
    }

    func testRedirectUsesTheReversedClientId() {
        XCTAssertEqual(oauth.redirectScheme, "com.googleusercontent.apps.1234-abcd")
        XCTAssertEqual(oauth.redirectURI, "com.googleusercontent.apps.1234-abcd:/oauth2redirect")
    }

    func testAuthorizationURL() throws {
        let pkce = GoogleOAuth.PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        let url = oauth.authorizationURL(pkce: pkce, state: "s-1")
        let items = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(url.host, "accounts.google.com")
        XCTAssertEqual(items["client_id"], oauth.clientId)
        XCTAssertEqual(items["code_challenge"], pkce.challenge)
        XCTAssertEqual(items["code_challenge_method"], "S256")
        XCTAssertEqual(items["scope"], "openid email profile")
        XCTAssertEqual(items["state"], "s-1")
        XCTAssertEqual(items["response_type"], "code")
    }

    func testCallbackParsing() throws {
        let ok = URL(string: "com.googleusercontent.apps.1234-abcd:/oauth2redirect?state=s-1&code=4/0Abc")!
        XCTAssertEqual(try oauth.code(from: ok, expectedState: "s-1"), "4/0Abc")
        XCTAssertThrowsError(try oauth.code(from: ok, expectedState: "other")) { XCTAssertEqual($0 as? GoogleOAuth.CallbackError, .stateMismatch) }
        let denied = URL(string: "com.googleusercontent.apps.1234-abcd:/oauth2redirect?error=access_denied&state=s-1")!
        XCTAssertThrowsError(try oauth.code(from: denied, expectedState: "s-1")) { XCTAssertEqual($0 as? GoogleOAuth.CallbackError, .denied("access_denied")) }
    }

    func testTokenRequestAndResponse() throws {
        let pkce = GoogleOAuth.PKCE(verifier: "verifier+with/odd=chars")
        let request = oauth.tokenRequest(code: "4/0A+b", pkce: pkce)
        XCTAssertEqual(request.httpMethod, "POST")
        let body = String(decoding: try XCTUnwrap(request.httpBody), as: UTF8.self)
        XCTAssertTrue(body.contains("grant_type=authorization_code"))
        XCTAssertTrue(body.contains("code=4/0A%2Bb"), body)
        XCTAssertTrue(body.contains("code_verifier=verifier%2Bwith/odd%3Dchars") || body.contains("code_verifier=verifier%2Bwith/odd=chars"), body)
        XCTAssertEqual(GoogleOAuth.idToken(fromTokenResponse: Data(#"{"access_token":"a","id_token":"eyJ.x.y","expires_in":3599}"#.utf8)), "eyJ.x.y")
        XCTAssertNil(GoogleOAuth.idToken(fromTokenResponse: Data(#"{"error":"invalid_grant"}"#.utf8)))
    }
}
