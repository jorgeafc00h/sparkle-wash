#!/usr/bin/env node
// verify-packaged-app — fails the build when app.asar is missing something the
// Electron main process loads. The Electron Playwright specs run from source
// (`electron .`), so they cannot see packaging gaps: 1.2.0/1.3.0 shipped
// without electron/thermalPrinterService.cjs and every install crashed at
// startup with "Cannot find module './thermalPrinterService.cjs'".
//
// Usage: node scripts/verify-packaged-app.cjs <path/to/app.asar>
//
// Checks:
//   1. the asar's package.json "main" is present;
//   2. every electron/*.cjs in the repo is present;
//   3. every literal require() in the shipped electron/*.cjs resolves inside
//      the asar — relative files and npm packages (node builtins and
//      'electron' excepted);
//   4. every package reached that way has its own "dependencies" resolvable
//      inside the asar, transitively, with Node's lookup (nearest
//      node_modules first, then each parent) — so a dependency of a
//      dependency that electron-builder failed to collect can't ship.
//      Missing "optionalDependencies" are listed but don't fail the build.
//
// Reads the asar header directly (no @electron/asar dependency) so it behaves
// the same on the Windows and macOS runners.

'use strict';

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const asarPath = process.argv[2];
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error(`::error::app.asar not found: ${asarPath || '(no path given)'}`);
  process.exit(1);
}

// asar layout: [uint32 4][uint32 headerPickleSize][header pickle][file data].
// The header pickle is [uint32 payloadSize][uint32 jsonLength][JSON].
const fd = fs.openSync(asarPath, 'r');
const sizes = Buffer.alloc(8);
fs.readSync(fd, sizes, 0, 8, 0);
const headerPickleSize = sizes.readUInt32LE(4);
const headerPickle = Buffer.alloc(headerPickleSize);
fs.readSync(fd, headerPickle, 0, headerPickleSize, 8);
const header = JSON.parse(headerPickle.toString('utf8', 8, 8 + headerPickle.readUInt32LE(4)));
const dataStart = 8 + headerPickleSize;

const entries = new Map(); // posix path inside the asar → file entry
(function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (child.files) walk(child, p);
    else entries.set(p, child);
  }
})(header, '');

function readText(p) {
  const entry = entries.get(p);
  if (entry.unpacked) return fs.readFileSync(path.join(`${asarPath}.unpacked`, p), 'utf8');
  const buf = Buffer.alloc(entry.size);
  fs.readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset));
  return buf.toString('utf8');
}

const errors = [];
const warnings = [];

// Node's lookup inside the asar: <dir>/node_modules/<name>, then every parent
// directory's node_modules, up to the root node_modules. Returns the package
// directory or null.
function resolvePackage(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    if (path.posix.basename(dir) !== 'node_modules') {
      const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
      if (entries.has(`${candidate}/package.json`)) return candidate;
    }
    if (!dir) return null;
    const parent = path.posix.dirname(dir);
    dir = parent === '.' ? '' : parent;
  }
}

// Walks a package's production dependency tree (each resolved directory once).
const visitedPackages = new Set();
function checkDependencyTree(pkgDir, chain) {
  if (visitedPackages.has(pkgDir)) return;
  visitedPackages.add(pkgDir);
  let manifest;
  try {
    manifest = JSON.parse(readText(`${pkgDir}/package.json`));
  } catch (error) {
    errors.push(`${chain.join(' → ')}: unreadable ${pkgDir}/package.json (${error.message})`);
    return;
  }
  const optional = manifest.optionalDependencies || {};
  for (const dep of Object.keys(manifest.dependencies || {})) {
    const depDir = resolvePackage(pkgDir, dep);
    if (depDir) {
      checkDependencyTree(depDir, [...chain, dep]);
    } else if (dep in optional) {
      warnings.push(`${chain.join(' → ')} → ${dep} (optional) is not in the asar`);
    } else {
      errors.push(`${chain.join(' → ')} → ${dep} is not in the asar (dependency of ${manifest.name || pkgDir})`);
    }
  }
}

const pkg = JSON.parse(readText('package.json'));
if (!entries.has(pkg.main)) errors.push(`package.json main "${pkg.main}" is not in the asar`);

const repoElectronDir = path.join(__dirname, '..', 'electron');
for (const name of fs.readdirSync(repoElectronDir).filter((f) => f.endsWith('.cjs'))) {
  if (!entries.has(`electron/${name}`)) errors.push(`electron/${name} exists in the repo but is not in the asar`);
}

const builtins = new Set(['electron', ...builtinModules]);
const requireRe = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
const shipped = [...entries.keys()].filter((p) => /^electron\/[^/]+\.cjs$/.test(p));
for (const file of shipped) {
  for (const [, , spec] of readText(file).matchAll(requireRe)) {
    if (spec.startsWith('.')) {
      const base = path.posix.join(path.posix.dirname(file), spec);
      const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.js`];
      if (!candidates.some((c) => entries.has(c))) errors.push(`${file}: require('${spec}') → not in the asar`);
    } else if (!spec.startsWith('node:') && !builtins.has(spec.split('/')[0])) {
      const parts = spec.split('/');
      const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const pkgDir = resolvePackage(path.posix.dirname(file), pkgName);
      if (!pkgDir) {
        errors.push(`${file}: require('${spec}') → node_modules/${pkgName} is not in the asar (must be in "dependencies")`);
      } else {
        checkDependencyTree(pkgDir, [file, pkgName]);
      }
    }
  }
}

fs.closeSync(fd);

for (const w of warnings) console.warn(`::warning::${w}`);
if (errors.length) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(`Packaged app is broken: ${errors.length} problem(s) in ${asarPath}`);
  process.exit(1);
}
console.log(`Packaged app OK: ${shipped.length} main-process file(s), their requires and ${visitedPackages.size} production package(s) resolve in ${asarPath}`);
