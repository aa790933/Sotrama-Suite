import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyPath = path.join(root, 'backend', 'patches', 'index.ts');
const rustPath = path.join(root, 'rust-backend', 'src', 'database', 'patches.rs');
const legacySource = fs.readFileSync(legacyPath, 'utf8');
const rustSource = fs.readFileSync(rustPath, 'utf8');

const imports = new Map(
  [...legacySource.matchAll(/import\s+(\w+)\s+from\s+'([^']+)'/g)]
    .map((match) => [match[1], path.resolve(path.dirname(legacyPath), `${match[2]}.ts`)])
);
const legacy = [...legacySource.matchAll(/\{[^{}]*\}/g)]
  .map(([entry]) => {
    const name = entry.match(/\bname:\s*'([^']+)'/)?.[1];
    const version = entry.match(/\bversion:\s*'([^']+)'/)?.[1];
    const moduleName = entry.match(/\bpatch:\s*(\w+)/)?.[1];
    if (!name || !version || !moduleName) return null;
    const modulePath = imports.get(moduleName);
    if (!modulePath || !fs.existsSync(modulePath)) {
      throw new Error(`Cannot resolve TypeScript patch module ${moduleName} (${name}).`);
    }
    const source = fs.readFileSync(modulePath, 'utf8');
    return {
      name,
      version,
      priority: Number(entry.match(/\bpriority:\s*(-?\d+)/)?.[1] ?? 0),
      beforeMigrate: /beforeMigrate\s*:\s*true/.test(source),
    };
  }).filter(Boolean);
const rust = [...rustSource.matchAll(/Patch\s*\{\s*name:\s*"([^"]+)"\s*,\s*version:\s*"([^"]+)"\s*,\s*before_migrate:\s*(true|false)\s*,\s*priority:\s*(-?\d+)\s*,\s*\}/g)]
  .map((match) => ({
    name: match[1],
    version: match[2],
    beforeMigrate: match[3] === 'true',
    priority: Number(match[4]),
  }));

const same = legacy.length === rust.length && legacy.every((patch, index) =>
  patch.name === rust[index]?.name &&
  patch.version === rust[index]?.version &&
  patch.priority === rust[index]?.priority &&
  patch.beforeMigrate === rust[index]?.beforeMigrate
);
const missingExecutors = legacy.filter(({ name }) =>
  !new RegExp(`"${name}"\\s*=>`).test(rustSource)
).map(({ name }) => name);

if (!same || missingExecutors.length || legacy.length === 0) {
  console.error('Rust migration registry or executor mapping differs from the TypeScript registry.');
  console.error('TypeScript:', JSON.stringify(legacy, null, 2));
  console.error('Rust:', JSON.stringify(rust, null, 2));
  if (missingExecutors.length) console.error('Missing Rust executor arms:', missingExecutors.join(', '));
  process.exitCode = 1;
} else {
  console.log(`Rust migration registry matches TypeScript for ${legacy.length} ordered patches (name, target version, phase, priority, executor).`);
}
