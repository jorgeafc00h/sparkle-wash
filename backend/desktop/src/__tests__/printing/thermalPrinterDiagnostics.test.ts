// Ticket printer diagnostics + USB (spooler) error reporting, main process.
// Prod App Insights (2026-10-13) showed a customer with a USB printer retrying
// the default NETWORK connection (192.168.1.100:9100 → timeout) seven times:
// nothing said where the ticket stopped. Windows is simulated by mocking
// child_process — each PowerShell script is decoded and answered by role.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import * as net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

let mockScripts: string[] = [];
let mockRespond: (script: string) => { stdout?: string; stderr?: string; error?: unknown } = () => ({});

jest.mock('child_process', () => ({
  execFile: jest.fn((_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, out: string, err: string) => void) => {
    const i = args.indexOf('-EncodedCommand');
    const script = i >= 0 ? Buffer.from(args[i + 1], 'base64').toString('utf16le') : args.join(' ');
    mockScripts.push(script);
    const r = mockRespond(script);
    setImmediate(() => cb(r.error ?? null, r.stdout ?? '', r.stderr ?? ''));
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const svc = require('../../../electron/thermalPrinterService.cjs');

const QUEUE = 'EPSON TM-T20II Receipt5';
const usbConfig = { transport: 'spooler', spooler: { printerName: QUEUE } };
const isInfo = (s: string) => s.includes('Get-Printer -Name');
const isRawJob = (s: string) => s.includes('[FsRawPrinter]::Send');

const healthyInfo = {
  languageMode: 'FullLanguage',
  spooler: 'Running',
  queues: ['Microsoft Print to PDF', QUEUE],
  queue: {
    driver: QUEUE,
    port: 'USB001',
    status: 'Normal',
    jobs: 0,
    workOffline: false,
    driverVersion: 3,
    portDescription: 'Virtual printer port for USB',
  },
};

function windows(info: Record<string, unknown>, raw = 'FSRAW:OK') {
  mockRespond = (script) => (isInfo(script)
    ? { stdout: JSON.stringify(info) }
    : isRawJob(script)
      ? raw === 'TIMEOUT'
        ? { error: Object.assign(new Error('Command failed: powershell.exe -EncodedCommand AAAA'), { killed: true, signal: 'SIGTERM' }) }
        : { stdout: raw, error: raw === 'FSRAW:OK' ? null : Object.assign(new Error('exit 2'), { code: 2 }) }
      : { stdout: '' });
}

const stepOf = (result: { steps: Array<{ id: string }> }, id: string) =>
  result.steps.find((s) => s.id === id) as { status: string; detail: string; hint?: string } | undefined;

describe('USB (spooler) on Windows', () => {
  const realPlatform = process.platform;
  const realTemp = process.env.TEMP;
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'fs-printer-test-'));
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.TEMP = tempDir; // os.tmpdir() on win32
  });
  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    process.env.TEMP = realTemp;
    rmSync(tempDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    mockScripts = [];
  });

  it('a healthy USB queue passes every step, ending with a RAW job that prints nothing', async () => {
    windows(healthyInfo);
    const result = await svc.diagnose(usbConfig);
    expect(result.ok).toBe(true);
    expect(result.steps.map((s: { id: string }) => s.id)).toEqual(
      ['spooler-service', 'queue', 'port', 'state', 'jobs', 'driver', 'raw-job'],
    );
    expect(result.steps.every((s: { status: string }) => s.status === 'ok')).toBe(true);
    expect(stepOf(result, 'port')?.detail).toContain('USB (USB001)');
  });

  it('offline printer, stuck jobs, a v4 driver and a RAW rejection are each named', async () => {
    windows(
      { ...healthyInfo, queue: { ...healthyInfo.queue, status: 'Offline', jobs: 2, jobStates: ['Error', 'Printing'], driverVersion: 4 } },
      'FSRAW:StartDocPrinter:1804',
    );
    const result = await svc.diagnose(usbConfig);
    expect(result.ok).toBe(false);
    expect(stepOf(result, 'state')).toMatchObject({ status: 'error' });
    expect(stepOf(result, 'state')?.detail).toContain('Offline');
    expect(stepOf(result, 'jobs')).toMatchObject({ status: 'warn' });
    expect(stepOf(result, 'jobs')?.detail).toContain('2 trabajo(s)');
    expect(stepOf(result, 'driver')).toMatchObject({ status: 'warn' });
    expect(stepOf(result, 'raw-job')).toMatchObject({ status: 'error' });
    expect(stepOf(result, 'raw-job')?.detail).toContain('no acepta datos RAW');
    expect(stepOf(result, 'raw-job')?.detail).toContain('Win32 1804');
  });

  it('a missing queue lists the queues Windows does have and never sends a job', async () => {
    const { queue: _omit, ...withoutQueue } = healthyInfo;
    windows({ ...withoutQueue, queueError: 'No MSFT_Printer objects found' });
    const result = await svc.diagnose(usbConfig);
    expect(stepOf(result, 'queue')).toMatchObject({ status: 'error' });
    expect(stepOf(result, 'queue')?.hint).toContain(QUEUE);
    expect(mockScripts.some(isRawJob)).toBe(false);
  });

  it('a queue printing to a file, a stopped spooler and a blocked PowerShell are errors', async () => {
    windows({
      ...healthyInfo,
      spooler: 'Stopped',
      languageMode: 'ConstrainedLanguage',
      queue: { ...healthyInfo.queue, port: 'FILE:', portDescription: 'Print to File' },
    });
    const result = await svc.diagnose(usbConfig);
    expect(stepOf(result, 'spooler-service')).toMatchObject({ status: 'error' });
    expect(stepOf(result, 'port')).toMatchObject({ status: 'error' });
    expect(stepOf(result, 'powershell')).toMatchObject({ status: 'error' });
    expect(mockScripts.some(isRawJob)).toBe(false);
  });

  it('a print that times out says so in Spanish — never the encoded command line', async () => {
    windows(healthyInfo, 'TIMEOUT');
    const result = await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    expect(result).toMatchObject({ ok: false, stage: 'timeout' });
    expect(result.error).toContain('no terminó de enviar el ticket');
    expect(result.error).not.toContain('EncodedCommand');
  });

  it('a failed winspool call reports the stage and Win32 code', async () => {
    windows(healthyInfo, 'FSRAW:OpenPrinter:1801');
    const result = await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    expect(result).toMatchObject({ ok: false, stage: 'OpenPrinter', code: '1801' });
    expect(result.error).toContain('la cola de impresión no existe');
  });

  it('all copies go out as ONE spooler job', async () => {
    windows(healthyInfo);
    const result = await svc.handlePrint(
      { ...usbConfig, paper: { copies: 3 } },
      { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] },
    );
    expect(result).toMatchObject({ ok: true, transport: 'spooler' });
    expect(mockScripts.filter(isRawJob)).toHaveLength(1);
  });

  it('the helper is loaded from a cached DLL, not compiled inline on every print', async () => {
    windows(healthyInfo);
    await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    const script = mockScripts.find(isRawJob)!;
    expect(script).toMatch(/FsRawPrinter-[0-9a-f]{10}\.dll/);
    expect(script).toContain('if (Test-Path -LiteralPath $dll)');
    expect(script).toContain('Add-Type -LiteralPath $dll -ErrorAction Stop');
  });
});

describe('USB helper cache (Windows)', () => {
  const realPlatform = process.platform;
  const realLocal = process.env.LOCALAPPDATA;
  const realTemp = process.env.TEMP;
  let localDir: string;
  const { execFile } = jest.requireMock('child_process') as { execFile: jest.Mock };
  const dllIn = (dir: string) => {
    const folder = join(dir, 'SparkleWash', 'printing');
    const name = readdirSync(folder).find((f) => /^FsRawPrinter-[0-9a-f]{10}\.dll$/.test(f));
    return name ? join(folder, name) : null;
  };
  const lastTimeout = () => (execFile.mock.calls[execFile.mock.calls.length - 1][2] as { timeout: number }).timeout;

  beforeAll(() => {
    localDir = mkdtempSync(join(tmpdir(), 'fs-printer-local-'));
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.LOCALAPPDATA = localDir;
    process.env.TEMP = localDir;
  });
  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    process.env.LOCALAPPDATA = realLocal;
    process.env.TEMP = realTemp;
    rmSync(localDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    mockScripts = [];
    execFile.mockClear();
  });

  it('lives in the local, non-roaming %LOCALAPPDATA% — never the roaming userData', async () => {
    windows(healthyInfo);
    await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    const script = mockScripts.find(isRawJob)!;
    expect(script).toContain(join(localDir, 'SparkleWash', 'printing'));
  });

  it('a DLL that fails to load is deleted and the helper compiled in memory for this print', async () => {
    windows(healthyInfo);
    await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    const script = mockScripts.find(isRawJob)!;
    const loadFailure = script.slice(script.indexOf('if (Test-Path -LiteralPath $dll)'));
    expect(loadFailure).toMatch(/catch \{\s*Write-Output \("FSWARN:helper-load:"[^}]*Remove-Item -LiteralPath \$dll/);
    // In-memory fallback (no -OutputAssembly) whenever the type is still missing.
    expect(script).toMatch(/if \(-not \('FsRawPrinter' -as \[type\]\)\) \{ Add-Type -TypeDefinition \$src -ErrorAction Stop \}/);
    // Cache miss: staged under a temporary name, then renamed into place.
    expect(script).toContain("$staged = $dll + '.' + $PID + '.tmp'");
    expect(script).toContain('Move-Item -LiteralPath $staged -Destination $dll');
  });

  it('a truncated cached DLL (power cut) is removed before printing and gets the first-print budget', async () => {
    windows(healthyInfo);
    const folder = join(localDir, 'SparkleWash', 'printing');
    mkdirSync(folder, { recursive: true });
    // Name the cache exactly like the service does: take it from a print script.
    await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    const dllName = /FsRawPrinter-[0-9a-f]{10}\.dll/.exec(mockScripts.find(isRawJob)!)![0];
    const dll = join(folder, dllName);

    writeFileSync(dll, Buffer.alloc(300)); // zero-filled, no "MZ"
    await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    expect(existsSync(dll)).toBe(false);
    expect(lastTimeout()).toBe(60000);

    writeFileSync(dll, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4000)]));
    await svc.handlePrint(usbConfig, { paper: { widthMm: 80 }, blocks: [{ text: 'x' }] });
    expect(dllIn(localDir)).toBe(dll);
    expect(lastTimeout()).toBe(25000);
  });
});

describe('PowerShell quoting and error text', () => {
  it('doubles every single-quote variant PowerShell recognizes', () => {
    expect(svc.psQuote("O'Brien")).toBe("O''Brien");
    expect(svc.psQuote('O\u2019Brien')).toBe('O\u2019\u2019Brien');
    expect(svc.psQuote('\u2018a\u201Ab\u201B')).toBe('\u2018\u2018a\u201A\u201Ab\u201B\u201B');
  });

  it('a temp path with a curly apostrophe stays inside its literal', () => {
    const script: string = svc.rawPrintPs('C:\\Users\\O\u2019Brien\\AppData\\Local\\Temp\\fs-pos-1.bin', 'Recibo Bixolón');
    expect(script).toContain("ReadAllBytes('C:\\Users\\O\u2019\u2019Brien\\AppData\\Local\\Temp\\fs-pos-1.bin')");
    expect(script).toContain("Send('Recibo Bixolón', $bytes)");
  });

  it('every script asks PowerShell for UTF-8 output (accented names, Spanish errors)', () => {
    expect(svc.rawPrintPs('C:\\t.bin', 'Impresora térmica')).toContain('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false');
    expect(svc.windowsQueueInfoPs('Impresora térmica')).toContain('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false');
  });

  it('never shows the -EncodedCommand blob, whatever failed', () => {
    const blob = 'JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAdABvAHAAJwAKAHQAcgB5ACAAewAKAA=='.repeat(4);
    const error = Object.assign(new Error(`Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand ${blob}\n`), { code: 1 });
    const parseFailure = svc.powerShellFailure({ error, stdout: '', stderr: '' });
    expect(parseFailure).toBe('PowerShell terminó con código 1');
    const echoed = svc.powerShellFailure({ error, stdout: '', stderr: `At line:1 char:1 -EncodedCommand ${blob}` });
    expect(echoed).not.toContain(blob.slice(0, 40));
    expect(svc.powerShellFailure({ error: Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }), stdout: '', stderr: '' }))
      .toBe('PowerShell no está disponible en este equipo');
  });
});

describe('queue names', () => {
  const ok = (printerName: string) => svc.validateConfig({ transport: 'spooler', spooler: { printerName } });

  it('accepts the names Windows and CUPS really produce', () => {
    for (const name of [
      'EPSON TM-T20II Receipt5', 'Impresora térmica', 'Recibo Bixolón', 'POS-80C #2', 'XP-58 (copy 1)',
      '\\\\PC-CAJA\\EPSON TM-T20II', 'Canon_G3060_series', 'Caja 1 (redirigida 2)',
    ]) {
      expect({ name, error: ok(name) }).toEqual({ name, error: null });
    }
  });

  it('refuses anything that could break out of a PowerShell literal or an argv slot', () => {
    for (const name of [
      "Epson'; Remove-Item C:\\ -Recurse; '", 'Epson\u2019 + $(calc)', 'a`b', 'a$b', 'a;b', 'a&b', 'a|b', 'a"b',
      '-o raw', 'a\nb', '', ' leading', 'x'.repeat(200), '\\\\srv\\a\\b',
    ]) {
      expect({ name, error: ok(name) }).toEqual({ name, error: 'Nombre de impresora inválido' });
    }
  });
});

describe('CUPS (macOS / Linux)', () => {
  // Captured from `lpstat` on a real Mac (CUPS 2.3).
  const LPSTAT_A = 'Canon_G3060_series accepting requests since Mon Oct  5 15:20:20 2026\n'
    + 'Canon_G3060_series_2 accepting requests since Thu Jul  9 10:59:38 2026\n'
    + 'TM_T20II not accepting requests since Thu Jul  9 10:59:38 2026 -\n\tRejecting Jobs\n';
  const LPSTAT_V = 'device for Canon_G3060_series: dnssd://Canon%20G3060%20series._ipps._tcp.local./?uuid=00000000-0000-1000-8000-0018c3069876\n';
  const LPSTAT_P_DISABLED = 'printer Canon_G3060_series_2 disabled since Thu Jul  9 10:59:38 2026 -\n\tUnable to add document to print job.\n';
  const LPSTAT_P_IDLE = 'printer Canon_G3060_series is idle.  enabled since Mon Oct  5 15:20:20 2026\n';

  it('parses the real lpstat output', () => {
    expect(svc.parseLpstatAccepting(LPSTAT_A)).toEqual(['Canon_G3060_series', 'Canon_G3060_series_2', 'TM_T20II']);
    expect(svc.parseLpstatDevice(LPSTAT_V)).toBe('dnssd://Canon%20G3060%20series._ipps._tcp.local./?uuid=00000000-0000-1000-8000-0018c3069876');
    expect(svc.parseLpstatState(LPSTAT_P_DISABLED)).toEqual({
      line: 'printer Canon_G3060_series_2 disabled since Thu Jul 9 10:59:38 2026 -',
      reasons: ['Unable to add document to print job.'],
      disabled: true,
    });
    expect(svc.parseLpstatState(LPSTAT_P_IDLE).disabled).toBe(false);
    expect(svc.countLpstatJobs('')).toBe(0);
    expect(svc.countLpstatJobs('Canon_G3060_series-42 jorge 1024 Sat Oct 31 19:51:09 2026\n')).toBe(1);
  });

  describe('with lpstat answering like the real one', () => {
    const realPlatform = process.platform;
    beforeAll(() => Object.defineProperty(process, 'platform', { value: 'darwin' }));
    afterAll(() => Object.defineProperty(process, 'platform', { value: realPlatform }));
    beforeEach(() => {
      mockScripts = [];
      mockRespond = (script) => {
        if (script === '-a') return { stdout: LPSTAT_A };
        if (script.startsWith('-v')) return { stdout: LPSTAT_V };
        if (script === '-p Canon_G3060_series_2') return { stdout: LPSTAT_P_DISABLED };
        if (script.startsWith('-p')) return { stdout: LPSTAT_P_IDLE };
        if (script.startsWith('-o')) return { stdout: '', stderr: 'lpstat: notice on stderr is not a job' };
        return { stdout: 'request id is Canon_G3060_series-1 (1 file(s))' }; // lp
      };
    });

    it('lists the queues and finds the configured one (used to read "Canon_G3060_series accepting requests since Mon Oct  5 15")', async () => {
      expect(await svc.listPrinters()).toEqual(['Canon_G3060_series', 'Canon_G3060_series_2', 'TM_T20II']);
      expect(await svc.status({ transport: 'spooler', spooler: { printerName: 'Canon_G3060_series' } }))
        .toEqual({ ok: true, transport: 'spooler' });
    });

    it('diagnose goes past the queue step; stderr is never counted as a job', async () => {
      const result = await svc.diagnose({ transport: 'spooler', spooler: { printerName: 'Canon_G3060_series' } });
      expect(result.steps.map((s: { id: string }) => s.id)).toEqual(['queue', 'port', 'state', 'jobs', 'raw-job']);
      expect(stepOf(result, 'jobs')).toMatchObject({ status: 'ok' });
      expect(stepOf(result, 'port')?.detail).toContain('dnssd://');
      expect(result.ok).toBe(true);
    });

    it('a disabled queue is an error with its reason, and no test job is left sitting in it', async () => {
      const result = await svc.diagnose({ transport: 'spooler', spooler: { printerName: 'Canon_G3060_series_2' } });
      expect(stepOf(result, 'state')).toMatchObject({ status: 'error' });
      expect(stepOf(result, 'state')?.detail).toContain('Unable to add document to print job.');
      expect(stepOf(result, 'raw-job')).toMatchObject({ status: 'skip' });
      expect(mockScripts.some((s) => s.includes('-o raw'))).toBe(false);
    });
  });
});

describe('error text helpers', () => {
  it('turns PowerShell CLIXML stderr into plain text', () => {
    const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">_x001B_[31;1mCannot find printer_x000D__x000A_</S><S S="Error">at line 3_x000D__x000A_</S></Objs>';
    expect(svc.readableStderr(clixml)).toBe('Cannot find printer at line 3');
  });

  it('classifies Windows ports', () => {
    expect(svc.describePort('USB001', 'Virtual printer port for USB').kind).toBe('usb');
    expect(svc.describePort('TMUSB001', '').kind).toBe('usb');
    expect(svc.describePort('COM3', '').kind).toBe('serial');
    expect(svc.describePort('IP_192.168.1.50', 'Standard TCP/IP Port').kind).toBe('network');
    expect(svc.describePort('FILE:', 'Print to File').kind).toBe('file');
  });
});

describe('network diagnostics', () => {
  it('a reachable printer passes; a closed port explains the refusal', async () => {
    // Server-side sockets are destroyed explicitly: under Jest (Node 26) a
    // connection the client already destroyed before it was accepted may
    // never see 'end', and server.close() would wait for it forever.
    const accepted = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      accepted.add(socket);
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const ok = await svc.diagnose({ transport: 'network', network: { host: '127.0.0.1', port, timeoutMs: 1500 } });
      expect(ok.ok).toBe(true);
      expect(stepOf(ok, 'connect')).toMatchObject({ status: 'ok' });
    } finally {
      const closed = new Promise((resolve) => server.close(resolve));
      for (const socket of accepted) socket.destroy();
      await closed;
    }
    const refused = await svc.diagnose({ transport: 'network', network: { host: '127.0.0.1', port, timeoutMs: 1500 } });
    expect(refused.ok).toBe(false);
    expect(stepOf(refused, 'connect')?.hint).toContain('rechazó el puerto');
  });

  it('flags the old example IP and suggests USB', async () => {
    const result = await svc.diagnose({ transport: 'network', network: { host: '192.168.1.100', port: 9100, timeoutMs: 200 } });
    expect(stepOf(result, 'config')).toMatchObject({ status: 'warn' });
    expect(stepOf(result, 'config')?.hint).toContain('USB');
  });
});
