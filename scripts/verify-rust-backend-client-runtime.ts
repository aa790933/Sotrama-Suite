import assert from 'node:assert/strict';
import path from 'node:path';
import { RustBackendClient } from '../main/ipc/rustBackendClient.ts';

const mode = process.argv[2] ?? 'success';
const password = process.env.SOTRAMA_DB_PASSWORD ?? 'runtime-smoke-secret';
const config = {
  host: process.env.SOTRAMA_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SOTRAMA_DB_PORT ?? '3307'),
  user: process.env.SOTRAMA_DB_USER ?? 'sotrama',
  password,
  database: process.env.SOTRAMA_DB_NAME ?? 'sotrama_test',
};

if (process.env.SOTRAMA_BACKEND_PATH) {
  process.env.SOTRAMA_BACKEND_PATH = path.resolve(process.env.SOTRAMA_BACKEND_PATH);
}

const client = new RustBackendClient({
  requestTimeoutMs: 15_000,
  shutdownTimeoutMs: 2_000,
  backupDir: process.env.SOTRAMA_BACKUP_DIR,
});

if (mode === 'failure') {
  try {
    await client.connect({ ...config, host: '127.0.0.1', port: 1 }, 'dz');
    throw new Error('Expected an unreachable database to fail sidecar startup.');
  } catch (error) {
    const message = String(error?.message ?? error);
    assert.match(message, /cannot reach MariaDB|connect|exited/i,
      'the application client receives a database startup failure');
    assert.ok(!message.includes(password), 'database password is redacted from propagated errors');
    if (!/Expected an unreachable database/.test(message)) {
      console.log('Verified RustBackendClient propagates an unreachable-database startup failure.');
    } else {
      throw error;
    }
  } finally {
    await client.stop().catch(() => undefined);
  }
} else if (mode === 'success') {
  try {
    const countryCode = await client.connect(config, process.env.SOTRAMA_COUNTRY_CODE ?? 'dz');
    assert.equal(typeof countryCode, 'string', 'connect returns a validated country code');
    const schema = await client.schema();
    assert.ok(schema && typeof schema === 'object' && schema.Item,
      'the live sidecar returns the initialized schema registry');
    const count = await client.call('count', 'Item', {});
    assert.equal(typeof count, 'number', 'a CRUD request succeeds through the production client');
    console.log(`Verified RustBackendClient ↔ Rust sidecar ↔ MariaDB (Item count: ${count}).`);
  } finally {
    await client.stop();
  }
} else {
  throw new Error(`Unknown runtime verification mode: ${mode}`);
}
