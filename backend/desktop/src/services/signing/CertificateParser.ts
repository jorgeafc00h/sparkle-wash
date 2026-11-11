// Certificate XML Parser
// Parses XML-serialized CertificadoMH .crt files from the government
// Equivalent to the .NET XmlSerializer deserialization in SignerService.cs

import { XMLParser } from 'fast-xml-parser';
import { CertificateData, KeyData } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false, // Keep all values as strings to preserve leading zeros (e.g. NIT)
  trimValues: true,
});

/**
 * Parse an XML-serialized CertificadoMH certificate file.
 *
 * Expected XML structure:
 * ```xml
 * <CertificadoMH>
 *   <_id>...</_id>
 *   <nit>...</nit>
 *   <publicKey>
 *     <clave>...</clave>
 *     <encodied>BASE64_BYTES</encodied>
 *   </publicKey>
 *   <privateKey>
 *     <clave>SHA512_HASH</clave>
 *     <encodied>PKCS8_BASE64_BYTES</encodied>
 *   </privateKey>
 *   <activo>true</activo>
 * </CertificadoMH>
 * ```
 */
export function parseCertificateXML(xmlContent: string): CertificateData {
  const parsed = parser.parse(xmlContent);

  const cert = parsed.CertificadoMH;
  if (!cert) {
    throw new Error('Invalid certificate XML: missing CertificadoMH root element');
  }

  const publicKey = parseKeyData(cert.publicKey, 'publicKey');
  const privateKey = parseKeyData(cert.privateKey, 'privateKey');

  return {
    id: String(cert._id || ''),
    nit: String(cert.nit || ''),
    publicKey,
    privateKey,
    activo: cert.activo === true || cert.activo === 'true',
  };
}

function parseKeyData(keyNode: unknown, fieldName: string): KeyData {
  if (!keyNode || typeof keyNode !== 'object') {
    throw new Error(`Invalid certificate XML: missing ${fieldName} element`);
  }

  const node = keyNode as Record<string, unknown>;
  const clave = String(node.clave || '');
  const encodedBase64 = String(node.encodied || '');

  if (!encodedBase64) {
    throw new Error(`Invalid certificate XML: missing ${fieldName}.encodied data`);
  }

  const encoded = base64ToUint8Array(encodedBase64);
  return { clave, encoded };
}

/**
 * Convert a base64 string to Uint8Array.
 * Works in both browser and Node.js environments.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const cleanBase64 = base64.replace(/\s/g, '');

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(cleanBase64, 'base64'));
  }

  // Fallback: use atob (available in browsers)
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to PEM format string for PKCS8 private key.
 * The jose library's importPKCS8() expects PEM-encoded keys.
 */
export function pkcs8ToPem(pkcs8Bytes: Uint8Array): string {
  let base64: string;

  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(pkcs8Bytes).toString('base64');
  } else {
    let binary = '';
    for (let i = 0; i < pkcs8Bytes.length; i++) {
      binary += String.fromCharCode(pkcs8Bytes[i]);
    }
    base64 = btoa(binary);
  }

  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.substring(i, i + 64));
  }

  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}
