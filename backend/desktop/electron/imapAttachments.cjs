// imapAttachments — pure helpers for the main-process IMAP compras import.
//
// Suppliers attach DTE JSON in many shapes: `.json`, `.txt`, no filename with
// `application/json` or `application/octet-stream`, or inside a forwarded
// message (`message/rfc822`, Outlook's "forward as attachment"). Matching on
// the filename extension alone silently missed those.

'use strict';

const MAX_FORWARD_DEPTH = 2;

function matchesDomain(domain, base) {
  return domain === base || domain.endsWith(`.${base}`);
}

function imapAutoDetect(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return null;
  const is = (...bases) => bases.some((b) => matchesDomain(domain, b));
  if (is('gmail.com', 'googlemail.com')) {
    return { host: 'imap.gmail.com', port: 993, tls: true };
  }
  if (is('outlook.com', 'hotmail.com', 'live.com', 'office365.com')) {
    return { host: 'outlook.office365.com', port: 993, tls: true };
  }
  if (is('yahoo.com', 'yahoo.es')) {
    return { host: 'imap.mail.yahoo.com', port: 993, tls: true };
  }
  if (is('icloud.com', 'me.com', 'mac.com')) {
    return { host: 'imap.mail.me.com', port: 993, tls: true };
  }
  if (is('aol.com')) {
    return { host: 'imap.aol.com', port: 993, tls: true };
  }
  return null;
}

/** First meaningful bytes of a Buffer, skipping a UTF-8 BOM and whitespace. */
function leadingText(content, length) {
  if (!content || typeof content.subarray !== 'function') return '';
  let start = 0;
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) start = 3;
  while (start < content.length && /\s/.test(String.fromCharCode(content[start]))) start++;
  return content.subarray(start, start + length).toString('latin1');
}

/**
 * Classifies a mailparser attachment as a DTE container.
 * @returns {'json'|'txt'|'pdf'|null}
 */
function classifyAttachment(attachment) {
  const name = String(attachment?.filename || '').toLowerCase();
  const type = String(attachment?.contentType || '').toLowerCase().split(';')[0].trim();
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (name.endsWith('.json') || type === 'application/json' || type.endsWith('+json')) return 'json';
  if (name.endsWith('.txt')) return 'txt';
  // Generic binary / text parts: sniff the payload.
  if (type === 'application/octet-stream' || type === 'text/plain' || !name) {
    const head = leadingText(attachment?.content, 5);
    if (head.startsWith('{')) return 'json';
    if (head.startsWith('%PDF-')) return 'pdf';
  }
  return null;
}

function attachmentFilename(attachment, kind, index) {
  if (attachment?.filename) return attachment.filename;
  return `adjunto-${index + 1}.${kind}`;
}

/**
 * Collects DTE-relevant attachments from a parsed message, descending into
 * forwarded `message/rfc822` attachments (bounded depth).
 * @param {object} parsed  mailparser ParsedMail
 * @param {(raw: Buffer) => Promise<object>} parse  mailparser.simpleParser
 */
async function collectDteAttachments(parsed, parse, depth = 0) {
  const out = [];
  const attachments = Array.isArray(parsed?.attachments) ? parsed.attachments : [];
  for (const attachment of attachments) {
    const type = String(attachment?.contentType || '').toLowerCase();
    if (type.startsWith('message/rfc822') && depth < MAX_FORWARD_DEPTH && attachment.content) {
      try {
        const nested = await parse(attachment.content);
        out.push(...(await collectDteAttachments(nested, parse, depth + 1)));
      } catch {
        // A malformed forwarded message must not hide the outer attachments.
      }
      continue;
    }
    const kind = classifyAttachment(attachment);
    if (!kind) continue;
    out.push({
      filename: attachmentFilename(attachment, kind, out.length),
      kind,
      size: attachment.size ?? attachment.content?.length ?? 0,
      contentBase64: attachment.content?.toString('base64') ?? '',
    });
  }
  return out;
}

module.exports = { imapAutoDetect, classifyAttachment, collectDteAttachments };
