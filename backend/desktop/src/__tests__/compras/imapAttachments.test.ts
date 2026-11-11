// electron/imapAttachments.cjs — which mail parts the IMAP import treats as
// DTE containers, and the provider auto-detect.

/* eslint-disable @typescript-eslint/no-require-imports */
const { classifyAttachment, collectDteAttachments, imapAutoDetect } = require('../../../electron/imapAttachments.cjs');

const json = Buffer.from('﻿  {"identificacion":{}}', 'utf8');
const pdf = Buffer.from('%PDF-1.7 ...', 'latin1');

describe('classifyAttachment', () => {
  it('uses the filename extension when present', () => {
    expect(classifyAttachment({ filename: 'DTE.JSON', content: json })).toBe('json');
    expect(classifyAttachment({ filename: 'dte.txt', content: json })).toBe('txt');
    expect(classifyAttachment({ filename: 'factura.pdf', content: pdf })).toBe('pdf');
  });

  it('accepts JSON/PDF identified only by content type', () => {
    expect(classifyAttachment({ contentType: 'application/json; charset=utf-8', content: json })).toBe('json');
    expect(classifyAttachment({ filename: 'documento', contentType: 'application/pdf', content: pdf })).toBe('pdf');
  });

  it('sniffs generic octet-stream parts (BOM and whitespace tolerated)', () => {
    expect(classifyAttachment({ filename: 'adjunto', contentType: 'application/octet-stream', content: json })).toBe('json');
    expect(classifyAttachment({ contentType: 'application/octet-stream', content: pdf })).toBe('pdf');
  });

  it('ignores unrelated attachments', () => {
    expect(classifyAttachment({ filename: 'logo.png', contentType: 'image/png', content: Buffer.from([0x89]) })).toBeNull();
    expect(classifyAttachment({ filename: 'notas.docx', contentType: 'application/octet-stream', content: Buffer.from('PK') })).toBeNull();
  });
});

describe('collectDteAttachments', () => {
  it('descends into forwarded messages and names unnamed parts', async () => {
    const forwarded = {
      attachments: [
        { filename: 'reenviado.json', contentType: 'application/json', content: json, size: json.length },
      ],
    };
    const parse = jest.fn(async () => forwarded);
    const out = await collectDteAttachments(
      {
        attachments: [
          { contentType: 'message/rfc822', content: Buffer.from('raw forwarded email') },
          { contentType: 'application/octet-stream', content: pdf, size: pdf.length },
          { filename: 'firma.png', contentType: 'image/png', content: Buffer.from([0x89]) },
        ],
      },
      parse,
    );
    expect(parse).toHaveBeenCalledTimes(1);
    expect(out.map((a: { filename: string; kind: string }) => [a.filename, a.kind])).toEqual([
      ['reenviado.json', 'json'],
      ['adjunto-2.pdf', 'pdf'],
    ]);
    expect(Buffer.from(out[0].contentBase64, 'base64').equals(json)).toBe(true);
  });

  it('keeps the outer attachments when a forwarded message cannot be parsed', async () => {
    const out = await collectDteAttachments(
      {
        attachments: [
          { contentType: 'message/rfc822', content: Buffer.from('garbage') },
          { filename: 'dte.json', content: json },
        ],
      },
      jest.fn(async () => {
        throw new Error('bad mime');
      }),
    );
    expect(out).toHaveLength(1);
  });
});

describe('imapAutoDetect', () => {
  it('matches provider domains exactly (or as a subdomain)', () => {
    expect(imapAutoDetect('a@gmail.com')).toMatchObject({ host: 'imap.gmail.com', port: 993 });
    expect(imapAutoDetect('a@outlook.com')).toMatchObject({ host: 'outlook.office365.com' });
    expect(imapAutoDetect('a@evilgmail.com')).toBeNull();
    expect(imapAutoDetect('a@empresa.com.sv')).toBeNull();
  });
});
