import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const [entry, ...args] = process.argv.slice(2);

if (!entry) {
  console.error('Provide a TypeScript entry file to execute.');
  process.exit(2);
}

const child = spawn(
  process.execPath,
  [
    '-r',
    require.resolve('ts-node/register/transpile-only'),
    '-r',
    require.resolve('tsconfig-paths/register'),
    path.resolve(process.cwd(), entry),
    ...args,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'commonjs' }),
      TS_NODE_TRANSPILE_ONLY: 'true',
      ELECTRON_RUN_AS_NODE: 'true',
    },
    stdio: 'inherit',
  }
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
