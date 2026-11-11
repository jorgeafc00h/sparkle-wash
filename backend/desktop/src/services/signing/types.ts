// Types for the local DTE signing service
// Mirrors the .NET CertificadoMH structure from MHClient.Service

export interface CertificateData {
  id: string;
  nit: string;
  publicKey: KeyData;
  privateKey: KeyData;
  activo: boolean;
}

export interface KeyData {
  /** SHA512 hash of the certificate password */
  clave: string;
  /** PKCS8 encoded key bytes (base64 decoded from XML) */
  encoded: Uint8Array;
}

export interface SignatureRequest {
  nit: string;
  passwordPri: string; // SHA512 hash of certificate password
  dteJson: string; // Serialized DTE JSON payload
  /** Sign with the production company's certificate (falls back to the test one). */
  isProduction?: boolean;
}

export interface SignatureResponse {
  status: 'OK' | 'ERROR';
  body: string; // JWS RS512 signed token
}

export interface CertificateValidationResult {
  isValid: boolean;
  message: string;
}
