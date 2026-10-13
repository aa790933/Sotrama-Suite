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
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connecting = false;
  private readonly requestTimeoutMs: number;
  private readonly spawnBackend: SpawnBackend;
  private readonly resolveExecutable: () => string;
  private readonly backupDir?: string;
  private readonly log: (message: string) => void;

  constructor(options: RustBackendClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.spawnBackend = options.spawnBackend ?? (spawn as SpawnBackend);
    this.resolveExecutable = options.resolveExecutable ?? resolveRustBackendExecutable;
    this.backupDir = options.backupDir;
    this.log = options.log ?? ((message) => console.error(`[rust-backend] ${message}`));
  }

  async connect(config: MariaDBConfig, countryCode = '', createDatabase = false): Promise<string> {
    if (this.connecting) {
      throw new Error('Rust backend connection is already starting.');
    }
    this.connecting = true;
    try {
      await this.stop();
      const executable = this.resolveExecutable();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SOTRAMA_DB_HOST: config.host,
        SOTRAMA_DB_PORT: String(config.port),
        SOTRAMA_DB_USER: config.user,
        SOTRAMA_DB_PASSWORD: config.password,
        SOTRAMA_DB_NAME: config.database,
        SOTRAMA_COUNTRY_CODE: countryCode || '-',
        ...(this.backupDir ? { SOTRAMA_BACKUP_DIR: this.backupDir } : {}),
      };
      if (createDatabase) env.SOTRAMA_CREATE_DATABASE = 'true';
      else delete env.SOTRAMA_CREATE_DATABASE;

      const child = this.spawnBackend(executable, ['--serve'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      this.child = child;
      this.lines = createInterface({ input: child.stdout });
      this.lines.on('line', (line) => this.onLine(line));
      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (message) this.log(message);
      });
      child.on('error', (error) => this.failAll(error));
      child.on('close', (code, signal) => {
        this.failAll(new Error(`Rust backend exited (code=${code}, signal=${signal ?? 'none'}).`));
        this.lines?.close();
        this.lines = null;
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
    const id = this.nextId++;
    return await new Promise<BackendResponse & { data?: T }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Rust backend request timed out: ${method}`));
        child.kill();
        this.failAll(new Error(`Rust backend stopped after a timed-out request: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (response: BackendResponse) => void, reject, timeout });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, 'utf8', (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(error);
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
    try {
      if (child.stdin.writable) child.stdin.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
      });
    } finally {
      if (this.child === child) this.child = null;
      this.lines?.close();
      this.lines = null;
      this.failAll(new Error('Rust backend stopped.'));
    }
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
    if (!pending) return;
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
