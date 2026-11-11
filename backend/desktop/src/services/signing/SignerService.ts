// Local DTE Signing Service
// Signs DTE documents locally using RSA RS512 JWS.
// Uses jose library for JWS creation (equivalent to .NET jose-jwt).

import { importPKCS8, CompactSign } from 'jose';
import { parseCertificateXML, pkcs8ToPem } from './CertificateParser';
import {
  CertificateData,
  SignatureRequest,
  SignatureResponse,
  CertificateValidationResult,
} from './types';

// In-memory certificate cache (mirrors .NET MemoryCache with 30-day expiry)
const certificateCache = new Map<string, { data: CertificateData; expiresAt: number }>();
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Cache key for a NIT. company.nit is free-text (users type it as printed,
 * e.g. "0614-140494-134-2") and is what CertificateService caches under, but
 * SyncLocal and the production-access wizard sign with the digits-only NIT
 * (dte.emisor.nit / nitDigits). Keying on raw strings made every signature for
 * a dashed NIT miss the cache ("No se encontró certificado"), so nothing
 * reached MH. Production companies have their own certificate, so the
 * environment is part of the key.
 */
const cacheKey = (nit: string, isProduction = false): string =>
  `${isProduction ? 'prod:' : ''}${(nit || '').replace(/\D/g, '')}`;

export class SignerService {
  /**
   * Sign a DTE document with RS512 JWS.
   * Equivalent to .NET SignerService.SignAsync()
   */
  async signAsync(request: SignatureRequest): Promise<SignatureResponse> {
    // Test escape hatch: when `__mock_signer=true` is set in localStorage,
    // return a fake JWS without touching the real certificate material.
    // Mirrors the `__mock_mh_api` hook in MhClient. Never read in production.
    try {
      if (
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('__mock_signer') === 'true'
      ) {
        // UTF-8 → base64url. Plain btoa() throws on anything outside Latin-1
        // (e.g. the "—" in the contingency motivo), which silently dropped
        // the mock into real signing and failed every contingency event.
        const b64url = (text: string) => {
          let binary = '';
          for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
          return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const fakeHeader = b64url(JSON.stringify({ alg: 'RS512', typ: 'JWT' }));
        const fakePayload = b64url(request.dteJson);
        const fakeSig = 'mock-signature';
        return { status: 'OK', body: `${fakeHeader}.${fakePayload}.${fakeSig}` };
      }
    } catch {
      // Fall through to real signing if the localStorage probe fails
    }

    try {
      const certificate = await this.getCertificate(
        request.nit,
        request.passwordPri,
        false,
        request.isProduction,
      );
      const jwsToken = await this.signDocument(certificate, request.dteJson);

      return {
        status: 'OK',
        body: jwsToken,
      };
    } catch (error) {
      console.error('[SignerService] Error signing DTE:', error);
      throw error;
    }
  }

  /**
   * Validate that a certificate exists and the password matches.
   */
  async validateCertificate(
    nit: string,
    passwordHash: string,
    force: boolean = false
  ): Promise<CertificateValidationResult> {
    try {
      const certificate = await this.getCertificate(nit, passwordHash, force);
      return {
        isValid: certificate.privateKey.clave === passwordHash,
        message: 'Certificate is valid',
      };
    } catch (error) {
      return {
        isValid: false,
        message: error instanceof Error ? error.message : 'Certificate validation failed',
      };
    }
  }

  /**
   * Load a certificate from XML content and cache it.
   */
  loadCertificateFromXML(xmlContent: string): CertificateData {
    const certificate = parseCertificateXML(xmlContent);
    this.setCachedCertificate(certificate.nit, certificate);
    return certificate;
  }

  setCachedCertificate(nit: string, certificate: CertificateData, isProduction = false): void {
    certificateCache.set(cacheKey(nit, isProduction), {
      data: certificate,
      expiresAt: Date.now() + CACHE_DURATION_MS,
    });
  }

  getCachedCertificate(nit: string, isProduction = false): CertificateData | null {
    const cached = certificateCache.get(cacheKey(nit, isProduction));
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    return null;
  }

  reloadCertificate(nit: string, isProduction = false): void {
    certificateCache.delete(cacheKey(nit, isProduction));
  }

  private async getCertificate(
    nit: string,
    passwordHash: string,
    bypassCache: boolean = false,
    isProduction: boolean = false
  ): Promise<CertificateData> {
    if (!bypassCache) {
      const cached = certificateCache.get(cacheKey(nit, isProduction));
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.data.privateKey.clave !== passwordHash) {
          throw new Error('Credenciales invalidas');
        }
        return cached.data;
      }
    }

    // If not in cache, try to load from SecureStorage
    try {
      const { SecureStorageService } = await import('../security/SecureStorageService');
      const xmlContent = await SecureStorageService.getCertificateData(nit, isProduction);
      if (xmlContent) {
        const certificate = parseCertificateXML(xmlContent);
        if (certificate.privateKey.clave !== passwordHash) {
          throw new Error('Credenciales invalidas');
        }
        this.setCachedCertificate(nit, certificate, isProduction);
        return certificate;
      }
    } catch (e) {
      // If the error is about credentials, rethrow
      if (e instanceof Error && e.message === 'Credenciales invalidas') throw e;
      // Otherwise, fall through to the not-found error
    }

    throw new Error(
      'No se encontro certificado. Debe configurar el certificado desde la app.'
    );
  }

  /**
   * Sign a DTE JSON string using RS512 JWS.
   */
  private async signDocument(
    certificate: CertificateData,
    dteJson: string
  ): Promise<string> {
    try {
      const pemKey = pkcs8ToPem(certificate.privateKey.encoded);
      const privateKey = await importPKCS8(pemKey, 'RS512');

      const encoder = new TextEncoder();
      const jws = await new CompactSign(encoder.encode(dteJson))
        .setProtectedHeader({ alg: 'RS512' })
        .sign(privateKey);

      return jws;
    } catch (error) {
      console.error('[SignerService] Error signing document:', error);
      throw new Error(
        `Error signing JSON document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Singleton instance
let signerServiceInstance: SignerService | null = null;

export const getSignerService = (): SignerService => {
  if (!signerServiceInstance) {
    signerServiceInstance = new SignerService();
  }
  return signerServiceInstance;
};

export default SignerService;
