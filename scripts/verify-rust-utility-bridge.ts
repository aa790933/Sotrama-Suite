import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  parseRustUtilityJson,
  runRustUtility,
  safeUtilityEnvironment,
} from '../main/rustUtility.ts';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    process.nextTick(() => child.emit('close', null));
    return true;
  };
  return child;
}

function runWithChild(configure, timeoutMs = 100) {
  const child = fakeChild();
  const spawnProcess = (executable, args, options) => {
    assert.equal(executable, 'test-rust-utility');
    assert.deepEqual(args, ['--test-mode']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    configure(child, options);
    return child;
  };
  return runRustUtility(['--test-mode'], timeoutMs, {
    executable: 'test-rust-utility',
    spawnProcess,
  });
}

test('utility child environment excludes credentials and unrelated secrets', () => {
  const environment = safeUtilityEnvironment({
    PATH: 'safe-path',
    HOME: 'safe-home',
    SOTRAMA_DB_PASSWORD: 'must-not-pass',
    GITHUB_TOKEN: 'must-not-pass',
    AWS_SECRET_ACCESS_KEY: 'must-not-pass',
  });
  assert.equal(environment.PATH, 'safe-path');
  assert.equal(environment.HOME, 'safe-home');
  assert.equal('SOTRAMA_DB_PASSWORD' in environment, false);
  assert.equal('GITHUB_TOKEN' in environment, false);
  assert.equal('AWS_SECRET_ACCESS_KEY' in environment, false);
});

test('utility bridge returns stdout only after a successful exit', async () => {
  const output = await runWithChild((child) => {
    process.nextTick(() => {
      child.stdout.end('{"ok":true}');
      child.stderr.end('diagnostic noise');
      child.emit('close', 0);
    });
  });
  assert.deepEqual(parseRustUtilityJson(output, 'test'), { ok: true });
});

test('utility bridge propagates a bounded stderr diagnostic on nonzero exit', async () => {
  await assert.rejects(
    runWithChild((child) => {
      process.nextTick(() => {
        child.stderr.end('safe failure');
        child.emit('close', 2);
      });
    }),
    /safe failure/
  );
});

test('utility bridge rejects malformed JSON without echoing the payload', () => {
  assert.throws(
    () => parseRustUtilityJson('{secret: malformed}', 'test'),
    { message: 'Rust utility returned malformed JSON for test' }
  );
});

test('utility bridge kills and rejects a timed-out child', async () => {
  await assert.rejects(
    runWithChild(() => {}, 5),
    /timed out after 5 milliseconds/
  );
});

test('utility bridge kills and rejects output exceeding the hard cap', async () => {
  await assert.rejects(
    runWithChild((child) => {
      process.nextTick(() => child.stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1)));
    }),
    /output exceeded the 16 MiB limit/
  );
});
