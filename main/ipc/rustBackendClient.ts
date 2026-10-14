import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import type { MariaDBConfig } from '../../utils/mariadb-types';
import type { BackendResponse } from '../../utils/ipc/types';

type RpcReply = { jsonrpc: '2.0'; id: number; result: unknown };
type PendingRequest = {
  resolve: (response: BackendResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};
type SpawnBackend = (executable: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcessWithoutNullStreams;

export interface RustBackendClientOptions {
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxPendingRequests?: number;
  baseEnv?: NodeJS.ProcessEnv;
  spawnBackend?: SpawnBackend;
  resolveExecutable?: () => string;
  backupDir?: string;
  log?: (message: string) => void;
}

export function resolveRustBackendExecutable(): string {
  const binary = process.platform === 'win32' ? 'sotrama-backend.exe' : 'sotrama-backend';
  const candidates = [
    process.env.SOTRAMA_BACKEND_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, binary) : undefined,
    path.resolve(__dirname, '../../rust-backend/target/release', binary),
    path.resolve(__dirname, '../../rust-backend/target/debug', binary),
    path.resolve(process.cwd(), 'rust-backend/target/release', binary),
    path.resolve(process.cwd(), 'rust-backend/target/debug', binary),
  ].filter((candidate): candidate is string => !!candidate);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(`Rust backend executable not found. Build it for ${process.platform} or set SOTRAMA_BACKEND_PATH.`);
  }
  return executable;
}

/** Owns exactly one sidecar process and correlates every JSON-RPC request. */
export class RustBackendClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: ReadlineInterface | null = null;
  private readonly closedChildren = new WeakSet<ChildProcessWithoutNullStreams>();
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connecting = false;
  private readonly requestTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly spawnBackend: SpawnBackend;
  private readonly resolveExecutable: () => string;
  private readonly backupDir?: string;
  private readonly log: (message: string) => void;

  constructor(options: RustBackendClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2_000;
    this.maxPendingRequests = options.maxPendingRequests ?? 256;
    if (!Number.isSafeInteger(this.maxPendingRequests) || this.maxPendingRequests < 1) {
      throw new Error('maxPendingRequests must be a positive safe integer.');
    }
    this.baseEnv = options.baseEnv ?? process.env;
    this.spawnBackend = options.spawnBackend ?? (spawn as SpawnBackend);
    this.resolveExecutable = options.resolveExecutable ?? resolveRustBackendExecutable;
    this.backupDir = options.backupDir;
    this.log = options.log ?? ((message) => console.error(`[rust-backend] ${message}`));
  }

  async connect(config: MariaDBConfig, countryCode = '', createDatabase = false): Promise<string> {
    if (this.connecting) {
      throw new Error('Rust backend connection is already starting.');
    }
    validateDatabaseConfig(config);
    if (typeof countryCode !== 'string' || countryCode.length > 32) {
      throw new Error('Country code must be a string of at most 32 characters.');
    }
    if (typeof createDatabase !== 'boolean') {
      throw new Error('createDatabase must be a boolean.');
    }
    this.connecting = true;
    try {
      await this.stop();
      const executable = this.resolveExecutable();
      const env = createBackendEnvironment(this.baseEnv, {
        SOTRAMA_DB_HOST: config.host,
        SOTRAMA_DB_PORT: String(config.port),
        SOTRAMA_DB_USER: config.user,
        SOTRAMA_DB_PASSWORD: config.password,
        SOTRAMA_DB_NAME: config.database,
        SOTRAMA_COUNTRY_CODE: countryCode || '-',
        ...(this.backupDir ? { SOTRAMA_BACKUP_DIR: this.backupDir } : {}),
        ...(createDatabase ? { SOTRAMA_CREATE_DATABASE: 'true' } : {}),
      });

      const child = this.spawnBackend(executable, ['--serve'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      this.child = child;
      const lines = createInterface({ input: child.stdout });
      this.lines = lines;
      lines.on('line', (line) => {
        if (Buffer.byteLength(line, 'utf8') > 16 * 1024 * 1024) {
          this.failProtocol('Rust backend response exceeded the 16 MiB protocol limit.');
          return;
        }
        this.onLine(line);
      });
      let stderrTail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        // Keep a bounded diagnostic tail for startup/connection failures, but
        // never echo the configured database password into logs or errors.
        const rawMessage = chunk.toString();
        const message = (config.password
          ? rawMessage.split(config.password).join('[REDACTED]')
          : rawMessage).trim();
        if (!message) return;
        stderrTail = `${stderrTail}${message}\n`.slice(-8192);
        this.log(message.slice(-4096));
      });
      child.on('error', (error) => this.failAll(error));
      child.on('close', (code, signal) => {
        this.closedChildren.add(child);
        const diagnostics = stderrTail.trim();
        this.failAll(new Error(
          `Rust backend exited (code=${code}, signal=${signal ?? 'none'}).${diagnostics ? ` Backend diagnostics: ${diagnostics}` : ''}`
        ));
        lines.close();
        if (this.lines === lines) this.lines = null;
        if (this.child === child) this.child = null;
      });

      try {
        const response = await this.request<{ countryCode: string }>('db.connect');
        if (response.error) throw this.toError(response.error);
        if (typeof response.data?.countryCode !== 'string') {
          throw new Error('Rust backend returned an invalid db.connect response.');
        }
        return response.data.countryCode;
      } catch (error) {
        await this.stop();
        throw error;
      }
    } finally {
      this.connecting = false;
    }
  }

  async request<T = unknown>(method: string, params: unknown[] = []): Promise<BackendResponse & { data?: T }> {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new Error('Rust backend is not running. Connect to a database first.');
    }
    if (this.pending.size >= this.maxPendingRequests) {
      throw new Error(`Rust backend request limit reached (${this.maxPendingRequests}).`);
    }
    if (typeof method !== 'string' || method.length === 0 || method.length > 128 || !Array.isArray(params)) {
      throw new Error('Invalid Rust backend request.');
    }
    const id = this.nextId++;
    let encoded: string;
    try {
      encoded = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    } catch {
      throw new Error('Rust backend request parameters must be JSON-serializable.');
    }
    if (Buffer.byteLength(encoded, 'utf8') > 16 * 1024 * 1024) {
      throw new Error('Rust backend request exceeded the 16 MiB protocol limit.');
    }
    return await new Promise<BackendResponse & { data?: T }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Rust backend request timed out: ${method}`));
        child.kill();
        this.failAll(new Error(`Rust backend stopped after a timed-out request: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (response: BackendResponse) => void, reject, timeout });
      child.stdin.write(`${encoded}\n`, 'utf8', (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(error);
        }
        // A broken pipe means this sidecar can no longer reliably consume the
        // protocol stream. Fail all concurrent callers instead of leaving
        // their requests waiting until independent timeouts expire.
        this.failAll(error);
        if (this.child === child) child.kill();
      });
    });
  }

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const response = await this.request<T>('db.call', [method, ...args]);
    if (response.error) throw this.toError(response.error);
    return response.data as T;
  }

  async schema<T = unknown>(): Promise<T> {
    const response = await this.request<T>('db.schema');
    if (response.error) throw this.toError(response.error);
    return response.data as T;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    let exited = this.closedChildren.has(child);
    try {
      if (child.stdin.writable) child.stdin.end();
      exited = await this.waitForExit(child, this.shutdownTimeoutMs);
      if (!exited) {
        child.kill();
        // Do not report a successful stop merely because kill was requested:
        // wait for OS process closure. If the OS does not reap it, preserve
        // ownership and report failure rather than orphaning a live process.
        exited = await this.waitForExit(child, this.shutdownTimeoutMs);
      }
      if (!exited) throw new Error('Rust backend did not exit after graceful shutdown and termination request.');
    } finally {
      if (exited || this.closedChildren.has(child)) {
        if (this.child === child) this.child = null;
        this.lines?.close();
        this.lines = null;
      }
      this.failAll(new Error('Rust backend stopped.'));
    }
  }

  private async waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (this.closedChildren.has(child)) return true;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (didExit: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('close', onClose);
        resolve(didExit);
      };
      const onClose = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once('close', onClose);
      // Close can race listener registration if the process exits between the
      // initial status check and installing the listener.
      if (this.closedChildren.has(child)) finish(true);
    });
  }

  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.failProtocol('Rust backend emitted malformed JSON on stdout.');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.failProtocol('Rust backend emitted a non-object JSON-RPC response.');
      return;
    }
    const reply = parsed as RpcReply;
    if (reply.jsonrpc !== '2.0' || !Number.isInteger(reply.id)) {
      this.failProtocol('Rust backend emitted an invalid JSON-RPC response.');
      return;
    }
    const pending = this.pending.get(reply.id);
    if (!pending) {
      this.failProtocol('Rust backend emitted a response for an unknown request id.');
      return;
    }
    if (!isBackendResponse(reply.result)) {
      this.failProtocol('Rust backend returned an invalid BackendResponse envelope.');
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(reply.id);
    pending.resolve(reply.result);
  }

  private failProtocol(message: string): void {
    this.log(message);
    this.failAll(new Error(message));
    this.child?.kill();
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private toError(error: NonNullable<BackendResponse['error']>): Error {
    const result = new Error(error.message);
    result.name = error.name;
    Object.assign(result, { code: error.code });
    return result;
  }
}

function validateDatabaseConfig(config: MariaDBConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Database configuration is required.');
  }
  if (typeof config.host !== 'string' || config.host.trim().length === 0 || config.host.length > 255) {
    throw new Error('Database host must be a non-empty string of at most 255 characters.');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('Database port must be an integer between 1 and 65535.');
  }
  if (typeof config.user !== 'string' || config.user.trim().length === 0 || config.user.length > 128) {
    throw new Error('Database user must be a non-empty string of at most 128 characters.');
  }
  if (typeof config.password !== 'string' || config.password.length > 4096) {
    throw new Error('Database password must be a string of at most 4096 characters.');
  }
  if (typeof config.database !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(config.database)) {
    throw new Error('Database name must match [a-zA-Z0-9_-] and be at most 64 characters.');
  }
}

function isBackendResponse(value: unknown): value is BackendResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const response = value as Record<string, unknown>;
  const hasData = Object.prototype.hasOwnProperty.call(response, 'data');
  const hasError = Object.prototype.hasOwnProperty.call(response, 'error');
  if (hasData === hasError) return false;
  if (hasData) return true;

  const error = response.error;
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return false;
  }
  const details = error as Record<string, unknown>;
  return (
    typeof details.message === 'string' &&
    typeof details.name === 'string' &&
    (details.stack === undefined || typeof details.stack === 'string') &&
    (details.code === undefined || typeof details.code === 'string')
  );
}

const SIDECAR_ENV_ALLOWLIST = [
  'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'RUST_LOG', 'SOTRAMA_BACKUP_DIR', 'SOTRAMA_DUMP_PATH', 'SOTRAMA_ALLOW_COLUMN_DROP',
  'SOTRAMA_POOL_MAX', 'SOTRAMA_POOL_MIN', 'SOTRAMA_CONNECT_TIMEOUT_SECS',
  'SOTRAMA_ACQUIRE_TIMEOUT_SECS', 'SOTRAMA_IDLE_TIMEOUT_SECS', 'SOTRAMA_MAX_LIFETIME_SECS',
] as const;

/** Pass only OS/runtime settings and explicit backend configuration to the child. */
function createBackendEnvironment(
  source: NodeJS.ProcessEnv,
  required: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SIDECAR_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
    // Windows environment variable names are case-insensitive, but JS objects
    // are not. Preserve the original spelling used by the current host.
    if (process.platform === 'win32') {
      const actualKey = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (actualKey && source[actualKey] !== undefined) env[actualKey] = source[actualKey];
    }
  }
  Object.assign(env, required);
  return env;
}
