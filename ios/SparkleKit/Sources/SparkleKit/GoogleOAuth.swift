import CryptoKit
import Foundation

/// Google sign-in for native apps (OAuth 2.0 authorization code + PKCE, RFC 7636 / RFC 8252).
/// The app opens `authorizationURL` in ASWebAuthenticationSession, gets a code on its redirect URI,
/// exchanges it for an ID token, and sends that token to the SparkleWash API.
public struct GoogleOAuth: Sendable {
    public let clientId: String

    public init(clientId: String) { self.clientId = clientId }

    /// iOS OAuth clients use the reversed client ID as their URL scheme.
    public var redirectScheme: String {
        clientId.split(separator: ".").reversed().joined(separator: ".")
    }

    public var redirectURI: String { "\(redirectScheme):/oauth2redirect" }

    public struct PKCE: Sendable, Equatable {
        public let verifier: String
        public let challenge: String

        public init(verifier: String) {
            self.verifier = verifier
            challenge = PKCE.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        }

        public static func random() -> PKCE {
            var bytes = [UInt8](repeating: 0, count: 32)
            for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
            return PKCE(verifier: base64URL(Data(bytes)))
        }

        static func base64URL(_ data: Data) -> String {
            data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
    }

    public func authorizationURL(pkce: PKCE, state: String, loginHint: String? = nil) -> URL {
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "prompt", value: "select_account"),
        ] + (loginHint.map { [URLQueryItem(name: "login_hint", value: $0)] } ?? [])
        return components.url!
    }

    public enum CallbackError: Error, Equatable { case stateMismatch, denied(String), missingCode }

    /// Extracts the authorization code from the redirect, checking the state we sent.
    public func code(from callback: URL, expectedState: String) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if let error = value("error") { throw CallbackError.denied(error) }
        guard value("state") == expectedState else { throw CallbackError.stateMismatch }
        guard let code = value("code"), !code.isEmpty else { throw CallbackError.missingCode }
        return code
    }

    public func tokenRequest(code: String, pkce: PKCE) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: pkce.verifier),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
        ]
        request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        return request
    }

    public static func idToken(fromTokenResponse data: Data) -> String? {
        struct Token: Decodable { let id_token: String? }
        return (try? JSONDecoder().decode(Token.self, from: data))?.id_token
    }
}
