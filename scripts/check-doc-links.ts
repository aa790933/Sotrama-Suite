import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(root, 'docs');
const publicRoot = path.join(docsRoot, 'public');
const markdownFiles: string[] = [];
const errors: string[] = [];

function capture(match: RegExpExecArray, group = 1): string {
  const value: unknown = match[group];
  return typeof value === 'string' ? value : '';
}

function walk(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.md')) markdownFiles.push(fullPath);
  }
}

function targetExists(target: string, sourceFile: string): boolean {
  const clean = decodeURIComponent(target.split(/[?#]/, 1)[0] ?? '');
  if (!clean || clean.startsWith('data:')) return true;

  if (clean.startsWith('/')) {
    const relative = clean.replace(/^\/+/, '');
    const docsCandidates = [
      path.resolve(docsRoot, `${relative}.md`),
      path.resolve(docsRoot, relative, 'index.md'),
    ];
    const publicCandidate = path.resolve(publicRoot, relative);
    const inside = (candidate: string, directory: string): boolean =>
      candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
    const candidates = [
      ...docsCandidates.filter((candidate: string) => inside(candidate, docsRoot)),
      ...(inside(publicCandidate, publicRoot) ? [publicCandidate] : []),
    ];
  return candidates.some((candidate: string) => fs.existsSync(candidate));
  }

  const resolved = path.resolve(path.dirname(sourceFile), clean);
  if (!resolved.startsWith(`${docsRoot}${path.sep}`)) return false;
  return [resolved, `${resolved}.md`, path.join(resolved, 'index.md')].some((candidate: string) =>
    candidate.startsWith(`${docsRoot}${path.sep}`) && fs.existsSync(candidate)
  );
}

walk(docsRoot);
for (const sourceFile of markdownFiles) {
  const source = fs.readFileSync(sourceFile, 'utf8');
  const references = [
    ...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g),
    ...source.matchAll(/(?:href|src)=["']([^"']+)["']/g),
  ];

  for (const match of references) {
    const target = capture(match).trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|tel:|#|\/\/)/i.test(target)) continue;
    if (!targetExists(target, sourceFile)) {
      const relative = path.relative(root, sourceFile).replaceAll(path.sep, '/');
      errors.push(`${relative}: missing target ${target}`);
    }
  }
}

// VitePress navigation lives outside Markdown, so validate its local routes too.
const configFile = path.join(docsRoot, '.vitepress', 'config.mts');
const configSource = fs.readFileSync(configFile, 'utf8');
const builtOutput = process.argv.includes('--built');
const configuredReferences = [
  ...configSource.matchAll(/\b(?:link|logo|src):\s*['"]([^'"]+)['"]/g),
];
for (const match of configuredReferences) {
  const target = capture(match).trim();
  if (/^(?:https?:|mailto:|tel:|#|\/\/)/i.test(target)) continue;
  if (!targetExists(target, configFile)) {
    errors.push(`docs/.vitepress/config.mts: missing configured target ${target}`);
  }
}

if (builtOutput) {
  const distRoot = path.join(docsRoot, '.vitepress', 'dist');
  const baseMatch = configSource.match(/\bbase:\s*['"]([^'"]+)['"]/i);
  const base = baseMatch ? capture(baseMatch) : undefined;
  if (!fs.existsSync(distRoot) || !base) {
    errors.push('built output check requires docs/.vitepress/dist and a configured VitePress base');
  } else {
    const normalizedBase = base === '/'
      ? '/'
      : `/${base.split('/').filter(Boolean).join('/')}/`;
    const htmlFiles: string[] = [];
    const cssFiles: string[] = [];
    const walkBuilt = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walkBuilt(fullPath);
        else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(fullPath);
        else if (entry.isFile() && entry.name.endsWith('.css')) cssFiles.push(fullPath);
      }
    };
    const insideDist = (candidate: string): boolean =>
      candidate === distRoot || candidate.startsWith(`${distRoot}${path.sep}`);
    const builtTargetExists = (target: string, sourceFile: string): boolean => {
      const clean = decodeURIComponent(target.split(/[?#]/, 1)[0] ?? '');
      if (!clean || /^(?:data:|javascript:|mailto:|tel:|#|\/\/)/i.test(clean)) return true;
      if (/^[a-z][a-z\d+.-]*:/i.test(clean)) return true;

      let candidate;
      if (clean.startsWith('/')) {
        if (!clean.startsWith(normalizedBase)) return false;
        candidate = path.resolve(distRoot, clean.slice(normalizedBase.length));
      } else {
        candidate = path.resolve(path.dirname(sourceFile), clean);
      }
      if (!insideDist(candidate)) return false;

      const candidates = [candidate];
      if (!path.extname(candidate)) {
        candidates.push(`${candidate}.html`, path.join(candidate, 'index.html'));
      }
      if (clean.endsWith('/')) candidates.push(path.join(candidate, 'index.html'));
      return candidates.some((item: string) => insideDist(item) && fs.existsSync(item) && fs.statSync(item).isFile());
    };

    walkBuilt(distRoot);
    for (const sourceFile of htmlFiles) {
      const source = fs.readFileSync(sourceFile, 'utf8');
      for (const match of source.matchAll(/\b(?:href|src|poster)=["']([^"']+)["']/gi)) {
        const target = capture(match).trim();
        if (!builtTargetExists(target, sourceFile)) {
          errors.push(`${path.relative(distRoot, sourceFile).replaceAll(path.sep, '/')}: broken built reference ${target}`);
        }
      }
      for (const match of source.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
        for (const candidate of capture(match).split(',').map((part) => part.trim().split(/\s+/)[0] ?? '')) {
          if (candidate && !builtTargetExists(candidate, sourceFile)) {
            errors.push(`${path.relative(distRoot, sourceFile).replaceAll(path.sep, '/')}: broken srcset reference ${candidate}`);
          }
        }
      }
    }
    for (const sourceFile of cssFiles) {
      const source = fs.readFileSync(sourceFile, 'utf8');
      for (const match of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        const target = capture(match, 2).trim();
        if (target && !builtTargetExists(target, sourceFile)) {
          errors.push(`${path.relative(distRoot, sourceFile).replaceAll(path.sep, '/')}: broken CSS asset ${target}`);
        }
      }
    }
    if (!htmlFiles.length) errors.push('built output contains no HTML pages');
    else console.log(`Built output: inspected ${htmlFiles.length} HTML pages and ${cssFiles.length} CSS files using base ${normalizedBase}`);
  }
}

if (errors.length) {
  console.error(`Documentation link check failed (${errors.length} issue(s)):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Documentation link check passed (${markdownFiles.length} Markdown files, ${configuredReferences.length} VitePress config references inspected).`
  );
}
