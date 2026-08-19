import { spawn } from 'child_process';
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import sudo from '@vscode/sudo-prompt';
import { ensureCacheDir, downloadFile, sha256 } from '../utils/packages';

import type {
  Platform,
  InstallOptions,
  InstallResult,
  PingOptions,
  PingResult,
  PortCheckResult,
  DownloadProgressEvent,
} from '../utils/mariadb-types';

export type {
  Platform,
  InstallOptions,
  InstallResult,
  PingOptions,
  PingResult,
  PortCheckResult,
  DownloadProgressEvent,
};

/** Pinned MariaDB LTS release used for the Windows MSI bundle/download. */
export const MARIADB_VERSION = '11.8.8';

/** Official MariaDB Windows MSI direct DLM URL. */
const WINDOWS_MSI_URL = `https://dlm.mariadb.com/4707366/MariaDB/mariadb-${MARIADB_VERSION}/winx64-packages/mariadb-${MARIADB_VERSION}-winx64.msi`;
const WINDOWS_MSI_FILENAME = `mariadb-${MARIADB_VERSION}-winx64.msi`;

/**
 * Pinned SHA-256 of the MariaDB Windows MSI.
 * If empty or set to 'skip', checksum verification is bypassed for local/custom builds.
 */
export const MARIADB_MSI_SHA256 =
  '42ee5ab1609031bed58bf19876000fd6c13aca4878126faabc1da490d1fe9ce2';

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

export function getBundledMsiPath(): string {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  return path.join(
    resourcesPath ?? process.cwd(),
    'mariadb',
    WINDOWS_MSI_FILENAME
  );
}

/**
 * Auto-detect the host's primary LAN subnet from active, non-internal
 * IPv4 interfaces. Returns the /24 subnet prefix (e.g. "192.168.1") or
 * null if no suitable interface is found.
 */
export function detectSubnet(): string | null {
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const octets = addr.address.split('.');
        if (octets.length === 4) {
          return `${octets[0]}.${octets[1]}.${octets[2]}`;
        }
      }
    }
  }
  return null;
}

/**
 * Return the first non-loopback IPv4 LAN address of this machine.
 */
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

/** Resolve a local MariaDB MSI: bundled in app resources, otherwise downloaded. */
export async function resolveMsiPath(
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<string> {
  const bundled = getBundledMsiPath();
  if (fs.pathExistsSync(bundled)) {
    await verifyMsi(bundled);
    return bundled;
  }

  const cache = ensureCacheDir();
  const dest = path.join(cache, WINDOWS_MSI_FILENAME);
  if (!fs.pathExistsSync(dest)) {
    await downloadFile(WINDOWS_MSI_URL, dest, (p) =>
      onProgress?.({
        percent: p.percent,
        downloaded: p.downloaded,
        total: p.total,
      })
    );
  }
  await verifyMsi(dest);
  return dest;
}

/** Compute and pin-check the MSI checksum if configured. */
async function verifyMsi(msiPath: string): Promise<void> {
  if (!MARIADB_MSI_SHA256 || (MARIADB_MSI_SHA256 as unknown) === 'skip') {
    return;
  }
  let actual: string;
  try {
    actual = await sha256(msiPath);
  } catch (err) {
    throw new Error(
      `Unable to read MariaDB MSI for verification: ${(err as Error).message}`
    );
  }
  if (actual.toLowerCase() !== MARIADB_MSI_SHA256.toLowerCase()) {
    throw new Error(
      `MariaDB MSI checksum mismatch (expected ${MARIADB_MSI_SHA256}, got ${actual}). Installation aborted.`
    );
  }
}

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/** Run a command as the current (non-privileged) user. */
function runCommand(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on('error', (err) =>
      resolve({ code: -1, stdout, stderr: err.message })
    );
  });
}

/**
 * Run a command with admin/root privileges across Windows, macOS, and Linux.
 */
function runElevated(cmd: string, args: string[]): Promise<RunResult> {
  if (process.platform === 'win32') {
    const joinedArgs = args
      .map((a) => (a.includes(' ') ? `\\"${a}\\"` : a))
      .join(' ');
    const psArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Start-Process -FilePath "${cmd}" -ArgumentList "${joinedArgs}" -Verb RunAs -Wait -PassThru`,
    ];
    return runCommand('powershell.exe', psArgs);
  }

  return new Promise((resolve) => {
    const fullCmd = `${cmd} ${args
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(' ')}`;
    sudo.exec(fullCmd, { name: 'Sotrama Suite' }, (err, stdout, stderr) => {
      resolve({
        code: err ? -1 : 0,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      });
    });
  });
}

/** Returns true when the current process already holds admin/root privileges. */
export async function isElevated(): Promise<boolean> {
  if (process.platform === 'win32') {
    const ps = spawn('whoami', ['/groups', '/fo', 'csv'], {
      windowsHide: true,
    });
    let out = '';
    ps.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number>((res) => {
      ps.on('close', (c) => res(c ?? -1));
      ps.on('error', () => res(-1));
    });
    return code === 0 && out.includes('S-1-16-12288');
  }
  if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
    return true;
  }
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

/** Pre-flight check: is port free on 127.0.0.1? */
export function isPortAvailable(port: number): Promise<PortCheckResult> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve({ available: false }));
    tester.once('listening', () => {
      tester.close(() => resolve({ available: true }));
    });
    tester.listen(port, '127.0.0.1');
  });
}

/** Install MariaDB silently for the current platform. */
export async function installMariaDBSilent(
  opts: InstallOptions,
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<InstallResult> {
  const { platform, rootPassword, appPassword, database, port } = opts;

  const portCheck = await isPortAvailable(port);
  if (!portCheck.available) {
    return {
      ok: false,
      error: `Port ${port} is already in use. Stop the other service first.`,
    };
  }

  let result: InstallResult;
  switch (platform) {
    case 'win':
      result = await installWindows(rootPassword, port, onProgress);
      break;
    case 'mac':
      result = await installMac(rootPassword);
      break;
    default:
      result = await installLinux(rootPassword);
  }

  if (!result.ok) {
    return result;
  }

  // Allow the newly installed service to finish its startup sequence
  await new Promise((r) => setTimeout(r, 4000));

  // Express (host) mode: configure bind-address and firewall
  if (opts.hostMode) {
    const hostResult = await configureHostMode(port, platform);
    if (!hostResult.ok) {
      return {
        ok: false,
        error: `MariaDB installed, but host-mode configuration failed: ${
          hostResult.error ?? 'unknown error'
        }`,
      };
    }
  }

  // Create dedicated least-privilege application user
  const userResult = await createAppUser(
    port,
    rootPassword,
    appPassword,
    database,
    platform,
    opts.hostMode
  );
  if (!userResult.ok) {
    return {
      ok: false,
      error: `MariaDB installed, but the application user could not be created: ${
        userResult.error ?? 'unknown error'
      }`,
    };
  }

  return { ok: true };
}

/**
 * Configure bind-address and firewall in Host Mode.
 */
export async function configureHostMode(
  port: number,
  platform: Platform
): Promise<{ ok: boolean; error?: string }> {
  const subnet = detectSubnet();
  if (!subnet) {
    return {
      ok: false,
      error:
        'Could not detect LAN subnet. Ensure the machine has an active network interface.',
    };
  }

  const bindResult = await setBindAddress(port, platform);
  if (!bindResult.ok) {
    return bindResult;
  }

  const fwResult = await openFirewall(port, platform, subnet);
  if (!fwResult.ok) {
    return fwResult;
  }

  return { ok: true };
}

/** Modify MariaDB's config to listen on 0.0.0.0, then restart. */
async function setBindAddress(
  port: number,
  platform: Platform
): Promise<{ ok: boolean; error?: string }> {
  if (platform === 'win') {
    const cfgPath = path.join(
      process.env.PROGRAMDATA || 'C:\\ProgramData',
      'MariaDB',
      'MariaDB Server',
      `${port}`,
      'my.ini'
    );
    const exists = await fs.pathExists(cfgPath);
    if (!exists) {
      return { ok: false, error: `MariaDB config not found at ${cfgPath}` };
    }
    const content = await fs.readFile(cfgPath, 'utf-8');
    const updated = ensureBindAddress(content, port);
    if (updated === null) {
      return { ok: true };
    }
    await fs.writeFile(cfgPath, updated, 'utf-8');
    await runElevated('cmd.exe', [
      '/c',
      'net stop MariaDB && net start MariaDB',
    ]);
    return { ok: true };
  }

  if (platform === 'mac') {
    const brewPrefix = await brewCellarDir();
    if (!brewPrefix) {
      return { ok: false, error: 'Could not locate MariaDB config directory.' };
    }
    const cfgPath = path.join(brewPrefix, 'my.cnf');
    const exists = await fs.pathExists(cfgPath);
    if (!exists) {
      return { ok: true };
    }
    const content = await fs.readFile(cfgPath, 'utf-8');
    const updated = ensureBindAddress(content, port);
    if (updated === null) {
      return { ok: true };
    }
    await fs.writeFile(cfgPath, updated, 'utf-8');
    const brew = await brewBin();
    if (!brew) {
      return { ok: false, error: 'Homebrew not found after install.' };
    }
    await runCommand(brew, ['services', 'restart', 'mariadb']);
    return { ok: true };
  }

  // Linux: Modify config with elevated permissions
  const cfgPaths = [
    '/etc/mysql/mariadb.conf.d/50-server.cnf',
    '/etc/my.cnf.d/server.cnf',
    '/etc/my.cnf',
  ];

  for (const cfgPath of cfgPaths) {
    if (await fs.pathExists(cfgPath)) {
      const content = await fs.readFile(cfgPath, 'utf-8');
      const updated = ensureBindAddress(content, port);
      if (updated === null) {
        return { ok: true };
      }

      const tmpPath = path.join(os.tmpdir(), `mariadb_${Date.now()}.cnf`);
      await fs.writeFile(tmpPath, updated, 'utf-8');
      const copyRes = await runElevated('cp', [tmpPath, cfgPath]);
      await fs.remove(tmpPath);

      if (copyRes.code !== 0) {
        return {
          ok: false,
          error: `Failed to update config at ${cfgPath}: ${copyRes.stderr}`,
        };
      }
      break;
    }
  }

  const restartRes = await runElevated('systemctl', ['restart', 'mariadb']);
  if (restartRes.code !== 0) {
    return {
      ok: false,
      error: `Failed to restart MariaDB service: ${restartRes.stderr}`,
    };
  }

  return { ok: true };
}

/** Ensure bind-address = 0.0.0.0 is present in the configuration */
function ensureBindAddress(content: string, port: number): string | null {
  const targetBind = '0.0.0.0';
  const currentBind = content.match(
    /bind-address\s*=\s*["']?([^"'\n\r]+)["']?/
  );
  const currentBindValue = currentBind ? currentBind[1].trim() : '127.0.0.1';

  if (currentBindValue === targetBind) {
    return null;
  }

  if (currentBind) {
    return content.replace(
      /bind-address\s*=\s*["']?([^"'\n\r]+)["']?/,
      `bind-address = ${targetBind}`
    );
  }
  return content.replace(
    /(\[server\]\s*\n)/,
    `$1port=${port}\nbind-address = ${targetBind}\n`
  );
}

/** Resolve the Homebrew Cellar prefix for MariaDB config files. */
async function brewCellarDir(): Promise<string | null> {
  const brew = await brewBin();
  if (!brew) return null;
  const r = await runCommand(brew, ['--prefix', 'mariadb']);
  if (r.code !== 0) return null;
  return r.stdout.trim() || null;
}

/**
 * Open the OS firewall for inbound TCP on the MariaDB port, scoped to the detected LAN subnet.
 */
async function openFirewall(
  port: number,
  platform: Platform,
  subnet: string
): Promise<{ ok: boolean; error?: string }> {
  if (platform === 'win') {
    const r = await runElevated('netsh', [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      'name=MariaDB',
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${port}`,
      `remoteip=${subnet}.0/24`,
    ]);
    if (r.code !== 0) {
      return { ok: false, error: `Firewall rule failed: ${r.stderr}` };
    }
    return { ok: true };
  }

  if (platform === 'mac') {
    const mariaBinPaths = [
      '/usr/local/mariadb/bin/mariadbd',
      '/opt/homebrew/bin/mariadbd',
      '/usr/local/sbin/mariadbd',
    ];
    for (const binPath of mariaBinPaths) {
      if (await fs.pathExists(binPath)) {
        await runElevated('/usr/libexec/ApplicationFirewall/socketfilterfw', [
          '--add',
          binPath,
        ]);
        break;
      }
    }
    return { ok: true };
  }

  // Linux: UFW first, then fallback to iptables
  const ufw = await runCommand('which', ['ufw']);
  if (ufw.code === 0) {
    const r = await runElevated('ufw', [
      'allow',
      'from',
      `${subnet}.0/24`,
      'to',
      'any',
      'port',
      `${port}`,
      'proto',
      'tcp',
    ]);
    if (r.code !== 0) {
      return { ok: false, error: `UFW rule failed: ${r.stderr}` };
    }
    return { ok: true };
  }

  // Fallback: iptables
  const r = await runElevated('iptables', [
    '-A',
    'INPUT',
    '-p',
    'tcp',
    '-s',
    `${subnet}.0/24`,
    '--dport',
    `${port}`,
    '-j',
    'ACCEPT',
  ]);
  if (r.code !== 0) {
    return { ok: false, error: `iptables rule failed: ${r.stderr}` };
  }
  return { ok: true };
}

/**
 * Create a least-privilege application user scoped to the app's database(s).
 */
async function createAppUser(
  port: number,
  rootPassword: string,
  appPassword: string,
  database: string,
  platform: Platform,
  hostMode = false
): Promise<{ ok: boolean; error?: string }> {
  const safeDb = database.replace(/`/g, '');
  const safeAppPw = appPassword
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r|\n/g, '');

  let sotramaAppHost: string;
  if (hostMode) {
    const subnet = detectSubnet();
    sotramaAppHost = subnet ? `${subnet}.%` : '%';
  } else {
    sotramaAppHost = 'localhost';
  }

  const statements = [
    `CREATE DATABASE IF NOT EXISTS \`${safeDb}\`;`,
    `CREATE DATABASE IF NOT EXISTS \`demo\`;`,
    `CREATE USER IF NOT EXISTS 'sotrama_app'@'${sotramaAppHost}' IDENTIFIED BY '${safeAppPw}';`,
    `ALTER USER 'sotrama_app'@'${sotramaAppHost}' IDENTIFIED BY '${safeAppPw}';`,
    `GRANT ALL PRIVILEGES ON \`${safeDb}\`.* TO 'sotrama_app'@'${sotramaAppHost}';`,
    `GRANT ALL PRIVILEGES ON \`demo\`.* TO 'sotrama_app'@'${sotramaAppHost}';`,
    `FLUSH PRIVILEGES;`,
  ].join('\n');

  if (platform === 'mac') {
    const r = await runCommand('mariadb', ['-u', 'root', '-e', statements]);
    if (r.code !== 0) {
      return {
        ok: false,
        error: `mariadb CLI: ${(r.stderr || r.stdout).trim()}`.trim(),
      };
    }
    return { ok: true };
  }

  return createAppUserViaDriver(port, rootPassword, statements);
}

/** Connect as root over TCP (127.0.0.1) and run the provisioning SQL. */
async function createAppUserViaDriver(
  port: number,
  rootPassword: string,
  sql: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { createPool } = await import('mariadb');
    const pool = createPool({
      host: '127.0.0.1',
      port,
      user: 'root',
      password: rootPassword,
      connectionLimit: 1,
      multipleStatements: true,
    });
    const conn = await pool.getConnection();
    try {
      await conn.query(sql);
    } finally {
      await conn.release();
      await pool.end();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function installWindows(
  rootPassword: string,
  port: number,
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<InstallResult> {
  const msiPath = await resolveMsiPath(onProgress);
  const args = [
    '/i',
    msiPath,
    '/qn',
    '/norestart',
    'SERVICENAME=MariaDB',
    `PORT=${port}`,
    `PASSWORD=${rootPassword}`,
  ];

  const r = await runElevated('msiexec.exe', args);
  if (r.code !== 0) {
    return {
      ok: false,
      error: `msiexec failed (exit ${r.code})`,
      log: r.stderr || r.stdout,
    };
  }
  return { ok: true };
}

/** Resolve the Homebrew binary path. */
async function brewBin(): Promise<string | null> {
  const r = await runCommand('which', ['brew']);
  const onPath = (r.code === 0 && r.stdout.trim()) || null;
  if (onPath) return onPath;
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    if (fs.pathExistsSync(p)) return p;
  }
  return null;
}

async function installMac(rootPassword: string): Promise<InstallResult> {
  let brewPath = await brewBin();
  if (!brewPath) {
    const script =
      'export NONINTERACTIVE=1; curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash';
    const bootstrap = await runCommand('bash', ['-c', script]);
    if (bootstrap.code !== 0) {
      return {
        ok: false,
        error: 'Homebrew could not be bootstrapped.',
        log: `${bootstrap.stdout}\n${bootstrap.stderr}`,
      };
    }
    brewPath = await brewBin();
    if (!brewPath) {
      return {
        ok: false,
        error:
          'Homebrew was installed but could not be located on PATH. Install it manually from https://brew.sh then retry.',
      };
    }
  }

  const brew = await runCommand(brewPath, ['install', 'mariadb']);
  if (brew.code !== 0) {
    return {
      ok: false,
      error: 'Homebrew is installed but failed to install MariaDB.',
      log: `${brew.stdout}\n${brew.stderr}`,
    };
  }

  const start = await runCommand(brewPath, ['services', 'start', 'mariadb']);
  if (start.code !== 0) {
    return {
      ok: false,
      error: 'Failed to start MariaDB service.',
      log: start.stderr,
    };
  }

  await new Promise((r) => setTimeout(r, 3000));

  const setPw = await runCommand('mariadb-admin', [
    '-u',
    'root',
    'password',
    rootPassword,
  ]);
  if (setPw.code !== 0) {
    const sql = await runCommand('mariadb', [
      '-u',
      'root',
      '-e',
      `ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}'; FLUSH PRIVILEGES;`,
    ]);
    if (sql.code !== 0) {
      return {
        ok: false,
        error: 'Could not set root password.',
        log: setPw.stderr + sql.stderr,
      };
    }
  }

  return { ok: true };
}

async function installLinux(rootPassword: string): Promise<InstallResult> {
  const isApt = await runCommand('which', ['apt-get']);
  const isDnf = await runCommand('which', ['dnf']);

  const installer =
    isApt.code === 0 ? 'apt-get' : isDnf.code === 0 ? 'dnf' : null;
  if (!installer) {
    return {
      ok: false,
      error: 'Unsupported Linux distribution (need apt-get or dnf).',
    };
  }

  const args =
    installer === 'apt-get'
      ? ['install', '-y', '--no-install-recommends', 'mariadb-server']
      : ['install', '-y', 'mariadb-server'];

  const result = await runElevated(installer, args);
  if (result.code !== 0) {
    return {
      ok: false,
      error: `${installer} install failed`,
      log: result.stderr || result.stdout,
    };
  }

  const svc = await runElevated('systemctl', ['enable', '--now', 'mariadb']);
  if (svc.code !== 0) {
    return {
      ok: false,
      error: 'Failed to enable/start MariaDB service.',
      log: svc.stderr,
    };
  }

  // Standard syntax for modern MariaDB (10.4+ / 11.x)
  const safeRootPw = rootPassword
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r|\n/g, '');

  const alt = await runElevated('mariadb', [
    '-u',
    'root',
    '-e',
    `ALTER USER 'root'@'localhost' IDENTIFIED BY '${safeRootPw}'; FLUSH PRIVILEGES;`,
  ]);

  if (alt.code !== 0) {
    return {
      ok: false,
      error: 'Could not set root password.',
      log: alt.stderr || alt.stdout,
    };
  }

  return { ok: true };
}

/** Probe whether MariaDB is reachable. */
export async function pingMariaDB(opts: PingOptions): Promise<PingResult> {
  const { host, port } = opts;
  const tcp = await tcpProbe(host, port);
  if (!tcp) {
    return { ok: false, error: `Cannot connect to ${host}:${port} (TCP).` };
  }

  const cli = await runCommand('mariadb-admin', [
    '-h',
    host,
    '-P',
    String(port),
    '-u',
    opts.user,
    `-p${opts.password}`,
    'ping',
  ]);
  if (cli.code !== 0) {
    return {
      ok: false,
      error: `Server reachable but authentication failed: ${
        cli.stderr || cli.stdout
      }`.trim(),
    };
  }
  return { ok: true };
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

export const isOs = os;
export { fs };
