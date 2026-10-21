import AuthenticationServices
import Foundation
import SparkleKit
import UIKit

/// Google sign-in with ASWebAuthenticationSession + PKCE (no SDK). Returns a Google ID token that the
/// SparkleWash API verifies (its SPARKLEWASH_GOOGLE_CLIENT_ID must include this iOS client ID).
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: Error { case cancelled, noIdToken }

    private let oauth: GoogleOAuth
    private var session: ASWebAuthenticationSession?

    init(clientId: String) { oauth = GoogleOAuth(clientId: clientId) }

    func idToken() async throws -> String {
        let pkce = GoogleOAuth.PKCE.random()
        let state = UUID().uuidString
        let url = oauth.authorizationURL(pkce: pkce, state: state)
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: oauth.redirectScheme) { callback, error in
                if let callback { continuation.resume(returning: callback); return }
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: Failure.cancelled)
                } else {
                    continuation.resume(throwing: error ?? Failure.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
        let code = try oauth.code(from: callback, expectedState: state)
        let (data, response) = try await URLSession.shared.data(for: oauth.tokenRequest(code: code, pkce: pkce))
        guard (response as? HTTPURLResponse)?.statusCode == 200, let token = GoogleOAuth.idToken(fromTokenResponse: data) else { throw Failure.noIdToken }
        return token
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
