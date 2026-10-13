import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist_electron', 'bundled');
const expected = process.platform === 'win32' ? 'sotrama-backend.exe' : 'sotrama-backend';

if (!fs.existsSync(root)) {
  throw new Error(`Electron package output was not found: ${root}`);
}

const matches = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name === expected &&
      fullPath.split(path.sep).some((part) => part.toLowerCase() === 'resources')
    ) {
      matches.push(fullPath);
    }
  }
}

visit(root);
if (matches.length === 0) {
  throw new Error(
    `Packaged Electron output does not contain ${expected} under a Resources directory.`
  );
}

console.log(`Verified packaged Rust backend (${expected}):\n${matches.join('\n')}`);
