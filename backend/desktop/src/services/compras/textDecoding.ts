// Byte→texto para adjuntos DTE.
//
// El JSON de un DTE llega de los emisores en más de un charset. Convertir bytes
// a texto exige conocerlo:
//   • UTF-8 (la gran mayoría)
//   • ISO-8859-1 / Windows-1252 (p.ej. Davivienda "Notificación de Factura")
//
// Antes había un error simétrico en las dos rutas de importación:
//   - IMAP usaba `new TextDecoder('utf-8')` (no fatal), así que los bytes
//     legacy se volvían U+FFFD: la compra se importaba con el nombre del
//     emisor corrupto, y ese texto corrupto quedaba guardado en originalJson.
//   - Gmail devolvía `atob(...)` tal cual (una cadena binaria latin1), así que
//     *todo* nombre acentuado en UTF-8 salía como mojibake ("CAFÉ" → "CAFÃ‰").
//
// Espeja el fallback de codificación de SwiftUI DTEPurchaseParser.jsonObject(from:)
// (`[.isoLatin1, .windowsCP1252]`).

/** Convierte una cadena binaria (un char por octeto, como la de `atob`) a bytes. */
export function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * Decodifica bytes a texto: intenta UTF-8 estricto y cae a Windows-1252.
 * WHATWG mapea ISO-8859-1 → windows-1252, así que un solo fallback cubre ambos.
 * Nunca lanza.
 */
export function decodeBytesToText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      // Último recurso: latin1 manual (1 byte = 1 code point).
      let out = '';
      for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
      return out;
    }
  }
}

/** Decodifica un adjunto base64 (estándar o base64url) a texto. Nunca lanza. */
export function decodeBase64ToText(base64: string): string {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeBytesToText(binaryStringToBytes(atob(normalized)));
  } catch {
    return '';
  }
}
