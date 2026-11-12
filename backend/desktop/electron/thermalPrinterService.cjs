// thermalPrinterService — Electron main-process ESC/POS printing.
//
// The renderer sends a pure ReceiptPayload (with pre-rendered blocks — the
// TS layout engine in src/services/printing/ReceiptDocument.ts is the single
// source of layout truth). This module maps blocks → ESC/POS bytes and owns
// the transports:
//   • network : raw TCP 9100 (Epson TM-T20II Ethernet, any ESC/POS printer)
//   • spooler : OS print queue raw job — a cached winspool helper driven by
//               PowerShell (win32, requires the Epson driver installed once)
//               or `lp -o raw` (macOS/Linux CUPS).
//
// No native modules: node-thermal-printer is used ONLY as a pure-JS ESC/POS
// byte builder (we never call execute()). Byte delivery is ours.

'use strict';

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { ThermalPrinter } = require('node-thermal-printer');

// ── Validation / hardening ─────────────────────────────────────────────────

// Queue names as Windows / CUPS really produce them: accented or other
// Unicode letters ("Impresora térmica", "Recibo Bixolón"), digits, spaces,
// "-_.#()" ("POS-80C #2", "XP-58 (copy 1)") and the shared-printer form
// "\\server\queue". Same pattern as src/services/printing/printerQueues.ts
// (PRINTER_NAME_PATTERN) — keep both in sync; a Jest test compares them.
// Injection safety: a name only ever reaches a PowerShell single-quoted
// literal (psQuote) or an execFile argv entry for lp/lpstat (no shell); it
// cannot start with "-" (no option injection) and quotes, "$", "`", ";",
// "&", "|", "<", ">" and control characters are all outside this set.
const PRINTER_NAME_RE = /^(?:\\\\[\p{L}\p{N}._-]{1,63}\\)?[\p{L}\p{N}_.#()][\p{L}\p{M}\p{N} _.#()-]{0,159}$/u;
const MAX_BLOCKS = 400;
const MAX_TEXT_LEN = 200;
const MAX_COPIES = 3;

function fail(message) {
  return { ok: false, error: message };
}

function sanitizeText(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .slice(0, MAX_TEXT_LEN);
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') return 'config inválida';
  if (config.transport === 'network') {
    const host = config.network?.host;
    const port = Number(config.network?.port);
    if (typeof host !== 'string' || !/^[A-Za-z0-9.\-]{1,63}$/.test(host)) {
      return 'Host de impresora inválido';
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return 'Puerto de impresora inválido';
    }
    return null;
  }
  if (config.transport === 'spooler') {
    const name = config.spooler?.printerName;
    if (typeof name !== 'string' || !PRINTER_NAME_RE.test(name)) {
      return 'Nombre de impresora inválido';
    }
    return null;
  }
  return 'Transporte desconocido';
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'payload inválido';
  if (!Array.isArray(payload.blocks) || payload.blocks.length === 0) return 'recibo sin bloques';
  if (payload.blocks.length > MAX_BLOCKS) return `recibo demasiado largo (>${MAX_BLOCKS} líneas)`;
  for (const block of payload.blocks) {
    if (!block || typeof block.text !== 'string') return 'bloque inválido';
    if (block.text.length > MAX_TEXT_LEN) return 'línea de recibo demasiado larga';
    if (block.align && !['left', 'center', 'right'].includes(block.align)) return 'alineación inválida';
  }
  return null;
}

// ── ESC/POS byte builder ───────────────────────────────────────────────────

// Characters WPC1252 holds beyond ASCII and Latin-1 (0x80–0x9F block).
const WPC1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const TRANSLITERATIONS = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '↑': '^', '↓': 'v',
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '∞': 'inf', '√': 'raiz',
  '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '-', '′': "'", '″': '"',
  'Ω': 'Ohm', 'µ': 'u', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '★': '*', '☆': '*',
};

function isWpc1252(char) {
  const code = char.codePointAt(0);
  return char === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WPC1252_EXTRA.has(char);
}

/**
 * Keep every character inside WPC1252. node-thermal-printer switches the
 * printer's code page mid-receipt for anything else (→, Ω, ≥, emoji…) and
 * never switches back, garbling the rest of the receipt — so transliterate
 * (accent-stripping as a fallback) and print "?" for what has no equivalent.
 */
function toWpc1252(text) {
  let out = '';
  for (const char of text) {
    if (isWpc1252(char)) { out += char; continue; }
    if (TRANSLITERATIONS[char]) { out += TRANSLITERATIONS[char]; continue; }
    const stripped = char.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += stripped && [...stripped].every(isWpc1252) ? stripped : '?';
  }
  return out;
}

function buildBuffer(payload) {
  const widthMm = payload.paper?.widthMm === 58 ? 58 : 80;
  const cols = widthMm === 80 ? 48 : 32;

  const printer = new ThermalPrinter({
    type: 'epson',
    interface: 'file',
    width: cols,
    characterSet: 'WPC1252',
    removeCL: true,
  });

  for (const block of payload.blocks) {
    if (block.align === 'center') printer.alignCenter();
    else if (block.align === 'right') printer.alignRight();
    else printer.alignLeft();

    if (block.bold) printer.bold(true);
    if (block.doubleHeight) printer.setTextDoubleHeight(true);

    printer.println(toWpc1252(sanitizeText(block.text)));

    if (block.doubleHeight) printer.setTextDoubleHeight(false);
    if (block.bold) printer.bold(false);
  }

  printer.newLine();
  // Partial cut (GS V 1) as the spec's TM-T20II profile says; cut(true) was a
  // FULL cut (the library's cut() takes an options object, not a flag).
  if (payload.cut !== false) printer.partialCut();
  // Drawer pulse only for a sale receipt the renderer flagged (cash + setting
  // on) — never for reprints, test pages or Z reports.
  if (payload.cashDrawerKick === true && payload.kind === 'TICKET') printer.openCashDrawer();

  const body = printer.getBuffer();
  // Deterministic printer state before the body: ESC @ reset, then WPC1252
  // (ESC t 16) so Spanish accents survive on Epson/compatible printers.
  const header = Buffer.from([0x1b, 0x40, 0x1b, 0x74, 16]);
  return Buffer.concat([header, body]);
}

// ── Transport: network (raw TCP 9100) ──────────────────────────────────────

function sendToNetwork(host, port, buffer, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs || 4000);
    socket.once('timeout', () =>
      finish(Object.assign(new Error(`Impresora ${host}:${port} no respondió (timeout)`), { code: 'TIMEOUT' })));
    socket.once('error', (err) =>
      finish(Object.assign(new Error(`No se pudo conectar a ${host}:${port} — ${err.message}`), { code: err.code })));
    socket.connect(port, host, () => {
      socket.write(buffer, (err) => finish(err ?? undefined));
    });
  });
}

async function printNetwork(config, buffer) {
  const { host, port, timeoutMs } = config.network;
  try {
    await sendToNetwork(host, port, buffer, timeoutMs);
  } catch (firstError) {
    // Single retry — receipt printers are frequently asleep/paused mid-job.
    await new Promise((r) => setTimeout(r, 400));
    await sendToNetwork(host, port, buffer, timeoutMs);
  }
  return { ok: true, transport: 'network' };
}

// ── Transport: OS spooler (raw job, no native modules) ─────────────────────
//
// Windows: a small C# helper (winspool.drv) sends the bytes as a RAW job. It
// is compiled ONCE into a cached DLL — compiling it with Add-Type on every
// print took 5–20 s on slow POS PCs (csc + antivirus scanning the build) and
// tripped the timeout. It reports which winspool call failed and the Win32
// error, so "no imprime" becomes "el driver no acepta RAW (1804)".

const RAW_HELPER_CS = String.raw`
using System;
using System.Runtime.InteropServices;
public class FsRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  // Wide (Unicode) entry point: queue names may hold letters outside the ANSI
  // code page ("Recibo Bixolón" is fine in CP1252, other scripts are not).
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  // "OK" or "<winspool call>:<Win32 error>".
  public static string Send(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) return "OpenPrinter:" + Marshal.GetLastWin32Error();
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "Car Spa POS Receipt";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) return "StartDocPrinter:" + Marshal.GetLastWin32Error();
      try {
        if (!StartPagePrinter(hPrinter)) return "StartPagePrinter:" + Marshal.GetLastWin32Error();
        IntPtr pBytes = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, pBytes, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, pBytes, bytes.Length, out written)) return "WritePrinter:" + Marshal.GetLastWin32Error();
          if (written != bytes.Length) return "WritePrinter:incompleto";
        } finally {
          Marshal.FreeCoTaskMem(pBytes);
        }
        EndPagePrinter(hPrinter);
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
    return "OK";
  }
}
`;

const RAW_HELPER_VERSION = require('crypto').createHash('sha1').update(RAW_HELPER_CS).digest('hex').slice(0, 10);

// Where the compiled helper is cached. A LOCAL, non-roaming folder on
// purpose: Electron's userData is %APPDATA% (Roaming), which roaming profiles
// sync and Folder Redirection can move to a network share — .NET refuses to
// load an assembly from a network path, so USB printing broke for good.
// %LOCALAPPDATA% is never roamed nor redirected, and unlike %TEMP% it is not
// emptied by Storage Sense / Disk Cleanup (which would force the slow
// first-print compile again).
function helperDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'SparkleWash', 'printing');
  }
  return path.join(os.tmpdir(), 'sparklewash-printing');
}

function helperDllPath() {
  return path.join(helperDir(), `FsRawPrinter-${RAW_HELPER_VERSION}.dll`);
}

// Checks the cached DLL before handing it to PowerShell: a file truncated or
// zero-filled by a power cut mid-write is deleted here so this print rebuilds
// it (with the first-print time budget). 'ok' | 'missing' | 'unreadable'
// (locked by an antivirus, permissions… — PowerShell falls back to compiling
// in memory).
const MIN_HELPER_DLL_BYTES = 1024;
async function checkCachedHelper(dll) {
  let handle;
  try {
    handle = await fs.promises.open(dll, 'r');
    const { size } = await handle.stat();
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    if (size >= MIN_HELPER_DLL_BYTES && head.toString('latin1') === 'MZ') return 'ok';
  } catch (error) {
    return error?.code === 'ENOENT' ? 'missing' : 'unreadable';
  } finally {
    await handle?.close().catch(() => {});
  }
  await fs.promises.rm(dll, { force: true }).catch(() => {});
  return 'missing';
}

// PowerShell treats U+2018/2019/201A/201B like "'" inside a single-quoted
// literal, so each variant is doubled — a Windows user named O’Brien has a
// temp path that used to end the literal and break every USB print.
const psQuote = (value) => String(value).replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q);

// PowerShell 5.1 writes redirected output in the OEM code page (850/437):
// accented queue names and Spanish error messages arrived garbled. Allowed to
// fail (constrained language mode blocks it; that case is reported anyway).
const PS_UTF8_OUTPUT = "try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }";

// Loads the cached helper. On a cache miss it is compiled once to a
// per-process folder, copied next to the cache under a temporary name and
// renamed into place (same-volume rename: the cache is either absent or a
// complete DLL, even with concurrent prints). A cached DLL that fails to load
// (truncated, locked, bad image) is deleted and the helper is compiled in
// memory for this print, so a bad cache never breaks USB printing for good.
function rawHelperLoadPs() {
  const dll = helperDllPath();
  return `
$dll = '${psQuote(dll)}'
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Write-Output "FSRAW:LanguageMode:$($ExecutionContext.SessionState.LanguageMode)"
  exit 3
}
if (-not ('FsRawPrinter' -as [type])) {
  $src = @'
${RAW_HELPER_CS}
'@
  if (Test-Path -LiteralPath $dll) {
    try {
      Add-Type -LiteralPath $dll -ErrorAction Stop
    } catch {
      Write-Output ("FSWARN:helper-load:" + $_.Exception.Message)
      Remove-Item -LiteralPath $dll -Force -ErrorAction SilentlyContinue
    }
  } else {
    $buildDir = Join-Path (Split-Path -Parent $dll) ("build-" + $PID)
    try {
      New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
      $built = Join-Path $buildDir (Split-Path -Leaf $dll)
      Add-Type -TypeDefinition $src -OutputAssembly $built -OutputType Library -ErrorAction Stop
      $staged = $dll + '.' + $PID + '.tmp'
      Copy-Item -LiteralPath $built -Destination $staged -Force -ErrorAction Stop
      try { Move-Item -LiteralPath $staged -Destination $dll -ErrorAction Stop } catch { Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue }
      if (-not ('FsRawPrinter' -as [type])) { Add-Type -LiteralPath $dll -ErrorAction Stop }
    } catch {
      Write-Output ("FSWARN:helper-build:" + $_.Exception.Message)
    } finally {
      Remove-Item -LiteralPath $buildDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not ('FsRawPrinter' -as [type])) { Add-Type -TypeDefinition $src -ErrorAction Stop }
}
`;
}

// Errors are caught and printed as one "FSERR:" line: with -EncodedCommand
// and redirected streams PowerShell writes uncaught errors as CLIXML.
function rawPrintPs(file, queue) {
  return `
${PS_UTF8_OUTPUT}
$ErrorActionPreference = 'Stop'
try {
${rawHelperLoadPs()}
  $bytes = [System.IO.File]::ReadAllBytes('${psQuote(file)}')
  $result = [FsRawPrinter]::Send('${psQuote(queue)}', $bytes)
} catch {
  Write-Output ("FSERR:" + $_.Exception.Message)
  exit 4
}
Write-Output "FSRAW:$result"
if ($result -ne 'OK') { exit 2 }
exit 0
`;
}

// Never let the -EncodedCommand payload (a huge base64 blob that execFile
// puts in error.message, and PowerShell may echo) reach the user.
function redactEncodedCommand(text) {
  return String(text)
    .replace(/-EncodedCommand\s+\S+/gi, '-EncodedCommand …')
    .replace(/[A-Za-z0-9+/=]{80,}/g, '…');
}

// Fallback for anything that still escapes as CLIXML ("#< CLIXML <Objs…>").
function readableStderr(stderr) {
  if (!stderr.startsWith('#< CLIXML')) return redactEncodedCommand(stderr).trim().slice(0, 300);
  return redactEncodedCommand([...stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)]
    .map((m) => m[1])
    .join('')
    .replace(/_x001B_\[[0-9;]*m/g, '')
    .replace(/_x000D_|_x000A_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
    .slice(0, 300);
}

// What went wrong in a PowerShell run, in a line a user can read. Never built
// from error.message: for a failed execFile that is "Command failed:
// powershell.exe … -EncodedCommand JAB…".
function powerShellFailure(run) {
  const thrown = /FSERR:(.+)/.exec(run.stdout)?.[1]?.trim();
  if (thrown) return redactEncodedCommand(thrown).slice(0, 300);
  const stderr = readableStderr(run.stderr ?? '');
  if (stderr) return stderr;
  const code = run.error?.code;
  if (code === 'ENOENT') return 'PowerShell no está disponible en este equipo';
  if (typeof code === 'number') return `PowerShell terminó con código ${code}`;
  if (typeof code === 'string' && code) return `PowerShell no se pudo ejecutar (${code})`;
  return 'error desconocido';
}

// Win32 errors a raw receipt job actually hits, in plain Spanish.
const WIN32_ERRORS = {
  5: 'acceso denegado a la cola de impresión',
  21: 'el dispositivo no está listo (¿impresora apagada o desconectada?)',
  1722: 'el servicio de cola de impresión de Windows (Spooler) no responde',
  1801: 'la cola de impresión no existe en este equipo',
  1804: 'el driver no acepta datos RAW — instala el driver del fabricante (Epson APD) o "Generic / Text Only"; los drivers v4 o de clase no sirven para tickets',
  1905: 'la cola de impresión fue eliminada',
};

const STAGE_LABELS = {
  OpenPrinter: 'abrir la cola',
  StartDocPrinter: 'iniciar el trabajo RAW',
  StartPagePrinter: 'iniciar la página',
  WritePrinter: 'enviar los datos',
  LanguageMode: 'cargar el componente de impresión',
};

function describeRawFailure(queue, marker) {
  const [stage, code] = marker.split(':');
  if (stage === 'LanguageMode') {
    return {
      error: `Windows bloquea el componente de impresión (PowerShell en modo ${code}); una política de seguridad (AppLocker/WDAC) impide imprimir por USB. Usa la conexión de red o pide a TI que lo permita.`,
      stage,
      code,
    };
  }
  const numeric = Number(code);
  const reason = WIN32_ERRORS[numeric] ?? (Number.isFinite(numeric) ? `error de Windows ${numeric}` : code);
  return {
    error: `Cola «${queue}»: no se pudo ${STAGE_LABELS[stage] ?? stage} — ${reason}${Number.isFinite(numeric) ? ` (Win32 ${numeric})` : ''}.`,
    stage,
    code,
  };
}

class SpoolerError extends Error {
  constructor(details) {
    super(details.error);
    this.stage = details.stage;
    this.code = details.code;
  }
}

function runEncodedPowerShell(script, timeoutMs) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const startedAt = Date.now();
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          error,
          // A killed process never reports why; never surface the (huge)
          // encoded command line as the "reason".
          timedOut: !!error && (error.killed || error.signal === 'SIGTERM'),
          // UTF-8 (PS_UTF8_OUTPUT); drop a BOM if this PowerShell emits one.
          stdout: (stdout?.toString() ?? '').replace(/^\uFEFF/, ''),
          stderr: (stderr?.toString() ?? '').replace(/^\uFEFF/, '').trim().slice(0, 4000),
          ms: Date.now() - startedAt,
        });
      },
    );
  });
}

function runLp(queue, file, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('lp', ['-d', queue, '-o', 'raw', file], { timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      if (error.killed) {
        return reject(new SpoolerError({
          error: `Cola «${queue}»: CUPS no aceptó el trabajo en ${Math.round(timeoutMs / 1000)} s.`,
          stage: 'timeout',
        }));
      }
      reject(new SpoolerError({
        error: `Cola «${queue}»: ${stderr?.toString().trim().slice(0, 300) || error.message}`,
        stage: 'lp',
      }));
    });
  });
}

const SPOOLER_PRINT_TIMEOUT_MS = 25000;
// The first print on a PC also compiles the helper (csc is slow on POS PCs).
const SPOOLER_FIRST_PRINT_TIMEOUT_MS = 60000;

async function sendRawToSpooler(queue, buffer) {
  const tempFile = path.join(os.tmpdir(), `fs-pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`);
  await fs.promises.writeFile(tempFile, buffer, { mode: 0o600 });
  try {
    if (process.platform !== 'win32') {
      await runLp(queue, tempFile, SPOOLER_PRINT_TIMEOUT_MS);
      return;
    }
    await fs.promises.mkdir(helperDir(), { recursive: true });
    const cached = await checkCachedHelper(helperDllPath());
    const timeoutMs = cached === 'ok' ? SPOOLER_PRINT_TIMEOUT_MS : SPOOLER_FIRST_PRINT_TIMEOUT_MS;
    const run = await runEncodedPowerShell(rawPrintPs(tempFile, queue), timeoutMs);
    const helperWarning = /FSWARN:(\S+?):(.*)/.exec(run.stdout);
    if (helperWarning) {
      // The cache was rebuilt in memory for this print; the next print
      // recompiles it to disk. Logged, never shown as a failure.
      console.warn(`[thermalPrinter] ${helperWarning[1]}: ${redactEncodedCommand(helperWarning[2]).trim().slice(0, 300)}`);
    }
    const marker = /FSRAW:(\S+)/.exec(run.stdout)?.[1];
    if (run.timedOut) {
      throw new SpoolerError({
        error: `Cola «${queue}»: Windows no terminó de enviar el ticket en ${Math.round(timeoutMs / 1000)} s. Revisa que la impresora esté encendida y que la cola no tenga trabajos atascados (usa «Diagnosticar»).`,
        stage: 'timeout',
      });
    }
    if (marker && marker !== 'OK') throw new SpoolerError(describeRawFailure(queue, marker));
    if (run.error) {
      throw new SpoolerError({
        error: `Cola «${queue}»: el componente de impresión falló — ${powerShellFailure(run)}`,
        stage: 'powershell',
      });
    }
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch(() => {});
  }
}

async function printSpooler(config, buffer) {
  await sendRawToSpooler(config.spooler.printerName, buffer);
  return { ok: true, transport: 'spooler' };
}

// ── Printer enumeration (OS queries, no natives) ───────────────────────────

// `lpstat -a` prints one line per destination, the queue name first and
// whitespace-separated (CUPS names cannot contain spaces), in any locale:
//   "Canon_G3060_series accepting requests since Mon Oct  5 15:20:20 2026"
//   "TM_T20II not accepting requests since … -" + an indented reason line.
function parseLpstatAccepting(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .filter((line) => line && !/^\s/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

const WINDOWS_LIST_QUEUES_PS = `
${PS_UTF8_OUTPUT}
$ErrorActionPreference = 'Stop'
try { Get-Printer | Select-Object -ExpandProperty Name } catch { Write-Output ("FSERR:" + $_.Exception.Message); exit 4 }
`;

function queryQueues() {
  if (process.platform === 'win32') {
    return runEncodedPowerShell(WINDOWS_LIST_QUEUES_PS, 15000).then((run) => {
      if (run.timedOut) return { queues: [], error: 'Windows no respondió al listar las impresoras (15 s)' };
      if (run.error) return { queues: [], error: powerShellFailure(run) };
      return { queues: run.stdout.split(/\r?\n/).map((q) => q.trim()).filter(Boolean) };
    });
  }
  return new Promise((resolve) => {
    execFile('lpstat', ['-a'], { timeout: 15000 }, (error, stdout) => {
      // lpstat exits non-zero (with an stderr notice) when there are no queues.
      const queues = parseLpstatAccepting(stdout?.toString());
      resolve(error && queues.length === 0 && error.killed
        ? { queues: [], error: 'CUPS no respondió al listar las impresoras (15 s)' }
        : { queues });
    });
  });
}

async function listPrinters() {
  return (await queryQueues()).queues;
}

async function status(config) {
  const invalid = validateConfig(config);
  if (invalid) return fail(invalid);
  if (config.transport === 'network') {
    try {
      await sendToNetwork(config.network.host, config.network.port, Buffer.from([0x1b, 0x40]), 1500);
      return { ok: true, transport: 'network' };
    } catch (error) {
      return fail(error.message);
    }
  }
  const { queues, error } = await queryQueues();
  if (queues.includes(config.spooler.printerName)) {
    return { ok: true, transport: 'spooler' };
  }
  if (error) return fail(`No se pudo consultar las colas de impresión: ${error}`);
  return fail(`La cola "${config.spooler.printerName}" no existe en este equipo`);
}

// ── Diagnostics (Settings → Impresora de tickets → Diagnosticar) ───────────
//
// Step-by-step checks so the screen can say WHERE a ticket stops: wrong
// connection type, missing queue, offline/paused printer, stuck jobs, a
// driver that rejects RAW, a blocked PowerShell, an unreachable IP… Each
// step: { id, label, status: ok|warn|error|skip, detail, hint?, ms? }.

const EXAMPLE_HOSTS = new Set(['192.168.1.100']);
const INIT_ONLY = Buffer.from([0x1b, 0x40]); // ESC @ — resets, prints nothing

const step = (id, label, statusValue, detail, hint, ms) => ({ id, label, status: statusValue, detail, hint, ms });

const NETWORK_HINTS = {
  TIMEOUT: 'Nadie respondió en esa IP. Revisa la IP (en la Epson TM-T20II: apágala, mantén presionado FEED y enciéndela para imprimir su configuración de red) y que este equipo y la impresora estén en la misma red. Si la impresora está conectada por cable USB, cambia «Conexión» a USB.',
  ECONNREFUSED: 'Ese equipo existe pero rechazó el puerto. Revisa el puerto (9100) o que la IP sea de la impresora y no de otro equipo.',
  EHOSTUNREACH: 'No hay ruta hacia esa IP: la impresora está en otra red o subred que este equipo.',
  ENETUNREACH: 'Este equipo no tiene red hacia esa IP (¿sin conexión o en otra subred?).',
  ENOTFOUND: 'Ese nombre de equipo no existe en la red; usa la IP de la impresora.',
};

async function diagnoseNetwork(config) {
  const steps = [];
  const { host, port, timeoutMs } = config.network;
  if (EXAMPLE_HOSTS.has(host)) {
    steps.push(step('config', 'Configuración', 'warn', `La IP ${host} es la de ejemplo.`,
      'Escribe la IP real de tu impresora, o cambia «Conexión» a USB si está conectada por cable USB.'));
  } else {
    steps.push(step('config', 'Configuración', 'ok', `Red: ${host}:${port}`));
  }
  const startedAt = Date.now();
  try {
    await sendToNetwork(host, port, INIT_ONLY, timeoutMs || 4000);
    steps.push(step('connect', 'Conexión a la impresora', 'ok', `${host}:${port} respondió.`, undefined, Date.now() - startedAt));
  } catch (error) {
    steps.push(step('connect', 'Conexión a la impresora', 'error', error.message,
      NETWORK_HINTS[error.code] ?? 'Revisa que la impresora esté encendida y conectada a la red.', Date.now() - startedAt));
  }
  return steps;
}

function windowsQueueInfoPs(queue) {
  return `
${PS_UTF8_OUTPUT}
$ErrorActionPreference = 'Continue'
trap { Write-Output ("FSERR:" + $_.Exception.Message); exit 4 }
$name = '${psQuote(queue)}'
$r = [ordered]@{}
$r.languageMode = "$($ExecutionContext.SessionState.LanguageMode)"
try { $r.spooler = "$((Get-Service -Name Spooler -ErrorAction Stop).Status)" } catch { $r.spooler = 'Unknown' }
try { $r.queues = @(Get-Printer -ErrorAction Stop | Select-Object -ExpandProperty Name) } catch { $r.queues = @(); $r.queuesError = $_.Exception.Message }
try {
  $p = Get-Printer -Name $name -ErrorAction Stop
  $q = [ordered]@{ driver = $p.DriverName; port = $p.PortName; status = "$($p.PrinterStatus)"; jobs = [int]$p.JobCount }
  try { $w = Get-CimInstance -ClassName Win32_Printer -Filter ("Name='" + $name.Replace('\\', '\\\\').Replace("'", "\\'") + "'") -ErrorAction Stop; $q.workOffline = [bool]$w.WorkOffline } catch { }
  try { $q.driverVersion = [int](Get-PrinterDriver -Name $p.DriverName -ErrorAction Stop).MajorVersion } catch { }
  try { $q.portDescription = "$((Get-PrinterPort -Name $p.PortName -ErrorAction Stop).Description)" } catch { }
  try { $q.jobStates = @(Get-PrintJob -PrinterName $name -ErrorAction Stop | ForEach-Object { "$($_.JobStatus)" }) } catch { }
  $r.queue = $q
} catch { $r.queueError = $_.Exception.Message }
$r | ConvertTo-Json -Depth 4 -Compress
`;
}

const BAD_PRINTER_STATES = /Offline|Error|PaperJam|PaperOut|PaperProblem|DoorOpen|NotAvailable|UserInterventionRequired|NoToner|OutOfMemory|ServerUnknown/i;

function describePort(port, description) {
  const value = `${port ?? ''} ${description ?? ''}`;
  if (/^(USB|TMUSB|ESDPRT|EPUSB)/i.test(port ?? '') || /USB/i.test(description ?? '')) return { kind: 'usb', label: `USB (${port})` };
  if (/^COM\d+/i.test(port ?? '')) return { kind: 'serial', label: `puerto serie ${port}` };
  if (/^(IP_|\d+\.\d+\.\d+\.\d+)/i.test(port ?? '') || /TCP|WSD/i.test(value)) return { kind: 'network', label: `red (${port})` };
  if (/^(FILE|PORTPROMPT|NUL|PDF)/i.test(port ?? '')) return { kind: 'file', label: `archivo (${port})` };
  return { kind: 'other', label: port || 'desconocido' };
}

async function diagnoseWindowsSpooler(queue) {
  const steps = [];
  const run = await runEncodedPowerShell(windowsQueueInfoPs(queue), 20000);
  if (run.timedOut || run.error) {
    steps.push(step('system', 'Consulta a Windows', 'error',
      run.timedOut ? 'Windows no respondió a la consulta de impresoras en 20 s.' : `PowerShell falló: ${powerShellFailure(run)}`,
      'Reinicia el servicio «Cola de impresión» (services.msc → Print Spooler) o el equipo e intenta de nuevo.', run.ms));
    return steps;
  }
  let info;
  try {
    info = JSON.parse(run.stdout.trim().split(/\r?\n/).pop());
  } catch {
    steps.push(step('system', 'Consulta a Windows', 'error', 'Respuesta inesperada de PowerShell.', undefined, run.ms));
    return steps;
  }

  if (info.spooler === 'Running') {
    steps.push(step('spooler-service', 'Servicio de cola de impresión', 'ok', 'Print Spooler en ejecución.'));
  } else if (info.spooler === 'Unknown') {
    steps.push(step('spooler-service', 'Servicio de cola de impresión', 'warn', 'No se pudo consultar el servicio Print Spooler.'));
  } else {
    steps.push(step('spooler-service', 'Servicio de cola de impresión', 'error', `Print Spooler: ${info.spooler}.`,
      'Inícialo en services.msc → «Cola de impresión» (Print Spooler) y configúralo como automático.'));
  }

  const queues = Array.isArray(info.queues) ? info.queues : [];
  if (!info.queue) {
    steps.push(step('queue', 'Cola de impresión', 'error', `La cola «${queue}» no existe en este equipo.`,
      queues.length
        ? `Colas disponibles: ${queues.join(', ')}. Elige la de tu impresora de tickets.`
        : 'Windows no tiene colas de impresión: instala el driver de la impresora (Epson Advanced Printer Driver para la TM-T20II) con el cable USB conectado.'));
    return steps;
  }
  const q = info.queue;
  steps.push(step('queue', 'Cola de impresión', 'ok', `«${queue}» — driver ${q.driver}.`));

  const portInfo = describePort(q.port, q.portDescription);
  steps.push(portInfo.kind === 'usb'
    ? step('port', 'Puerto', 'ok', `Conectada por ${portInfo.label}.`)
    : step('port', 'Puerto', portInfo.kind === 'file' ? 'error' : 'warn', `La cola usa ${portInfo.label}.`,
      portInfo.kind === 'network'
        ? 'Esta cola imprime por red: también puedes usar «Conexión: Red» con la IP de la impresora.'
        : portInfo.kind === 'file'
          ? 'La cola imprime a un archivo, no a la impresora: en Propiedades de la impresora → Puertos elige el puerto USB (USB001…).'
          : 'Si la impresora está por USB, en Propiedades de la impresora → Puertos elige el puerto USB (USB001…).'));

  const jobStates = Array.isArray(q.jobStates) ? q.jobStates : [];
  const stuck = Number(q.jobs) || jobStates.length;
  if (q.workOffline || BAD_PRINTER_STATES.test(q.status ?? '')) {
    steps.push(step('state', 'Estado de la impresora', 'error',
      q.workOffline ? 'Windows tiene la impresora marcada «Usar impresora sin conexión».' : `Windows reporta la impresora: ${q.status}.`,
      'Enciéndela, revisa el cable USB y el papel, y desmarca «Usar impresora sin conexión» en la cola de Windows.'));
  } else if (/Paused/i.test(q.status ?? '')) {
    steps.push(step('state', 'Estado de la impresora', 'error', 'La cola está en pausa.',
      'Abre la cola en Windows (Configuración → Impresoras) y desmarca «Pausar impresión».'));
  } else {
    steps.push(step('state', 'Estado de la impresora', 'ok', `Windows reporta: ${q.status || 'Normal'}.`));
  }
  steps.push(stuck > 0
    ? step('jobs', 'Trabajos en cola', 'warn', `${stuck} trabajo(s) esperando${jobStates.length ? ` (${jobStates.join(', ')})` : ''}.`,
      'Un trabajo atascado bloquea los siguientes: cancélalos en la cola de Windows y vuelve a probar.')
    : step('jobs', 'Trabajos en cola', 'ok', 'Sin trabajos pendientes.'));

  if (q.driverVersion === 4) {
    steps.push(step('driver', 'Driver', 'warn', `«${q.driver}» es un driver v4.`,
      'Los drivers v4 suelen rechazar datos RAW (ESC/POS). Instala el driver del fabricante (Epson APD) o usa «Generic / Text Only».'));
  } else if (q.driverVersion) {
    steps.push(step('driver', 'Driver', 'ok', `«${q.driver}» (v${q.driverVersion}).`));
  }

  if (info.languageMode !== 'FullLanguage') {
    steps.push(step('powershell', 'Componente de impresión', 'error', `PowerShell está en modo ${info.languageMode}.`,
      'Una política de seguridad (AppLocker/WDAC) bloquea la impresión por USB. Usa la conexión de red o pide a TI que permita PowerShell.'));
    return steps;
  }

  // Decisive check: a RAW job with ESC @ (prints nothing) through the same
  // path a ticket uses — catches drivers that reject RAW and stuck spoolers.
  const startedAt = Date.now();
  try {
    await sendRawToSpooler(queue, INIT_ONLY);
    steps.push(step('raw-job', 'Envío de prueba (sin imprimir)', 'ok', 'Windows aceptó un trabajo RAW.', undefined, Date.now() - startedAt));
  } catch (error) {
    steps.push(step('raw-job', 'Envío de prueba (sin imprimir)', 'error', error.message, undefined, Date.now() - startedAt));
  }
  return steps;
}

// stdout and stderr apart: lpstat reports problems ("Invalid destination
// name…") on stderr, which must never be counted as a job or read as state.
function runLpstat(args) {
  return new Promise((resolve) => {
    execFile('lpstat', args, { timeout: 10000 }, (error, stdout, stderr) =>
      resolve({ error, out: (stdout?.toString() ?? '').trim(), err: (stderr?.toString() ?? '').trim() }));
  });
}

// `lpstat -v <queue>` → "device for Canon_G3060_series: dnssd://Canon%20…/?uuid=…"
// (localized prefix; the URI is always the last token after ": ").
function parseLpstatDevice(stdout) {
  const line = String(stdout ?? '').split(/\r?\n/).find((l) => /:\s+\S+\s*$/.test(l)) ?? '';
  return /:\s+(\S+)\s*$/.exec(line)?.[1] ?? '';
}

// `lpstat -p <queue>` → "printer X is idle.  enabled since …", or
// "printer X disabled since … -" followed by indented reason lines.
function parseLpstatState(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((l) => l.trim());
  const reasons = lines.slice(1).filter((l) => /^\s/.test(l)).map((l) => l.trim());
  return {
    line: lines[0]?.replace(/\s+/g, ' ').trim() ?? '',
    reasons,
    disabled: /\bdisabled\b|deshabilitad|desactivad/i.test(lines[0] ?? ''),
  };
}

// `lpstat -o <queue>` → one line per pending job ("Canon_G3060_series-42 jorge 1024 …").
function countLpstatJobs(stdout) {
  return String(stdout ?? '').split(/\r?\n/).filter((l) => l.trim() && !/^\s/.test(l)).length;
}

async function diagnoseCupsSpooler(queue) {
  const steps = [];
  const { queues } = await queryQueues();
  if (!queues.includes(queue)) {
    steps.push(step('queue', 'Cola de impresión', 'error', `La cola «${queue}» no existe en este equipo.`,
      queues.length ? `Colas disponibles: ${queues.join(', ')}.` : 'No hay impresoras instaladas: agrégala en Ajustes del Sistema → Impresoras.'));
    return steps;
  }
  steps.push(step('queue', 'Cola de impresión', 'ok', `«${queue}» instalada.`));

  const device = await runLpstat(['-v', queue]);
  const uri = parseLpstatDevice(device.out);
  steps.push(step('port', 'Puerto', uri.startsWith('usb:') ? 'ok' : 'warn', uri ? `Dispositivo: ${uri}` : 'Sin dispositivo.',
    uri.startsWith('usb:') ? undefined : 'Si la impresora está por USB, vuelve a agregarla con el cable conectado.'));

  const state = parseLpstatState((await runLpstat(['-p', queue])).out);
  const stateDetail = [state.line, ...state.reasons].filter(Boolean).join(' — ');
  steps.push(step('state', 'Estado de la impresora', state.disabled ? 'error' : 'ok', stateDetail || 'Sin estado.',
    state.disabled ? 'Reanuda la impresora en Ajustes del Sistema → Impresoras (o `cupsenable`).' : undefined));

  const jobs = await runLpstat(['-o', queue]);
  const count = countLpstatJobs(jobs.out);
  steps.push(count > 0
    ? step('jobs', 'Trabajos en cola', 'warn', `${count} trabajo(s) esperando.`, 'Cancela los trabajos atascados y vuelve a probar.')
    : step('jobs', 'Trabajos en cola', 'ok', 'Sin trabajos pendientes.'));

  // A disabled CUPS queue still accepts jobs and holds them: the test job
  // would sit there and come out whenever the printer is resumed.
  if (state.disabled) {
    steps.push(step('raw-job', 'Envío de prueba (sin imprimir)', 'skip', 'No se envió: la impresora está deshabilitada.'));
    return steps;
  }

  const startedAt = Date.now();
  try {
    await sendRawToSpooler(queue, INIT_ONLY);
    steps.push(step('raw-job', 'Envío de prueba (sin imprimir)', 'ok', 'CUPS aceptó un trabajo RAW.', undefined, Date.now() - startedAt));
  } catch (error) {
    steps.push(step('raw-job', 'Envío de prueba (sin imprimir)', 'error', error.message, undefined, Date.now() - startedAt));
  }
  return steps;
}

async function diagnose(config) {
  const startedAt = Date.now();
  const invalid = validateConfig(config);
  const steps = invalid
    ? [step('config', 'Configuración', 'error', invalid)]
    : config.transport === 'network'
      ? await diagnoseNetwork(config)
      : process.platform === 'win32'
        ? await diagnoseWindowsSpooler(config.spooler.printerName)
        : await diagnoseCupsSpooler(config.spooler.printerName);
  return {
    ok: steps.every((s) => s.status !== 'error'),
    transport: config?.transport,
    platform: process.platform,
    steps,
    ms: Date.now() - startedAt,
  };
}

// ── Entry points (IPC handlers) ────────────────────────────────────────────

async function handlePrint(config, payload) {
  const invalidConfig = validateConfig(config);
  if (invalidConfig) return fail(invalidConfig);
  const invalidPayload = validatePayload(payload);
  if (invalidPayload) return fail(invalidPayload);

  const buffer = buildBuffer(payload);
  const copies = Math.min(MAX_COPIES, Math.max(1, Number(payload.copies) || Number(config.paper?.copies) || 1));
  // The drawer opens once, with the first copy.
  const extraCopy = copies > 1 && payload.cashDrawerKick ? buildBuffer({ ...payload, cashDrawerKick: false }) : buffer;
  const copyBuffers = Array.from({ length: copies }, (_, i) => (i === 0 ? buffer : extraCopy));

  try {
    if (config.transport === 'spooler') {
      // One job for every copy: one PowerShell/lp run instead of N.
      return await printSpooler(config, Buffer.concat(copyBuffers));
    }
    let lastResult = null;
    for (const copyBuffer of copyBuffers) {
      lastResult = await printNetwork(config, copyBuffer);
    }
    return lastResult;
  } catch (error) {
    return {
      ...fail(error instanceof Error ? error.message : String(error)),
      stage: error?.stage,
      code: error?.code,
    };
  }
}

module.exports = {
  handlePrint,
  listPrinters,
  status,
  diagnose,
  describeRawFailure, // exposed for unit tests
  describePort,
  readableStderr,
  powerShellFailure,
  psQuote,
  rawPrintPs,
  windowsQueueInfoPs,
  parseLpstatAccepting,
  parseLpstatDevice,
  parseLpstatState,
  countLpstatJobs,
  PRINTER_NAME_RE,
  buildBuffer, // exposed for the virtual-printer integration tests
  validateConfig,
  validatePayload,
};
