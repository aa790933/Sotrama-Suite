import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export function resolveRustUtilityExecutable() {
  const binary = process.platform === 'win32' ? 'sotrama-backend.exe' : 'sotrama-backend';
  const candidates = [
    process.env.SOTRAMA_BACKEND_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, binary) : undefined,
    path.resolve(moduleDirectory, '../../rust-backend/target/release', binary),
    path.resolve(moduleDirectory, '../../rust-backend/target/debug', binary),
    path.resolve(process.cwd(), 'rust-backend/target/release', binary),
    path.resolve(process.cwd(), 'rust-backend/target/debug', binary),
  ];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new Error(`Rust utility executable not found for ${process.platform}`);
  }
  return executable;
}

export function safeUtilityEnvironment(source) {
  const allowed = process.platform === 'win32'
    ? ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
    : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export function runRustUtility(args, timeoutMs = 5000, dependencies = {}) {
  const executable = dependencies.executable ?? resolveRustUtilityExecutable();
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  return new Promise((resolve, reject) => {
    let settled = false;
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderr = '';
    const child = spawnProcess(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Do not leak database credentials, API tokens or unrelated parent env.
      env: safeUtilityEnvironment(process.env),
    });
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Rust utility timed out after ${timeoutMs} milliseconds`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes + chunk.length > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('Rust utility output exceeded the 16 MiB limit'));
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2048);
    });
    child.once('error', (error) => {
      finish(new Error(`Rust utility failed: ${error.message}`));
    });
    child.once('close', (status) => {
      if (status !== 0) {
        finish(new Error(stderr.trim() || `Rust utility exited with code ${status}`));
        return;
      }
      finish(null, Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'));
    });
  });
}

export function parseRustUtilityJson(output, label) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error(`Rust utility returned malformed JSON for ${label}`);
  }
  return value;
}
