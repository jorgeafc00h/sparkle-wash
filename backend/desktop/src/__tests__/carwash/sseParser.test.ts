import { createSseParser, parseChangeTopic, type SseMessage } from '@/services/carwash/sseParser';

function collect() {
  const messages: SseMessage[] = [];
  const comments: string[] = [];
  const parser = createSseParser({ onMessage: (m) => messages.push(m), onComment: (c) => comments.push(c) });
  return { parser, messages, comments };
}

describe('SSE parser', () => {
  it('parses change events and ignores heartbeats', () => {
    const { parser, messages, comments } = collect();
    parser.push(': heartbeat\n\nevent: change\ndata: {"topic":"jobs"}\n\n');
    expect(comments).toEqual(['heartbeat']);
    expect(messages).toHaveLength(1);
    expect(parseChangeTopic(messages[0])).toBe('jobs');
  });

  it('handles chunks split anywhere, including mid-line', () => {
    const { parser, messages } = collect();
    for (const piece of ['event: ch', 'ange\nda', 'ta: {"topic":"arri', 'vals"}\n', '\n']) parser.push(piece);
    expect(messages.map(parseChangeTopic)).toEqual(['arrivals']);
  });

  it('handles CRLF (including a CR/LF split across chunks) and multi-line data', () => {
    const { parser, messages } = collect();
    parser.push('event: change\r\ndata: a\r');
    parser.push('\ndata: b\r\n\r\n');
    expect(messages).toEqual([{ event: 'change', data: 'a\nb', id: undefined }]);
  });

  it('defaults the event name to "message" and drops non-change events from topics', () => {
    const { parser, messages } = collect();
    parser.push('data: hi\n\n');
    expect(messages[0].event).toBe('message');
    expect(parseChangeTopic(messages[0])).toBeNull();
    expect(parseChangeTopic({ event: 'change', data: 'not json' })).toBeNull();
  });
});
