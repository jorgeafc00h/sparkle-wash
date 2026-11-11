/**
 * DTEJsonParser — regresión de decodificación/normalización de adjuntos.
 *
 * Porta las cuatro formas de adjunto recuperadas por el commit 63bc010 de SwiftUI
 * ("recover DTEs the decode layer was silently dropping"), donde una auditoría IMAP
 * de solo lectura encontró que solo 26 de 53 correos filtrados llegaban a importarse.
 *
 *   1. JSON Latin-1 / Windows-1252        (Davivienda, "Notificación de Factura")
 *   2. JWS/JWT `header.payload.signature` (Facturación SV)
 *   3. quoted-printable                   (SISA) — lo resuelve mailparser en el main process
 *   4. Sobre del firmador `{nit, passwordPri, dteJson}` (FUNES HARTMANN)
 *
 * La forma 4 además nunca debe persistir la contraseña de firma del emisor en
 * `originalJson`.
 */

import { DTEJsonParser } from '../services/compras/DTEJsonParser';
import { decodeBase64ToText, decodeBytesToText, binaryStringToBytes } from '../services/compras/textDecoding';
import { CompraSource } from '../types/compras';

const COMPANY = 'company-1';

const buildDte = () => ({
  identificacion: {
    version: 3,
    ambiente: '01',
    tipoDte: '01',
    numeroControl: 'DTE-01-M001P001-000000000000001',
    codigoGeneracion: 'A1B2C3D4-0000-1111-2222-333344445555',
    fecEmi: '2026-01-15',
    horEmi: '10:30:00',
  },
  emisor: { nit: '06142312341234', nrc: '123456', nombre: 'CAFÉ EL SALVADOR, S.A. DE C.V.' },
  receptor: { nit: '06140000000000', nombre: 'Cliente Ñandú' },
  cuerpoDocumento: [
    { numItem: 1, descripcion: 'Café molido añejo', cantidad: 2, precioUni: 5, ventaGravada: 10 },
  ],
  resumen: { totalGravada: 10, totalIva: 1.3, totalPagar: 11.3, montoTotalOperacion: 11.3, condicionOperacion: 1 },
});

const toBase64 = (text: string, encoding: BufferEncoding) =>
  Buffer.from(text, encoding).toString('base64');

const base64url = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('DTEJsonParser — decodificación de adjuntos', () => {
  it('procesa JSON UTF-8 plano y conserva el payload tal cual', () => {
    const json = JSON.stringify(buildDte());
    const compra = DTEJsonParser.parse(json, COMPANY, CompraSource.Email);

    expect(compra).not.toBeNull();
    expect(compra!.emisorNombre).toBe('CAFÉ EL SALVADOR, S.A. DE C.V.');
    expect(compra!.originalJson).toBe(json);
  });

  describe('forma 1: charsets legacy', () => {
    it('decodifica bytes ISO-8859-1 sin corromper los acentos', () => {
      const json = JSON.stringify(buildDte());
      // Antes: TextDecoder('utf-8') no fatal → U+FFFD y nombre corrupto guardado.
      const text = decodeBase64ToText(toBase64(json, 'latin1'));

      expect(text).not.toContain('�');
      const compra = DTEJsonParser.parse(text, COMPANY, CompraSource.Email);
      expect(compra).not.toBeNull();
      expect(compra!.emisorNombre).toBe('CAFÉ EL SALVADOR, S.A. DE C.V.');
    });

    it('sigue decodificando UTF-8 normal (sin regresión en la ruta Gmail)', () => {
      const json = JSON.stringify(buildDte());
      // Antes en Gmail: atob() crudo → mojibake "CAFÃ‰" en TODO nombre acentuado.
      const text = decodeBase64ToText(toBase64(json, 'utf8'));

      expect(text).toBe(json);
      expect(text).not.toContain('Ã');
    });

    it('acepta base64url además de base64 estándar', () => {
      const json = JSON.stringify(buildDte());
      const b64url = toBase64(json, 'utf8').replace(/\+/g, '-').replace(/\//g, '_');
      expect(decodeBase64ToText(b64url)).toBe(json);
    });

    it('mapea el rango 0x80–0x9F de Windows-1252', () => {
      expect(decodeBytesToText(binaryStringToBytes('\x93Hola\x94'))).toBe('“Hola”');
      expect(decodeBytesToText(binaryStringToBytes('\x80'))).toBe('€');
    });

    it('nunca lanza con base64 malformado', () => {
      expect(() => decodeBase64ToText('!!!no-es-base64!!!')).not.toThrow();
    });
  });

  describe('forma 2: DTE envuelto en JWS/JWT', () => {
    it('desenvuelve un JWS de 3 segmentos', () => {
      const dte = buildDte();
      const token = [
        base64url(JSON.stringify({ alg: 'RS512', typ: 'JWT' })),
        base64url(JSON.stringify(dte)),
        base64url('firma'),
      ].join('.');

      const compra = DTEJsonParser.parse(token, COMPANY, CompraSource.Email);
      expect(compra).not.toBeNull();
      expect(compra!.codigoGeneracion).toBe(dte.identificacion.codigoGeneracion);
      expect(compra!.emisorNombre).toBe('CAFÉ EL SALVADOR, S.A. DE C.V.');
    });

    it('desenvuelve un token de 2 segmentos', () => {
      const token = `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(buildDte()))}`;
      expect(DTEJsonParser.parse(token, COMPANY, CompraSource.Email)).not.toBeNull();
    });

    it('guarda el DTE desenvuelto, no el token crudo', () => {
      const dte = buildDte();
      const token = `${base64url('{"alg":"RS512"}')}.${base64url(JSON.stringify(dte))}.${base64url('sig')}`;

      const compra = DTEJsonParser.parse(token, COMPANY, CompraSource.Email);
      expect(() => JSON.parse(compra!.originalJson!)).not.toThrow();
      expect(JSON.parse(compra!.originalJson!).identificacion.codigoGeneracion)
        .toBe(dte.identificacion.codigoGeneracion);
    });

    it('rechaza tokens que no llevan un DTE', () => {
      const token = `${base64url('{"alg":"none"}')}.${base64url('{"sub":"1234"}')}.${base64url('sig')}`;
      expect(DTEJsonParser.parse(token, COMPANY, CompraSource.Email)).toBeNull();
    });

    it('sigue rechazando entradas claramente inválidas', () => {
      expect(DTEJsonParser.parse('', COMPANY, CompraSource.Email)).toBeNull();
      expect(DTEJsonParser.parse('{no es json}', COMPANY, CompraSource.Email)).toBeNull();
      expect(DTEJsonParser.parse('42', COMPANY, CompraSource.Email)).toBeNull();
      expect(DTEJsonParser.parse('a.b.c', COMPANY, CompraSource.Email)).toBeNull();
    });
  });

  describe('forma 4: sobre del firmador', () => {
    const PASSWORD = 'ClaveSuperSecreta123';
    const envelope = (dte: unknown, asString = false) =>
      JSON.stringify({
        nit: '06142312341234',
        activo: true,
        passwordPri: PASSWORD,
        dteJson: asString ? JSON.stringify(dte) : dte,
      });

    it('desenvuelve un dteJson anidado como objeto', () => {
      const dte = buildDte();
      const compra = DTEJsonParser.parse(envelope(dte), COMPANY, CompraSource.Email);
      expect(compra).not.toBeNull();
      expect(compra!.codigoGeneracion).toBe(dte.identificacion.codigoGeneracion);
    });

    it('desenvuelve un dteJson anidado como cadena', () => {
      const dte = buildDte();
      const compra = DTEJsonParser.parse(envelope(dte, true), COMPANY, CompraSource.Email);
      expect(compra).not.toBeNull();
      expect(compra!.codigoGeneracion).toBe(dte.identificacion.codigoGeneracion);
    });

    it('NUNCA persiste la contraseña de firma del emisor en originalJson', () => {
      const compra = DTEJsonParser.parse(envelope(buildDte()), COMPANY, CompraSource.Email);

      expect(compra).not.toBeNull();
      expect(compra!.originalJson).not.toContain(PASSWORD);
      expect(compra!.originalJson).not.toContain('passwordPri');

      const stored = JSON.parse(compra!.originalJson!);
      expect(stored.identificacion).toBeDefined();
      expect(stored.dteJson).toBeUndefined();
      expect(stored.nit).toBeUndefined();
    });

    it('rechaza un sobre cuyo dteJson no es un DTE', () => {
      const bad = JSON.stringify({ nit: '1', passwordPri: PASSWORD, dteJson: { foo: 'bar' } });
      expect(DTEJsonParser.parse(bad, COMPANY, CompraSource.Email)).toBeNull();
    });
  });

  describe('normalize()', () => {
    it('devuelve el objeto y una cadena JSON canónica', () => {
      const dte = buildDte();
      const result = DTEJsonParser.normalize(JSON.stringify(dte));
      expect(result).not.toBeNull();
      expect(result!.object.identificacion?.codigoGeneracion).toBe(dte.identificacion.codigoGeneracion);
    });

    it('quita el BOM UTF-8', () => {
      expect(DTEJsonParser.normalize('﻿' + JSON.stringify(buildDte()))).not.toBeNull();
    });

    it('devuelve null para entradas irreconocibles', () => {
      expect(DTEJsonParser.normalize('nada')).toBeNull();
      expect(DTEJsonParser.normalize('')).toBeNull();
    });
  });
});
