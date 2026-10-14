import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { RustApiClient } from '../main/rustApiClient.mjs';

const endpoint = 'https://erp.example.com/api/method/books_integration.api.sync';
const telemetryEndpoint = 'https://logs.example.com/api/error';

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.killed = true;
    process.nextTick(() => child.emit('close', null));
    return true;
  };
  return child;
}

function makeClient({ respond, timeoutMs = 100, maxPendingRequests = 4, spawnProcess } = {}) {
  const child = fakeChild();
  const client = new RustApiClient({
    requestTimeoutMs: timeoutMs,
    maxPendingRequests,
    resolveExecutable: () => 'sotrama-backend-test',
    baseEnv: { PATH: 'safe-path', SOTRAMA_DB_PASSWORD: 'must-not-pass', GITHUB_TOKEN: 'must-not-pass' },
    spawnProcess: spawnProcess ?? ((executable, args, options) => {
      assert.equal(executable, 'sotrama-backend-test');
      assert.deepEqual(args, ['--serve-api']);
      assert.equal(options.env.SOTRAMA_DB_PASSWORD, undefined);
      assert.equal(options.env.GITHUB_TOKEN, undefined);
      child.stdin.on('data', (chunk) => {
        for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
          respond?.(JSON.parse(line), child);
        }
      });
      return child;
    }),
  });
  return { client, child };
}

test('Rust API client correlates responses and sends only the typed request contract', async () => {
  const { client } = makeClient({ respond: (request, child) => {
    assert.equal(request.endpoint, endpoint);
    assert.equal(request.purpose, 'erpnext');
    assert.deepEqual(request.options, { method: 'POST', headers: { Authorization: 'token secret', 'Content-Type': 'application/json' }, body: '{"ping":true}' });
    process.nextTick(() => child.stdout.write(JSON.stringify({ id: request.id, result: { message: { success: true } } }) + '\n'));
  } });
  assert.deepEqual(await client.request(endpoint, {
    method: 'POST',
    headers: { Authorization: 'token secret', 'Content-Type': 'application/json' },
    body: '{"ping":true}',
  }), { message: { success: true } });
  client.close();
});

test('Rust API client rejects URLs outside the HTTPS integration route before spawning', async () => {
  let spawned = false;
  const client = new RustApiClient({
    resolveExecutable: () => 'unused',
    spawnProcess: () => { spawned = true; return fakeChild(); },
  });
  await assert.rejects(client.request('https://evil.example/api/method/other', {}), /endpoint is not allowed/);
  await assert.rejects(client.request('https://user:secret@erp.example.com/api/method/books_integration.api.sync', {}), /valid HTTPS URL/);
  assert.equal(spawned, false);
});

test('Rust API client rejects invalid methods, unsafe headers, and oversized bodies', async () => {
  const { client } = makeClient();
  await assert.rejects(client.request(endpoint, { method: 'DELETE' }), /Unsupported API request method/);
  await assert.rejects(client.request(endpoint, { method: 'POST', headers: { Authorization: 'bad\r\nInjected: yes' }, body: '{}' }), /Invalid API request header/);
  await assert.rejects(client.request(endpoint, { method: 'POST', headers: { Host: 'attacker.example' }, body: '{}' }), /restricted header/);
  await assert.rejects(client.request(endpoint, { method: 'POST', body: 'x'.repeat(4 * 1024 * 1024 + 1) }), /4 MiB limit/);
  client.close();
});

test('Rust API client enforces the pending request cap', async () => {
  let sentRequest;
  const { client, child } = makeClient({
    maxPendingRequests: 1,
    respond: (request) => { sentRequest = request; },
  });
  const first = client.request(endpoint, {});
  await assert.rejects(client.request(endpoint, {}), /request limit reached/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sentRequest);
  child.stdout.write(JSON.stringify({ id: sentRequest.id, result: [] }) + '\n');
  assert.deepEqual(await first, []);
  client.close();
});

test('Rust API client bounds aggregate queued request bytes', async () => {
  const { client } = makeClient({ timeoutMs: 1000, maxPendingRequests: 8 });
  const body = 'x'.repeat(4 * 1024 * 1024);
  const pending = [0, 1, 2].map(() => client.request(endpoint, { method: 'POST', body }));
  await assert.rejects(client.request(endpoint, { method: 'POST', body }), /16 MiB aggregate limit/);
  client.close();
  const settled = await Promise.allSettled(pending);
  assert.ok(settled.every((result) => result.status === 'rejected'));
});

test('Rust API client times out and rejects pending calls on shutdown', async () => {
  const timed = makeClient({ timeoutMs: 5 });
  await assert.rejects(timed.client.request(endpoint, {}), /timed out/);
  timed.client.close();

  const closing = makeClient();
  const pending = closing.client.request(endpoint, {});
  closing.client.close();
  await assert.rejects(pending, /shutting down/);
});

test('Rust API client shutdown waits for the child close event and blocks new requests', async () => {
  const child = fakeChild();
  child.kill = () => { child.killed = true; return true; };
  const client = new RustApiClient({
    requestTimeoutMs: 1000,
    resolveExecutable: () => 'sotrama-backend-test',
    baseEnv: { PATH: 'safe-path' },
    spawnProcess: () => child,
  });
  const pending = client.request(endpoint, {});
  await new Promise((resolve) => setImmediate(resolve));
  const closing = client.close();
  await assert.rejects(pending, /shutting down/);
  await assert.rejects(client.request(endpoint, {}), /shutting down/);
  let closeResolved = false;
  void closing.then(() => { closeResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeResolved, false, 'shutdown must wait for process termination');
  child.emit('close', 0, null);
  await closing;
  assert.equal(closeResolved, true);
});

test('Rust API client rejects malformed service frames without leaking payloads', async () => {
  const { client, child } = makeClient();
  const pending = client.request(endpoint, {});
  child.stdout.write('{not-json}\n');
  await assert.rejects(pending, /malformed JSON/);
  client.close();
});

test('Rust API client rejects unknown response IDs and invalid response envelopes', async () => {
  const unexpected = makeClient();
  const pending = unexpected.client.request(endpoint, {});
  unexpected.child.stdout.write(JSON.stringify({ id: 999, result: [] }) + '\n');
  await assert.rejects(pending, /unexpected response ID/);
  assert.equal(unexpected.child.killed, true);

  const invalid = makeClient();
  const malformedEnvelope = invalid.client.request(endpoint, {});
  invalid.child.stdout.write(JSON.stringify({ id: 1, result: [], error: { message: 'bad' } }) + '\n');
  await assert.rejects(malformedEnvelope, /invalid response envelope/);
  assert.equal(invalid.child.killed, true);
});

test('Rust API client separates telemetry HTTPS POSTs from the ERPNext route policy', async () => {
  const { client } = makeClient({ respond: (request, child) => {
    assert.equal(request.purpose, 'telemetry');
    assert.equal(request.endpoint, telemetryEndpoint);
    assert.equal(request.options.method, 'POST');
    process.nextTick(() => child.stdout.write(JSON.stringify({ id: request.id, result: null }) + '\n'));
  } });
  assert.equal(await client.requestTelemetry(telemetryEndpoint, { method: 'POST', headers: { Authorization: 'token secret' }, body: '{}' }), null);
  await assert.rejects(client.requestTelemetry('http://logs.example.com/api/error', { method: 'POST', body: '{}' }), /valid HTTPS URL/);
  await assert.rejects(client.requestTelemetry(telemetryEndpoint, { method: 'GET' }), /must use POST/);
  await assert.rejects(client.requestTelemetry(telemetryEndpoint, { method: 'POST', body: '{}' }), /authorization header/);
  client.close();
});

test('Rust API client handles multiple bounded response frames in one stdout chunk', async () => {
  const { client, child } = makeClient();
  const first = client.request(endpoint, {});
  const second = client.request(endpoint, {});
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(`${JSON.stringify({ id: 1, result: { ok: 1 } })}\n${JSON.stringify({ id: 2, result: { ok: 2 } })}\n`);
  assert.deepEqual(await first, { ok: 1 });
  assert.deepEqual(await second, { ok: 2 });
  client.close();
});

test('Rust API client kills timed-out service work and starts a fresh child for recovery', async () => {
  const children = [];
  const timed = makeClient({ timeoutMs: 10, spawnProcess: () => {
    const child = fakeChild();
    children.push(child);
    return child;
  } });
  await assert.rejects(timed.client.request(endpoint, {}), /timed out/);
  assert.equal(children[0].killed, true, 'timed-out HTTP work is cancelled by terminating its service');
  const recovered = timed.client.request(endpoint, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2, 'a later request starts a fresh service process');
  const sent = JSON.parse(children[1].stdin.read().toString('utf8').trim());
  children[1].stdout.write(JSON.stringify({ id: sent.id, result: { recovered: true } }) + '\n');
  assert.deepEqual(await recovered, { recovered: true });
  timed.client.close();
});

test('Rust API client rejects pending calls when the process exits and recovers on next call', async () => {
  const children = [];
  const client = new RustApiClient({
    requestTimeoutMs: 1000,
    resolveExecutable: () => 'sotrama-backend-test',
    baseEnv: { PATH: 'safe-path' },
    spawnProcess: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
  });
  const pending = client.request(endpoint, {});
  await new Promise((resolve) => setImmediate(resolve));
  children[0].emit('close', 17, null);
  await assert.rejects(pending, /stopped unexpectedly/);

  const recovered = client.request(endpoint, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2);
  children[0].stdout.write(JSON.stringify({ id: 1, result: { fromOldProcess: true } }) + '\n');
  await new Promise((resolve) => setImmediate(resolve));
  const sent = JSON.parse(children[1].stdin.read().toString('utf8').trim());
  assert.equal(sent.id, 2);
  children[1].stdout.write(JSON.stringify({ id: sent.id, result: { recovered: true } }) + '\n');
  assert.deepEqual(await recovered, { recovered: true });
  client.close();
});
