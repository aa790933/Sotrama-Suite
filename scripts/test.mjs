import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const root = process.cwd();
const skippedDirectories = new Set([
  '.git',
  '.scratch',
  '.yarn',
  'dist_electron',
  'node_modules',
  'sotrama-suite-brand-kit',
]);

function collectSpecFiles(directory, insideTests = false) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...collectSpecFiles(entryPath, insideTests || entry.name === 'tests')
      );
    } else if (
      insideTests &&
      entry.isFile() &&
      entry.name.endsWith('.spec.ts')
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function resolveTestFiles(args) {
  if (args.length === 0) {
    return collectSpecFiles(root).sort();
  }

  const files = [];
  for (const arg of args) {
    const candidate = path.resolve(root, arg);
    if (!existsSync(candidate)) {
      throw new Error(`Test path does not exist: ${arg}`);
    }

    if (statSync(candidate).isDirectory()) {
      files.push(
        ...collectSpecFiles(candidate, path.basename(candidate) === 'tests')
      );
    } else {
      files.push(candidate);
    }
  }

  return [...new Set(files)].sort();
}

let testFiles;
try {
  testFiles = resolveTestFiles(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}

if (testFiles.length === 0) {
  console.error('No .spec.ts test files were found.');
  process.exit(2);
}

const env = {
  ...process.env,
  IS_TEST: 'true',
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'commonjs' }),
  TS_NODE_TRANSPILE_ONLY: 'true',
  ELECTRON_RUN_AS_NODE: 'true',
};

async function runTestFile(testFile) {
  return await new Promise((resolve) => {
    const tape = spawn(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register/transpile-only'),
        '-r',
        require.resolve('tsconfig-paths/register'),
        path.join(root, 'node_modules', 'tape', 'bin', 'tape'),
        testFile,
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] }
    );

    const reporter = spawn(
      process.execPath,
      [path.join(root, 'node_modules', 'tap-spec', 'bin', 'cmd.js')],
      { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] }
    );

    tape.stdout.pipe(reporter.stdin);

    let tapeExitCode = 1;
    let reporterExitCode = 1;
    let tapeFinished = false;
    let reporterFinished = false;
    const finishIfReady = () => {
      if (!tapeFinished || !reporterFinished) return;
      resolve(tapeExitCode === 0 && reporterExitCode === 0 ? 0 : 1);
    };

    tape.on('error', (error) => {
      console.error(error);
      tapeExitCode = 1;
    });
    reporter.on('error', (error) => {
      console.error(error);
      reporterExitCode = 1;
    });
    tape.on('close', (code) => {
      tapeExitCode = code ?? 1;
      tapeFinished = true;
      finishIfReady();
    });
    reporter.on('close', (code) => {
      reporterExitCode = code ?? 1;
      reporterFinished = true;
      finishIfReady();
    });
  });
}

for (const testFile of testFiles) {
  console.log(`\nRunning ${path.relative(root, testFile)}`);
  const exitCode = await runTestFile(testFile);
  if (exitCode !== 0) process.exitCode = 1;
}
