// CertificateService — Desktop certificate lifecycle management.
// Wraps SecureStorageService (storage) + CertificateParser (parsing) + SignerService (cache).
// Based on the RN CertificateService, adapted for Desktop (no Expo, no DocumentPicker).

import { parseCertificateXML } from '@/services/signing/CertificateParser';
import { getSignerService } from '@/services/signing/SignerService';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import type { CertificateData } from '@/services/signing/types';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface CertificateInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  thumbprint: string;
}

export interface CertificateLoadResult {
  success: boolean;
  info?: CertificateInfo;
  error?: string;
}

export interface CertificateValidationResult {
  valid: boolean;
  expiresAt?: string;
  error?: string;
}

// Hacienda's .crt carries the NIT as digits; company.nit may be typed dashed.
const nitDigits = (nit: string): string => (nit || '').replace(/\D/g, '');

// ─── Service ──────────────────────────────────────────────────────────────────

export class CertificateService {
  /**
   * Parse and validate a .crt XML certificate file provided as a string.
   * Returns structured metadata derived from the XML certificate.
   *
   * The Desktop app receives .crt files either via Electron file-open dialog or
   * drag-and-drop; the caller is responsible for reading the file to a string.
   */
  static async loadCertificate(
    xmlContent: string,
    _password?: string
  ): Promise<CertificateInfo> {
    let certData: CertificateData;
    try {
      certData = parseCertificateXML(xmlContent);
    } catch (err) {
      throw new Error(
        `Error al leer el certificado: ${err instanceof Error ? err.message : 'Formato inválido'}`
      );
    }

    if (!certData.activo) {
      throw new Error('El certificado está inactivo o revocado.');
    }

    // Build a CertificateInfo from available fields.
    // The government .crt XML does not embed x509 subject/issuer strings directly —
    // we synthesize them from the NIT and the certificate ID.
    const info: CertificateInfo = {
      subject: certData.nit ? `NIT=${certData.nit}` : 'Desconocido',
      issuer: 'Ministerio de Hacienda El Salvador',
      validFrom: new Date().toISOString(), // .crt XML has no explicit validity dates
      validTo: '',
      serialNumber: certData.id,
      thumbprint: certData.privateKey.clave, // SHA512 hash serves as thumbprint
    };

    return info;
  }

  /**
   * Parse, cache in SignerService, and persist a .crt XML certificate for a company NIT.
   * Call this after the user selects a certificate file. A production company
   * keeps its own certificate (Hacienda issues one per environment).
   */
  static async storeCertificateForCompany(
    companyNit: string,
    xmlContent: string,
    password: string,
    isProduction = false
  ): Promise<void> {
    if (!companyNit) {
      throw new Error('NIT de empresa requerido para almacenar el certificado.');
    }

    let certData: CertificateData;
    try {
      certData = parseCertificateXML(xmlContent);
    } catch (err) {
      throw new Error(
        `Error al parsear certificado: ${err instanceof Error ? err.message : 'XML inválido'}`
      );
    }

    // Validate NIT matches if the cert carries one
    if (certData.nit && nitDigits(certData.nit) !== nitDigits(companyNit)) {
      throw new Error(
        `El certificado pertenece al NIT ${certData.nit}, pero la empresa tiene NIT ${companyNit}.`
      );
    }

    // Store XML + password in SecureStorage
    await SecureStorageService.storeCertificateData(companyNit, xmlContent, isProduction);
    await SecureStorageService.storeCertificatePassword(companyNit, password, isProduction);

    // Load into SignerService in-memory cache for immediate use
    const signer = getSignerService();
    signer.setCachedCertificate(companyNit, certData, isProduction);
  }

  /**
   * Retrieve the stored certificate XML and password for a company.
   * Returns null if not configured.
   */
  static async getCertificateForCompany(
    companyNit: string,
    isProduction = false
  ): Promise<{ certData: string; password: string } | null> {
    const [certData, password] = await Promise.all([
      SecureStorageService.getCertificateData(companyNit, isProduction),
      SecureStorageService.getCertificatePassword(companyNit, isProduction),
    ]);

    if (!certData || !password) return null;
    return { certData, password };
  }

  /**
   * Validate the stored certificate for a company NIT.
   * Checks: cert exists, parses OK, is active, password matches the stored hash.
   */
  static async validateCertificate(
    companyNit: string,
    isProduction = false
  ): Promise<CertificateValidationResult> {
    try {
      const stored = await CertificateService.getCertificateForCompany(companyNit, isProduction);
      if (!stored) {
        return {
          valid: false,
          error: 'No hay certificado almacenado para esta empresa.',
        };
      }

      let certData: CertificateData;
      try {
        certData = parseCertificateXML(stored.certData);
      } catch (err) {
        return {
          valid: false,
          error: `Certificado dañado o con formato inválido: ${err instanceof Error ? err.message : ''}`,
        };
      }

      if (!certData.activo) {
        return { valid: false, error: 'El certificado está inactivo.' };
      }

      // Password must match the hash stored in the XML
      if (stored.password && certData.privateKey.clave !== stored.password) {
        return {
          valid: false,
          error: 'La contraseña del certificado no coincide.',
        };
      }

      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Error al validar certificado.',
      };
    }
  }

  /**
   * Restore certificate from SecureStorage into SignerService cache.
   * Should be called on app startup to re-enable signing without user interaction.
   */
  static async restoreCertificate(companyNit: string, isProduction = false): Promise<boolean> {
    try {
      const xmlContent = await SecureStorageService.getCertificateData(companyNit, isProduction);
      if (!xmlContent) return false;

      const certData = parseCertificateXML(xmlContent);
      const signer = getSignerService();
      signer.setCachedCertificate(companyNit, certData, isProduction);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove certificate and password for a company from all stores.
   * Also evicts the SignerService cache entry.
   */
  static async removeCertificate(companyNit: string, isProduction = false): Promise<void> {
    await Promise.all([
      SecureStorageService.removeCertificateData(companyNit, isProduction),
      SecureStorageService.removeCertificatePassword(companyNit, isProduction),
    ]);

    // Evict from signer cache so signing fails cleanly until re-configured
    const signer = getSignerService();
    signer.reloadCertificate(companyNit, isProduction); // clears the NIT entry from cache
  }

  /**
   * Alias for removeCertificate — name matches the UI's convention for
   * "remove everything related to this company's certificate".
   */
  static async removeCertificateForCompany(companyNit: string, isProduction = false): Promise<void> {
    return CertificateService.removeCertificate(companyNit, isProduction);
  }

  /**
   * Check whether a company has a certificate that passes local validation.
   * Convenience wrapper used by UI to gate DTE submission.
   */
  static async hasValidCertificate(companyNit: string, isProduction = false): Promise<boolean> {
    const result = await CertificateService.validateCertificate(companyNit, isProduction);
    return result.valid;
  }

  /**
   * Return a concise status object for display in settings screens.
   */
  static async getCertificateStatus(companyNit: string, isProduction = false): Promise<{
    hasFile: boolean;
    hasPassword: boolean;
    isValid: boolean;
    message: string;
  }> {
    const [certData, password] = await Promise.all([
      SecureStorageService.getCertificateData(companyNit, isProduction),
      SecureStorageService.getCertificatePassword(companyNit, isProduction),
    ]);

    const hasFile = !!certData;
    const hasPassword = !!password;

    if (!hasFile || !hasPassword) {
      return {
        hasFile,
        hasPassword,
        isValid: false,
        message: !hasFile
          ? 'No hay certificado almacenado'
          : 'Falta la contraseña del certificado',
      };
    }

    const validation = await CertificateService.validateCertificate(companyNit, isProduction);
    return {
      hasFile: true,
      hasPassword: true,
      isValid: validation.valid,
      message: validation.valid
        ? 'Certificado configurado y válido'
        : validation.error ?? 'Certificado no válido',
    };
  }
}

export default CertificateService;
