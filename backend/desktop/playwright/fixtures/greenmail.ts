import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = resolve(REPO_ROOT, '..');
const RN_ROOT = resolve(WORKSPACE_ROOT, 'App.ReactNative');

const DEFAULT_COMPOSE_FILE = resolve(RN_ROOT, 'docker-compose.imap.yml');
const DEFAULT_SEED_SCRIPT = resolve(
  RN_ROOT,
  'FacturasSimplesRN',
  'e2e',
  'fixtures',
  'seed-imap-inbox.js',
);

export const GREENMAIL = {
  smtpHost: process.env.GREENMAIL_SMTP_HOST ?? 'localhost',
  smtpPort: Number(process.env.GREENMAIL_SMTP_PORT ?? 1025),
  imapHost: process.env.GREENMAIL_IMAP_HOST ?? '127.0.0.1',
  imapPort: Number(process.env.GREENMAIL_IMAP_PORT ?? 1143),
  user: process.env.GREENMAIL_USER ?? 'testuser@localhost',
  pass: process.env.GREENMAIL_PASS ?? 'testpass',
  to: process.env.GREENMAIL_TO ?? 'testuser@localhost',
};

function run(command: string, args: string[], cwd = REPO_ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise<void>((resolvePromise, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port }, () => {
        socket.end();
        resolvePromise();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function delay(ms: number) {
  return new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function quoteImapValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function hasTaggedResponse(buffer: string, tag: string, status: 'OK' | 'NO' | 'BAD') {
  const expected = `${tag} ${status}`;
  return buffer
    .split(/\r?\n/)
    .some((line) => line.toUpperCase().startsWith(expected));
}

export interface InboxCounts {
  messages: number;
  unseen: number;
}

/**
 * Reads INBOX (MESSAGES, UNSEEN) straight from GreenMail over IMAP.
 *
 * `unseen` is what pins the read-only guarantee: a Compras sync must open the
 * mailbox with EXAMINE and fetch with BODY.PEEK[], so every seeded message is
 * still unread afterwards. A regression to SELECT / BODY[] silently marks the
 * user's real mail as read, which no UI assertion can detect.
 */
function readInboxCounts(timeoutMs = 10_000) {
  return new Promise<InboxCounts>((resolvePromise, reject) => {
    const socket = net.connect({ host: GREENMAIL.imapHost, port: GREENMAIL.imapPort });
    let buffer = '';
    let settled = false;
    let stage: 'greeting' | 'login' | 'status' = 'greeting';

    const finish = (error: Error | undefined, counts: InboxCounts = { messages: 0, unseen: 0 }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolvePromise(counts);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out reading GreenMail INBOX status from ${GREENMAIL.imapHost}:${GREENMAIL.imapPort}`));
    }, timeoutMs);

    const send = (command: string) => {
      socket.write(`${command}\r\n`);
    };

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;

      if (stage === 'greeting' && /^\* OK/im.test(buffer)) {
        stage = 'login';
        buffer = '';
        send(`A1 LOGIN ${quoteImapValue(GREENMAIL.user)} ${quoteImapValue(GREENMAIL.pass)}`);
        return;
      }

      if (stage === 'login') {
        if (hasTaggedResponse(buffer, 'A1', 'NO') || hasTaggedResponse(buffer, 'A1', 'BAD')) {
          finish(new Error(`GreenMail IMAP login failed: ${buffer.trim()}`));
          return;
        }
        if (hasTaggedResponse(buffer, 'A1', 'OK')) {
          stage = 'status';
          buffer = '';
          send('A2 STATUS INBOX (MESSAGES UNSEEN)');
          return;
        }
      }

      if (stage === 'status') {
        if (hasTaggedResponse(buffer, 'A2', 'NO') || hasTaggedResponse(buffer, 'A2', 'BAD')) {
          finish(new Error(`GreenMail IMAP STATUS failed: ${buffer.trim()}`));
          return;
        }
        if (hasTaggedResponse(buffer, 'A2', 'OK')) {
          const match = buffer.match(/MESSAGES\s+(\d+)/i);
          if (!match) {
            finish(new Error(`GreenMail IMAP STATUS did not include message count: ${buffer.trim()}`));
            return;
          }
          const unseenMatch = buffer.match(/UNSEEN\s+(\d+)/i);
          send('A3 LOGOUT');
          finish(undefined, {
            messages: Number(match[1]),
            unseen: unseenMatch ? Number(unseenMatch[1]) : 0,
          });
        }
      }
    });
    socket.once('error', (error) => finish(error));
  });
}

async function waitForInboxMessages(expectedCount: number, timeoutMs = 15_000) {
  const started = Date.now();
  let lastCount = 0;
  let lastError: unknown;

  while (Date.now() - started <= timeoutMs) {
    try {
      lastCount = (await readInboxCounts()).messages;
      if (lastCount >= expectedCount) return lastCount;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(
    `GreenMail INBOX has ${lastCount} message(s); expected at least ${expectedCount}.${suffix}`,
  );
}

export async function prepareGreenMailInbox({ limit = 1, runId = 'desktop-greenmail' } = {}) {
  const composeFile = process.env.GREENMAIL_COMPOSE_FILE ?? DEFAULT_COMPOSE_FILE;
  const seedScript = process.env.GREENMAIL_SEED_SCRIPT ?? DEFAULT_SEED_SCRIPT;

  run('docker', ['compose', '-f', composeFile, 'up', '-d'], WORKSPACE_ROOT);
  run('docker', ['compose', '-f', composeFile, 'restart', 'greenmail'], WORKSPACE_ROOT);
  await waitForPort(GREENMAIL.smtpPort);
  await waitForPort(GREENMAIL.imapPort);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    run('node', [
      seedScript,
      '--smtp-host', GREENMAIL.smtpHost,
      '--smtp-port', String(GREENMAIL.smtpPort),
      '--user', GREENMAIL.user,
      '--pass', GREENMAIL.pass,
      '--to', GREENMAIL.to,
      '--limit', String(limit),
      '--run-id', runId,
    ], WORKSPACE_ROOT);

    try {
      return await waitForInboxMessages(limit);
    } catch (error) {
      lastError = error;
      await delay(1_000);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`GreenMail INBOX was not ready after seeding ${limit} message(s).`);
}

/**
 * Snapshot of INBOX message/unseen counts, for read-only assertions in specs.
 */
export async function getInboxCounts(): Promise<InboxCounts> {
  return readInboxCounts();
}
