import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['.git', '.yarn', 'node_modules', 'dist', 'release', 'target', 'coverage', 'build']);
const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.rs', ]);

function category(relative) {
  const file = relative.replaceAll('\\', '/');
  if (/^(backend\/.*(?:\.spec\.ts|\/tests\/)|.*\.spec\.ts$|.*\.test\.ts$)/.test(file)) return 'tests';
  if (/^backend\/patches\//.test(file) || /(^|\/)(migrations?|fixtures?)\//i.test(file)) return 'migrations-fixtures';
  if (/^backend\//.test(file)) return 'backend-implementation';
  if (/^rust-backend\/src\//.test(file)) return 'rust-backend-implementation';
  if (/^rust-backend\/tests\//.test(file)) return 'rust-integration-tests';
  if (/^main\//.test(file)) return 'electron-host';
  if (/^renderer\//.test(file) || /^(components|pages|views|styles)\//.test(file) || file.endsWith('.vue')) return 'renderer';
  if (/^fyo\//.test(file) || /^schemas\//.test(file) || /^utils\//.test(file)) return 'shared-business-and-contracts';
  if (/^(scripts|build)\//.test(file) || /(^|\/)(vite|webpack|electron-builder)[^/]*\.(mjs|js|ts)$/.test(file)) return 'tooling';
  return 'other-source';
}

async function walk(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excluded.has(entry.name)) continue;
    const rel = path.posix.join(relative, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute, rel));
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) result.push({ relative: rel, absolute });
  }
  return result;
}

const tracked = new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll('\\', '/')));
const files = (await walk(root)).filter(({ relative }) => tracked.has(relative.replaceAll('\\', '/')));
const totals = new Map();
for (const file of files) {
  const contents = await readFile(file.absolute, 'utf8');
  const lines = contents.length === 0 ? 0 : contents.split(/\r?\n/).length - (contents.endsWith('\n') ? 1 : 0);
  const group = category(file.relative);
  const current = totals.get(group) ?? { files: 0, lines: 0 };
  current.files += 1;
  current.lines += lines;
  totals.set(group, current);
}

console.log('Source baseline (tracked plus non-ignored untracked source; excludes generated/build/vendor directories)');
console.log('category\tfiles\tlines');
for (const [name, value] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${name}\t${value.files}\t${value.lines}`);
}
const legacy = files.filter(({ relative }) => relative.replaceAll('\\', '/') === 'backend/database/core.ts');
if (legacy.length) {
  const source = await readFile(legacy[0].absolute, 'utf8');
  const lines = source.length === 0 ? 0 : source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  console.log(`legacy_database_core\t1\t${lines}`);
}
