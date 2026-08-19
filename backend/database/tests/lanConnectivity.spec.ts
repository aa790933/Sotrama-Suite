import os from 'os';
import test from 'tape';
import { MariaDBConfig } from '../core';
import DatabaseCore from '../core';
import { detectLanIp, detectSubnet } from '../../../main/mariadbInstall';

/**
 * LAN Connectivity Test
 *
 * Unlike localhost tests, this verifies that MariaDB accepts connections
 * on the machine's real LAN interface — proving bind-address and firewall
 * configuration work for host mode.
 */
test('detect LAN subnet from os.networkInterfaces', (t) => {
  const subnet = detectSubnet();
  if (subnet) {
    t.ok(subnet, `Detected subnet: ${subnet}`);
    const octets = subnet.split('.');
    t.equal(octets.length, 3, 'Subnet has three octets');
  } else {
    t.skip('No non-internal IPv4 interface found — skipping LAN test');
  }
  t.end();
});

test('detect LAN IP from os.networkInterfaces', (t) => {
  const lanIp = detectLanIp();
  if (lanIp) {
    t.ok(lanIp, `Detected LAN IP: ${lanIp}`);
    t.notOk(lanIp === '127.0.0.1', 'LAN IP is not loopback');
  } else {
    t.skip('No non-internal IPv4 interface found — skipping LAN test');
  }
  t.end();
});

test('connect to MariaDB via LAN IP (not localhost)', async (t) => {
  const lanIp = detectLanIp();
  const subnet = detectSubnet();

  if (!lanIp || !subnet) {
    t.skip('No suitable LAN interface — skipping remote connectivity test');
    t.end();
    return;
  }

  // Use sotrama_app credentials — the user the host-mode setup creates
  // with subnet-scoped grants. This proves the app-user grant works for
  // non-loopback connections, not just root.
  const cfg: MariaDBConfig = {
    host: lanIp,
    port: Number(process.env.TEST_DB_PORT ?? 3306),
    user: 'sotrama_app',
    password: 'password',
    database: 'test_books_core',
  };

  const db = new DatabaseCore(undefined, cfg);

  try {
    await db.connect();
    const rows = await db.query('SELECT 1 AS alive');
    t.ok(rows, `MariaDB reachable via LAN IP ${lanIp}:${cfg.port}`);
    t.equal(
      (rows as Array<{ alive: number }>).length,
      1,
      'Query returned expected row count'
    );
  } catch (err) {
    t.fail(`Cannot connect via LAN IP ${lanIp}: ${(err as Error).message}`);
  } finally {
    await db.close();
    t.end();
  }
});
