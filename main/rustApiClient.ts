import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { safeUtilityEnvironment, resolveRustUtilityExecutable } from './rustUtility.ts';

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_LINE_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_HEADERS = 64;

type ApiPurpose = 'erpnext' | 'telemetry';
type ApiMethod = 'GET' | 'POST';

export interface ApiRequestOptions {
  method?: ApiMethod;
  headers?: Record<string, string>;
  body?: string;
}

interface ValidatedRequest {
  purpose: ApiPurpose;
  endpoint: string;
  options: { method: ApiMethod; headers: Record<string, string>; body?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  bytes: number;
}

type ApiChild = Pick<ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'once' | 'removeListener' | 'kill'>;
type ApiSpawn = (
  executable: string,
  args: string[],
  options: SpawnOptions
) => ApiChild;

interface RustApiClientOptions {
  requestTimeoutMs?: number;
  maxPendingRequests?: number;
  resolveExecutable?: () => string;
  spawnProcess?: ApiSpawn;
  baseEnv?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRequest(
  endpoint: unknown,
  options: unknown = {},
  purpose: ApiPurpose = 'erpnext'
): ValidatedRequest {
  if (purpose !== 'erpnext' && purpose !== 'telemetry') {
    throw new Error('Unsupported HTTPS request purpose');
  }
  if (typeof endpoint !== 'string') throw new Error('Invalid ERPNext API URL');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid ERPNext API URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('ERPNext API requests require a valid HTTPS URL');
  }
  if (
    url.hash ||
    (purpose === 'erpnext' && !url.pathname.startsWith('/api/method/books_integration.api.'))
  ) {
    throw new Error('ERPNext API endpoint is not allowed');
  }
  if (options === undefined) options = {};
  if (!isRecord(options)) {
    throw new Error('Invalid ERPNext API request options');
  }
  const method = options.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported API request method');
  if (purpose === 'telemetry' && method !== 'POST') throw new Error('Telemetry requests must use POST');
  if (options.body !== undefined && typeof options.body !== 'string') {
    throw new Error('ERPNext API request body must be a string');
  }
  if (Buffer.byteLength(options.body ?? '', 'utf8') > MAX_BODY_BYTES) {
    throw new Error('API request body exceeds the 4 MiB limit');
  }
  if (method === 'GET' && options.body !== undefined) throw new Error('GET API requests cannot include a body');
  const body = options.body;
  const headers = options.headers ?? {};
  if (!isRecord(headers) || Object.keys(headers).length > MAX_HEADERS) {
    throw new Error('Invalid API request headers');
  }
  let headerBytes = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error('Invalid API request header');
    }
    if (['host', 'content-length', 'connection', 'transfer-encoding', 'proxy-authorization'].includes(name.toLowerCase())) {
      throw new Error('API request contains a restricted header');
    }
    const currentHeaderBytes = Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');
    headerBytes += currentHeaderBytes;
    if (currentHeaderBytes > 16 * 1024 || headerBytes > 64 * 1024) {
      throw new Error('API request headers exceed the size limit');
    }
  }
  if (purpose === 'telemetry' && !Object.entries(headers).some(([name, value]) =>
    name.toLowerCase() === 'authorization' && value.trim().length > 0
  )) {
    throw new Error('Telemetry requests require an authorization header');
  }
  return {
    purpose,
    endpoint: url.href,
    options: {
      method,
      headers: headers as Record<string, string>,
      ...(body === undefined ? {} : { body: body as string }),
    },
  };
}

export class RustApiClient {
  private readonly requestTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly resolveExecutable: () => string;
  private readonly spawnProcess: ApiSpawn;
  private readonly env: NodeJS.ProcessEnv;
  private child: ApiChild | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private pendingBytes = 0;
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor({
    requestTimeoutMs = 35_000,
    maxPendingRequests = 32,
    resolveExecutable = resolveRustUtilityExecutable,
    spawnProcess = (executable, args, options) =>
      spawn(executable, args, options) as ApiChild,
    baseEnv = process.env,
  }: RustApiClientOptions = {}) {
    if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1 || maxPendingRequests > 128) {
      throw new Error('maxPendingRequests must be an integer between 1 and 128');
    }
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxPendingRequests = maxPendingRequests;
    this.resolveExecutable = resolveExecutable;
    this.spawnProcess = spawnProcess;
    this.env = safeUtilityEnvironment(baseEnv);
  }

  async request(endpoint: string, options?: ApiRequestOptions): Promise<unknown> {
    return this.requestForPurpose(endpoint, options, 'erpnext');
  }

  async requestTelemetry(endpoint: string, options?: ApiRequestOptions): Promise<unknown> {
    return this.requestForPurpose(endpoint, options, 'telemetry');
  }

  private async requestForPurpose(
    endpoint: string,
    options: ApiRequestOptions | undefined,
    purpose: ApiPurpose
  ): Promise<unknown> {
    if (this.closing) throw new Error('Rust API service is shutting down');
    const request = validateRequest(endpoint, options, purpose);
    if (this.pending.size >= this.maxPendingRequests) {
      throw new Error(`ERPNext API request limit reached (${this.maxPendingRequests})`);
    }
    const id = this.nextId++;
    const frame = JSON.stringify({ id, ...request });
    const frameBytes = Buffer.byteLength(frame, 'utf8') + 1;
    if (frameBytes > MAX_REQUEST_BYTES) {
      throw new Error('ERPNext API request exceeds the 8 MiB protocol limit');
    }
    if (this.pendingBytes + frameBytes > MAX_PENDING_REQUEST_BYTES) {
      throw new Error('ERPNext API pending requests exceed the 16 MiB aggregate limit');
    }
    const child = this.ensureChild();
    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        // The protocol has no per-request cancellation frame. Kill the service
        // to cancel the timed-out HTTP operation rather than leave work running
        // after its caller has given up; subsequent requests restart it.
        const error = new Error('HTTPS request timed out; Rust service was restarted');
        this.failChild(child, error);
        try { child.kill(); } catch {}
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout, bytes: frameBytes });
      this.pendingBytes += frameBytes;
      try {
        child.stdin.write(`${frame}\n`, 'utf8', (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          this.pendingBytes -= pending.bytes;
          clearTimeout(pending.timeout);
          this.failChild(child, new Error('Could not send HTTPS request to Rust service'));
          try { child.kill(); } catch {}
        });
      } catch {
        this.failChild(child, new Error('Could not send HTTPS request to Rust service'));
        try { child.kill(); } catch {}
      }
    });
  }

  private ensureChild(): ApiChild {
    if (this.child && this.child.stdin.writable) return this.child;
    const child = this.spawnProcess(this.resolveExecutable(), ['--serve-api'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env,
    });
    this.child = child;
    this.stdoutBuffer = Buffer.alloc(0);
    child.stdout.on('data', (chunk: Buffer) => {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline;
        const fragment = chunk.subarray(start, end);
        if (this.stdoutBuffer.length + fragment.length > MAX_RESPONSE_LINE_BYTES) {
          this.failChild(child, new Error('Rust API response exceeded the 16 MiB protocol limit'));
          try { child.kill(); } catch {}
          return;
        }
        if (fragment.length) this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, fragment]);
        if (newline === -1) break;
        this.onLine(this.stdoutBuffer.toString('utf8'), child);
        this.stdoutBuffer = Buffer.alloc(0);
        start = newline + 1;
      }
    });
    child.once('error', () => this.failChild(child, new Error('Rust API service failed to start')));
    child.once('close', () => this.failChild(child, new Error('Rust API service stopped unexpectedly')));
    // Never forward service stderr: diagnostics must not leak endpoints, headers or tokens.
    child.stderr.on('data', () => {});
    return child;
  }

  private onLine(line: string, child: ApiChild | null = this.child): void {
    if (!child || this.child !== child) return;
    if (Buffer.byteLength(line, 'utf8') > MAX_RESPONSE_LINE_BYTES) {
      this.failChild(child, new Error('Rust API response exceeded the 16 MiB protocol limit'));
      try { child.kill(); } catch {}
      return;
    }
    let response: Record<string, unknown>;
    try { response = JSON.parse(line); } catch {
      this.failChild(child, new Error('Rust API service returned malformed JSON'));
      try { child?.kill(); } catch {}
      return;
    }
    if (!isRecord(response)) {
      this.failChild(child, new Error('Rust API service returned an invalid response envelope'));
      try { child.kill(); } catch {}
      return;
    }
    if (typeof response.id !== 'number' || !Number.isSafeInteger(response.id) || response.id < 1) {
      this.failChild(child, new Error('Rust API service returned an invalid response ID'));
      try { child.kill(); } catch {}
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.failChild(child, new Error('Rust API service returned an unexpected response ID'));
      try { child.kill(); } catch {}
      return;
    }
    const hasResult = Object.hasOwn(response, 'result');
    const hasError = Object.hasOwn(response, 'error');
    const responseError = response.error;
    if (
      hasResult === hasError ||
      (hasError && (!isRecord(responseError) || typeof responseError.message !== 'string'))
    ) {
      this.failChild(child, new Error('Rust API service returned an invalid response envelope'));
      try { child.kill(); } catch {}
      return;
    }
    this.pending.delete(response.id);
    this.pendingBytes -= pending.bytes;
    clearTimeout(pending.timeout);
    if (hasError) {
      pending.reject(new Error((responseError as Record<string, unknown>).message as string));
    } else if (hasResult) {
      pending.resolve(response.result);
    }
  }

  private failChild(child: ApiChild | null, error: Error): void {
    if (child && this.child !== child) return;
    if (child && this.child === child) this.child = null;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      this.pendingBytes -= pending.bytes;
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const child = this.child;
    if (!child) {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }
    this.closePromise = new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.removeListener('close', finish);
        child.removeListener('error', finish);
        resolve();
      };
      child.once('close', finish);
      child.once('error', finish);
      timeout = setTimeout(finish, 1500);
      this.failChild(child, new Error('Rust API service is shutting down'));
      try {
        if (!child.kill()) finish();
      } catch {
        finish();
      }
    });
    return this.closePromise;
  }
}

let sharedClient: RustApiClient | undefined;
export function sendRustApiRequest(endpoint: string, options?: ApiRequestOptions): Promise<unknown> {
  sharedClient ??= new RustApiClient();
  return sharedClient.request(endpoint, options);
}

export function sendRustTelemetryRequest(endpoint: string, options?: ApiRequestOptions): Promise<unknown> {
  sharedClient ??= new RustApiClient();
  return sharedClient.requestTelemetry(endpoint, options);
}

export async function closeRustApiClient() {
  const client = sharedClient;
  if (!client) return;
  await client.close();
  if (sharedClient === client) sharedClient = undefined;
}
