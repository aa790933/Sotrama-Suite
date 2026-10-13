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

function fakeProcess(respond: (request: Record<string, unknown>) => unknown) {
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
            : `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`
        );
      }
    }
  });
  child.stdin.on('finish', () => {
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
    child.exitCode = 1;
    child.emit('close', 1, null);
  }, 0);
  try {
    await connecting;
    t.fail('startup must fail when the child exits before replying');
  } catch (error) {
    t.match((error as Error).message, /exited/, 'exit status reaches the caller');
  }
  await client.stop();
  t.end();
});
