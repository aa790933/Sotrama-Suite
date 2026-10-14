import test from 'tape';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { MariaDBConfig } from '../../utils/mariadb-types';
import { RustBackendClient } from './rustBackendClient';

const config: MariaDBConfig = {
  host: '127.0.0.1',
  port: 3307,
  user: 'test',
  password: 'test-secret',
  database: 'sotrama_test',
};

function fakeProcess(respond: (request: Record<string, unknown>) => unknown, closeOnStdinEnd = true) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: () => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit('close', 0, null);
    return true;
  };
  let buffer = '';
  child.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const request = JSON.parse(line) as Record<string, unknown>;
      const result = respond(request);
      if (result !== undefined) {
        child.stdout.write(
          result === '__RAW_INVALID_JSON__'
            ? 'not-json\n'
            : result === '__RAW_NULL_JSON__'
              ? 'null\n'
              : result === '__RAW_UNKNOWN_ID__'
                ? `${JSON.stringify({ jsonrpc: '2.0', id: Number(request.id) + 10_000, result: { data: true } })}\n`
                : `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`
        );
      }
    }
  });
  child.stdin.on('finish', () => {
    if (!closeOnStdinEnd) return;
    child.exitCode = 0;
    child.emit('close', 0, null);
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

test('RustBackendClient sends JSON-RPC and unwraps BackendResponse', async (t) => {
  const child = fakeProcess((request) => {
    if (request.method === 'db.connect') return { data: { countryCode: 'dz' } };
    return { data: 42 };
  });
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    requestTimeoutMs: 100,
    log: () => {},
  });
  t.equal(await client.connect(config, 'dz'), 'dz', 'connect waits for a valid ready response');
  t.equal(await client.call<number>('count', 'Item', {}), 42, 'database response data is returned');
  await client.stop();
  t.end();
});

test('RustBackendClient gives the sidecar only allowlisted environment values', async (t) => {
  let childEnv: NodeJS.ProcessEnv | undefined;
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: (_executable, _args, options) => {
      childEnv = options?.env;
      return fakeProcess((request) =>
        request.method === 'db.connect' ? { data: { countryCode: 'dz' } } : { data: true }
      );
    },
    baseEnv: {
      PATH: 'safe-path',
      SOTRAMA_POOL_MAX: '12',
      UNRELATED_API_TOKEN: 'must-not-leak',
      SOTRAMA_CREATE_DATABASE: 'true',
    },
    log: () => {},
  });
  await client.connect(config, 'dz', false);
  t.equal(childEnv?.PATH, 'safe-path', 'native utility discovery remains available');
  t.equal(childEnv?.SOTRAMA_POOL_MAX, '12', 'explicit backend tuning is preserved');
  t.equal(childEnv?.SOTRAMA_DB_PASSWORD, config.password, 'database credentials are passed only to the intended child');
  t.equal(childEnv?.UNRELATED_API_TOKEN, undefined, 'unrelated parent secrets are not inherited');
  t.equal(childEnv?.SOTRAMA_CREATE_DATABASE, undefined, 'database creation is opt-in for each connection');
  await client.stop();
  t.end();
});

test('RustBackendClient validates database configuration before stopping or spawning a process', async (t) => {
  let starts = 0;
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => {
      starts += 1;
      return fakeProcess(() => ({ data: { countryCode: 'dz' } }));
    },
    log: () => {},
  });
  for (const invalid of [
    { ...config, host: '' },
    { ...config, port: 0 },
    { ...config, port: 65536 },
    { ...config, database: 'unsafe`name' },
    { ...config, database: 'a'.repeat(65) },
  ]) {
    try {
      await client.connect(invalid, 'dz');
      t.fail('invalid configuration must be rejected');
    } catch (error) {
      t.match((error as Error).message, /Database (host|port|name)/, 'invalid field is reported without credential values');
    }
  }
  t.equal(starts, 0, 'invalid configuration never launches the backend');
  t.end();
});

test('RustBackendClient bounds concurrent pending requests', async (t) => {
  const child = fakeProcess((request) =>
    request.method === 'db.connect' ? { data: { countryCode: 'dz' } } : undefined,
    false
  );
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    maxPendingRequests: 2,
    requestTimeoutMs: 500,
    log: () => {},
  });
  await client.connect(config, 'dz');
  const first = client.call('count', 'Item', {});
  const second = client.call('exists', 'Item', 'ITEM-1');
  try {
    await client.call('get', 'Item', 'ITEM-2');
    t.fail('requests beyond the configured limit must be rejected');
  } catch (error) {
    t.match((error as Error).message, /request limit reached \(2\)/, 'pending request growth is bounded');
  }
  await client.stop();
  await Promise.allSettled([first, second]);
  t.end();
});

test('RustBackendClient rejects malformed response envelopes', async (t) => {
  const child = fakeProcess(() => ({ unexpected: true }));
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    requestTimeoutMs: 100,
    log: () => {},
  });
  try {
    await client.connect(config, 'dz');
    t.fail('malformed response must be rejected');
  } catch (error) {
    t.match((error as Error).message, /invalid BackendResponse/, 'response shape is validated');
  }
  await client.stop();
  t.end();
});

test('RustBackendClient fails pending calls on malformed protocol output', async (t) => {
  const child = fakeProcess(() => '__RAW_INVALID_JSON__');
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    requestTimeoutMs: 500,
    log: () => {},
  });
  try {
    await client.connect(config, 'dz');
    t.fail('malformed stdout must fail startup immediately');
  } catch (error) {
    t.match((error as Error).message, /malformed JSON/, 'protocol error is not hidden until timeout');
  }
  await client.stop();
  t.end();
});

test('RustBackendClient rejects a JSON primitive instead of crashing the main process', async (t) => {
  const child = fakeProcess(() => '__RAW_NULL_JSON__');
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    requestTimeoutMs: 500,
    log: () => {},
  });
  try {
    await client.connect(config, 'dz');
    t.fail('a non-object JSON-RPC response must fail startup');
  } catch (error) {
    t.match((error as Error).message, /non-object JSON-RPC/, 'non-object protocol output is rejected safely');
  }
  await client.stop();
  t.end();
});

test('RustBackendClient rejects responses that do not correlate to a pending request', async (t) => {
  const child = fakeProcess(() => '__RAW_UNKNOWN_ID__');
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    requestTimeoutMs: 500,
    log: () => {},
  });
  try {
    await client.connect(config, 'dz');
    t.fail('an unknown response id must fail startup');
  } catch (error) {
    t.match((error as Error).message, /unknown request id/, 'unsolicited responses fail closed');
  }
  await client.stop();
  t.end();
});

test('RustBackendClient correlates concurrent requests and prevents duplicate startup', async (t) => {
  let starts = 0;
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => {
      starts += 1;
      return fakeProcess((request) => {
        if (request.method === 'db.connect') return { data: { countryCode: 'dz' } };
        const params = request.params as unknown[];
        return { data: params[0] };
      });
    },
    requestTimeoutMs: 500,
    log: () => {},
  });
  const starting = client.connect(config, 'dz');
  try {
    await client.connect(config, 'dz');
    t.fail('a concurrent connect must not spawn a second sidecar');
  } catch (error) {
    t.match((error as Error).message, /already starting/, 'duplicate startup is rejected explicitly');
  }
  await starting;
  const [first, second] = await Promise.all([
    client.call<string>('get', 'Item', 'ITEM-1'),
    client.call<string>('exists', 'Item', 'ITEM-2'),
  ]);
  t.equal(starts, 1, 'only one sidecar was started');
  t.equal(first, 'get', 'first concurrent response matches its request id');
  t.equal(second, 'exists', 'second concurrent response matches its request id');
  await client.stop();
  t.end();
});

test('RustBackendClient times out unanswered calls', async (t) => {
  const child = fakeProcess(() => undefined);
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child,
    requestTimeoutMs: 20,
    log: () => {},
  });
  const connecting = client.connect(config, 'dz');
  try {
    await connecting;
    t.fail('connect should time out without a readiness response');
  } catch (error) {
    t.match((error as Error).message, /timed out/, 'startup timeout is visible');
  }
  await client.stop();
  t.end();
});

test('RustBackendClient propagates an early process exit during startup', async (t) => {
  const child = fakeProcess(() => undefined) as unknown as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: () => boolean;
  };
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child as unknown as ChildProcessWithoutNullStreams,
    requestTimeoutMs: 500,
    log: () => {},
  });
  const connecting = client.connect(config, 'dz');
  setTimeout(() => {
    child.stderr.write('cannot reach MariaDB; password test-secret rejected');
    child.exitCode = 1;
    child.emit('close', 1, null);
  }, 0);
  try {
    await connecting;
    t.fail('startup must fail when the child exits before replying');
  } catch (error) {
    t.match((error as Error).message, /exited/, 'exit status reaches the caller');
    t.match((error as Error).message, /cannot reach MariaDB/, 'startup diagnostics reach the caller');
    t.notOk((error as Error).message.includes('test-secret'), 'startup diagnostics redact the configured password');
  }
  await client.stop();
  t.end();
});

test('RustBackendClient escalates timed-out graceful shutdown and waits for process close', async (t) => {
  const child = fakeProcess(
    (request) => request.method === 'db.connect' ? { data: { countryCode: 'dz' } } : undefined,
    false
  ) as unknown as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: () => boolean;
  };
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child as unknown as ChildProcessWithoutNullStreams,
    requestTimeoutMs: 100,
    shutdownTimeoutMs: 10,
    log: () => {},
  });
  await client.connect(config, 'dz');
  await client.stop();
  t.equal(child.killed, true, 'kill is used only after graceful EOF times out');
  t.equal(child.exitCode, 0, 'stop waits until the process close event updates its status');
  t.end();
});

test('RustBackendClient rejects every pending request after a broken stdin pipe', async (t) => {
  const child = fakeProcess(
    (request) => request.method === 'db.connect' ? { data: { countryCode: 'dz' } } : undefined,
    false
  ) as unknown as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: () => boolean;
  };
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child as unknown as ChildProcessWithoutNullStreams,
    requestTimeoutMs: 100,
    shutdownTimeoutMs: 10,
    log: () => {},
  });
  await client.connect(config, 'dz');
  (child.stdin as unknown as {
    write: (chunk: string, encoding: string, callback: (error?: Error | null) => void) => boolean;
  }).write = (_chunk, _encoding, callback) => {
    queueMicrotask(() => callback(new Error('synthetic broken pipe')));
    return false;
  };
  const results = await Promise.allSettled([
    client.call('count', 'Item', {}),
    client.call('exists', 'Item', 'ITEM-1'),
  ]);
  t.equal(results.filter((result) => result.status === 'rejected').length, 2,
    'both the write that failed and concurrent requests reject promptly');
  t.equal(child.killed, true, 'a broken protocol pipe terminates the unusable sidecar');
  await client.stop();
  t.end();
});

test('RustBackendClient reports a sidecar that survives termination instead of orphaning it', async (t) => {
  const child = fakeProcess(
    (request) => request.method === 'db.connect' ? { data: { countryCode: 'dz' } } : undefined,
    false
  ) as unknown as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: () => boolean;
  };
  child.kill = () => {
    child.killed = true;
    return true;
  };
  const client = new RustBackendClient({
    resolveExecutable: () => 'fake-backend',
    spawnBackend: () => child as unknown as ChildProcessWithoutNullStreams,
    requestTimeoutMs: 100,
    shutdownTimeoutMs: 10,
    log: () => {},
  });
  await client.connect(config, 'dz');
  try {
    await client.stop();
    t.fail('stop must fail when the OS process remains alive');
  } catch (error) {
    t.match((error as Error).message, /did not exit/, 'failed termination is observable');
  }
  t.equal(child.exitCode, null, 'a kill request is not mistaken for process exit');
  child.exitCode = 0;
  child.emit('close', 0, null);
  await client.stop();
  t.end();
});
