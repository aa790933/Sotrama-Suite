import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(root, 'docs');
const publicRoot = path.join(docsRoot, '.vitepress', 'public');
const markdownFiles = [];
const errors = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.md')) markdownFiles.push(fullPath);
  }
}

function targetExists(target, sourceFile) {
  const clean = decodeURIComponent(target.split(/[?#]/, 1)[0]);
  if (!clean || clean.startsWith('data:')) return true;

  if (clean.startsWith('/')) {
    const relative = clean.replace(/^\/+/, '');
    const docsCandidates = [
      path.resolve(docsRoot, `${relative}.md`),
      path.resolve(docsRoot, relative, 'index.md'),
    ];
    const publicCandidate = path.resolve(publicRoot, relative);
    const inside = (candidate, directory) =>
      candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
    const candidates = [
      ...docsCandidates.filter((candidate) => inside(candidate, docsRoot)),
      ...(inside(publicCandidate, publicRoot) ? [publicCandidate] : []),
    ];
    return candidates.some((candidate) => fs.existsSync(candidate));
  }

  const resolved = path.resolve(path.dirname(sourceFile), clean);
  return resolved.startsWith(`${docsRoot}${path.sep}`) && fs.existsSync(resolved);
}

walk(docsRoot);
for (const sourceFile of markdownFiles) {
  const source = fs.readFileSync(sourceFile, 'utf8');
  const references = [
    ...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g),
    ...source.matchAll(/(?:href|src)=["']([^"']+)["']/g),
  ];

  for (const match of references) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|tel:|#|\/\/)/i.test(target)) continue;
    if (!targetExists(target, sourceFile)) {
      const relative = path.relative(root, sourceFile).replaceAll(path.sep, '/');
      errors.push(`${relative}: missing target ${target}`);
    }
  }
}

if (errors.length) {
  console.error(`Documentation link check failed (${errors.length} issue(s)):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation link check passed (${markdownFiles.length} Markdown files).`);
}
