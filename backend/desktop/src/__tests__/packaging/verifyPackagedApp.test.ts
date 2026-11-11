// scripts/verify-packaged-app.cjs gates every CI release on app.asar holding
// what the main process loads. It used to check only the packages required
// directly by electron/*.cjs; a dependency of one of those packages that
// electron-builder failed to collect (1.3.1's packageManager/pnpm detour fell
// back to manual traversal) would still ship and crash at require time.
// Fake asars are built here in the real format the script parses.

import { spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-packaged-app.cjs');

type Tree = { files: Record<string, Tree | { size: number; offset: string }> };

function buildAsar(files: Record<string, string>): Buffer {
  const header: Tree = { files: {} };
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [p, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const parts = p.split('/');
    let node = header;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] = node.files[dir] ?? { files: {} };
      node = node.files[dir] as Tree;
    }
    node.files[parts[parts.length - 1]] = { size: data.length, offset: String(offset) };
    offset += data.length;
    chunks.push(data);
  }
  const json = Buffer.from(JSON.stringify(header));
  const pad = (4 - (json.length % 4)) % 4;
  const pickle = Buffer.alloc(8 + json.length + pad);
  pickle.writeUInt32LE(4 + json.length + pad, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(pickle.length, 4);
  return Buffer.concat([sizes, pickle, ...chunks]);
}

const pkg = (name: string, deps: Record<string, string> = {}, optional: Record<string, string> = {}) =>
  JSON.stringify({ name, version: '1.0.0', dependencies: { ...deps, ...optional }, optionalDependencies: optional });

/** Every repo electron/*.cjs present; main.cjs requires one npm package. */
function appFiles(extra: Record<string, string>): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'app', main: 'electron/main.cjs' }),
  };
  for (const name of readdirSync(join(ROOT, 'electron')).filter((f) => f.endsWith('.cjs'))) {
    files[`electron/${name}`] = name === 'main.cjs' ? "const s = require('imap-simple'); const p = require('path');" : '';
  }
  return { ...files, ...extra };
}

function verify(files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fs-asar-'));
  const asar = join(dir, 'app.asar');
  writeFileSync(asar, buildAsar(files));
  try {
    const run = spawnSync(process.execPath, [SCRIPT, asar], { encoding: 'utf8' });
    return { code: run.status ?? -1, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('verify-packaged-app', () => {
  it('passes when the whole production tree resolves (nested node_modules included)', () => {
    const result = verify(appFiles({
      'node_modules/imap-simple/package.json': pkg('imap-simple', { imap: '^0.8', 'iconv-lite': '~0.4' }),
      'node_modules/imap-simple/node_modules/iconv-lite/package.json': pkg('iconv-lite', { 'safer-buffer': '^2' }),
      'node_modules/safer-buffer/package.json': pkg('safer-buffer'),
      'node_modules/imap/package.json': pkg('imap', { readable: '^1' }),
      'node_modules/readable/package.json': pkg('readable'),
    }));
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('Packaged app OK');
    expect(result.out).toMatch(/5 production package\(s\)/);
  });

  it('fails when a dependency of a required package is missing, naming the chain', () => {
    const result = verify(appFiles({
      'node_modules/imap-simple/package.json': pkg('imap-simple', { imap: '^0.8' }),
      'node_modules/imap/package.json': pkg('imap', { readable: '^1' }),
      // "readable" was not collected.
    }));
    expect(result.code).toBe(1);
    expect(result.out).toContain('electron/main.cjs → imap-simple → imap → readable is not in the asar');
  });

  it('a dependency nested under a sibling package is not visible and fails', () => {
    const result = verify(appFiles({
      'node_modules/imap-simple/package.json': pkg('imap-simple', { imap: '^0.8', 'iconv-lite': '~0.4' }),
      'node_modules/imap/package.json': pkg('imap'),
      'node_modules/imap/node_modules/iconv-lite/package.json': pkg('iconv-lite'),
    }));
    expect(result.code).toBe(1);
    expect(result.out).toContain('imap-simple → iconv-lite is not in the asar');
  });

  it('a missing optional dependency is a warning, not a failure', () => {
    const result = verify(appFiles({
      'node_modules/imap-simple/package.json': pkg('imap-simple', {}, { 'utf-8-validate': '^5' }),
    }));
    expect(result.code).toBe(0);
    expect(result.out).toContain('::warning::electron/main.cjs → imap-simple → utf-8-validate (optional) is not in the asar');
  });

  it('still fails when a directly required package is missing', () => {
    const result = verify(appFiles({}));
    expect(result.code).toBe(1);
    expect(result.out).toContain("require('imap-simple') → node_modules/imap-simple is not in the asar");
  });
});
