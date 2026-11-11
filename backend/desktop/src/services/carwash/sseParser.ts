// Minimal Server-Sent Events parser (WHATWG framing): handles LF / CRLF / CR line
// endings, comment lines (": heartbeat"), multi-line data and chunks that split
// anywhere (even inside a UTF-8 line boundary).

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  push(chunk: string): void;
  reset(): void;
}

export function createSseParser(handlers: { onMessage: (msg: SseMessage) => void; onComment?: (text: string) => void }): SseParser {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let lastWasCr = false;

  const dispatch = () => {
    if (data.length > 0 || event) {
      handlers.onMessage({ event: event || 'message', data: data.join('\n'), id });
    }
    event = '';
    data = [];
    id = undefined;
  };

  const processLine = (line: string) => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) {
      handlers.onComment?.(line.slice(1).trim());
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  };

  return {
    push(chunk: string) {
      let text = chunk;
      // A "\r" at the end of the previous chunk already ended a line; swallow a leading "\n".
      if (lastWasCr && text.startsWith('\n')) text = text.slice(1);
      lastWasCr = text.endsWith('\r');
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const ch = buffer[i];
        if (ch === '\n' || ch === '\r') {
          processLine(buffer.slice(start, i));
          if (ch === '\r' && buffer[i + 1] === '\n') i += 1;
          start = i + 1;
        }
      }
      buffer = buffer.slice(start);
    },
    reset() {
      buffer = '';
      event = '';
      data = [];
      id = undefined;
      lastWasCr = false;
    },
  };
}

/** Topics from an SSE `change` message ({"topic":"jobs"}); null when not parseable. */
export function parseChangeTopic(msg: SseMessage): string | null {
  if (msg.event !== 'change') return null;
  try {
    const parsed = JSON.parse(msg.data) as { topic?: unknown };
    return typeof parsed.topic === 'string' ? parsed.topic : null;
  } catch {
    return null;
  }
}
