import net from 'net';
import os from 'os';
import type {
  HostProvisionConfig,
  InstallProgress,
  InstallResult,
  PingOptions,
  PingResult,
  Platform,
  PortCheckResult,
} from '../../utils/mariadb-types';
import {
  appUserStatements,
  forPlatform,
  type OpResult,
  type PlatformInstaller,
} from './platformInstallers';

/**
 * HostProvisioning is the single seam for MariaDB host setup. Port probing,
 * install, bind-address, firewall, GRANT scope, and verification live here;
 * OS mechanics sit behind the PlatformInstaller seam.
 *
 * @param config passwords, database, requested port, and host mode.
 * @param onProgress staged progress callback (download percent included).
 * @param installer platform adapter; defaults to the detected OS.
 * @returns install result carrying the allocated port on success.
 */
export async function provision(
  config: HostProvisionConfig,
  onProgress?: (event: InstallProgress) => void,
  installer: PlatformInstaller = forPlatform(detectPlatform())
): Promise<InstallResult> {
  const port = await probeFreePort(config.port);
  if (port === null) {
    return {
      ok: false,
      error: `No free port found between ${config.port} and ${config.port + 19}.`,
    };
  }

  onProgress?.({ stage: 'Preparing installation…' });
  const installed = await installer.install(
    config.rootPassword,
    port,
    (p) =>
      onProgress?.({
        stage: 'Downloading MariaDB installer…',
        percent: p.percent,
        downloaded: p.downloaded,
        total: p.total,
      })
  );
  if (!installed.ok) {
    return installed;
  }

  await new Promise((r) => setTimeout(r, 4000));

  if (config.hostMode) {
    onProgress?.({ stage: 'Configuring host mode…' });
    const subnet = detectSubnet();
    if (!subnet) {
      return {
        ok: false,
        error:
          'Could not detect LAN subnet. Ensure the machine has an active network interface.',
      };
    }
    const svc = await installer.configureService(port);
    if (!svc.ok) {
      return {
        ok: false,
        error: `MariaDB installed, but host-mode configuration failed: ${
          svc.error ?? 'unknown error'
        }`,
      };
    }
    const fw = await installer.configureFirewall(port, subnet);
    if (!fw.ok) {
      return { ok: false, error: fw.error };
    }
  }

  onProgress?.({ stage: 'Creating application user…' });
  const user = await createAppUser(port, config, installer);
  if (!user.ok) {
    return {
      ok: false,
      error: `MariaDB installed, but the application user could not be created: ${
        user.error ?? 'unknown error'
      }`,
    };
  }

  onProgress?.({ stage: 'Verifying application user…' });
  const ping = await pingMariaDB({
    host: '127.0.0.1',
    port,
    user: 'sotrama_app',
    password: config.appPassword,
  });
  if (!ping.ok) {
    return {
      ok: false,
      error: ping.error ?? 'Application user cannot reach the server.',
      port,
    };
  }

  return { ok: true, port };
}

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'win32':
      return 'win';
    case 'darwin':
      return 'mac';
    default:
      return 'linux';
  }
}

export function detectSubnet(): string | null {
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const netmask = (addr as { netmask?: string }).netmask;
        if (netmask) {
          const ipOctets = addr.address.split('.').map(Number);
          const maskOctets = netmask.split('.').map(Number);
          if (ipOctets.length === 4 && maskOctets.length === 4) {
            const fixed: string[] = [];
            for (let i = 0; i < 4; i++) {
              if (maskOctets[i] === 255) {
                fixed.push(String(ipOctets[i]));
              } else {
                break;
              }
            }
            if (fixed.length > 0) {
              return fixed.join('.');
            }
          }
        }
        const octets = addr.address.split('.');
        if (octets.length === 4) {
          return `${octets[0]}.${octets[1]}.${octets[2]}`;
        }
      }
    }
  }
  return null;
}

export function detectLanIp(): string | null {
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

/** Pre-flight check: is port free on 127.0.0.1? */
function isPortAvailable(port: number): Promise<PortCheckResult> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve({ available: false }));
    tester.once('listening', () => {
      tester.close(() => resolve({ available: true }));
    });
    tester.listen(port, '127.0.0.1');
  });
}

export async function probeFreePort(start: number): Promise<number | null> {
  let candidate = start;
  while (candidate < start + 20) {
    const check = await isPortAvailable(candidate);
    if (check.available) {
      return candidate;
    }
    candidate += 1;
  }
  return null;
}

/** Probe whether MariaDB is reachable. */
export async function pingMariaDB(opts: PingOptions): Promise<PingResult> {
  const { host, port } = opts;
  const tcp = await tcpProbe(host, port);
  if (!tcp) {
    return { ok: false, error: `Cannot connect to ${host}:${port} (TCP).` };
  }

  const { spawn } = await import('child_process');
  const cli = await new Promise<{ code: number; out: string; err: string }>(
    (resolve) => {
      const child = spawn('mariadb-admin', [
        '-h',
        host,
        '-P',
        String(port),
        '-u',
        opts.user,
        `-p${opts.password}`,
        'ping',
      ]);
      let out = '';
      let err = '';
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
      child.on('error', (e) => resolve({ code: -1, out, err: e.message }));
    }
  );
  if (cli.code !== 0) {
    if (/ENOENT/i.test(cli.err)) {
      return await pingViaDriver(host, port, opts.user, opts.password);
    }
    return {
      ok: false,
      error: `Server reachable but authentication failed: ${
        cli.err || cli.out
      }`.trim(),
    };
  }
  return { ok: true };
}

async function pingViaDriver(
  host: string,
  port: number,
  user: string,
  password: string
): Promise<PingResult> {
  const mariadb = await import('mariadb');
  let conn;
  try {
    conn = await mariadb.createConnection({ host, port, user, password });
    await conn.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Server reachable but authentication failed: ${
        (err as Error).message
      }`.trim(),
    };
  } finally {
    await conn?.end().catch(() => undefined);
  }
}

function tcpProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(3000);
    socket.once('connect', () => {
      done = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      if (!done) resolve(false);
    });
    socket.once('timeout', () => {
      done = true;
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function createAppUser(
  port: number,
  config: HostProvisionConfig,
  installer: PlatformInstaller
): Promise<OpResult> {
  const safeDb = config.database.replace(/[^a-zA-Z0-9_\-]/g, '').replace(/`/g, '');
  if (!safeDb) {
    return { ok: false, error: 'Invalid database name' };
  }

  let scope = 'localhost';
  if (config.hostMode) {
    const subnet = detectSubnet();
    if (!subnet) {
      return {
        ok: false,
        error:
          'Could not detect LAN subnet. Cannot create host-mode user without a valid network. Ensure the machine has an active LAN interface.',
      };
    }
    scope = `${subnet}.%`;
  }

  return installer.createAppUser(
    port,
    config.rootPassword,
    appUserStatements(safeDb, config.appPassword, scope)
  );
}
