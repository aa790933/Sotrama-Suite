import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import sudo from '@vscode/sudo-prompt';
import { downloadFile, ensureCacheDir, sha256 } from '../../utils/packages';
import type {
  DownloadProgressEvent,
  InstallResult,
  Platform,
} from '../../utils/mariadb-types';

export type OpResult = { ok: boolean; error?: string };

/**
 * PlatformInstaller is the seam behind host provisioning. One adapter per OS;
 * the provision core depends only on this interface, never on process.platform.
 */
export interface PlatformInstaller {
  install(
    rootPassword: string,
    port: number,
    onProgress?: (event: DownloadProgressEvent) => void
  ): Promise<InstallResult>;
  configureService(port: number): Promise<OpResult>;
  configureFirewall(port: number, subnet: string): Promise<OpResult>;
  createAppUser(
    port: number,
    rootPassword: string,
    sql: string
  ): Promise<OpResult>;
}

export function forPlatform(platform: Platform): PlatformInstaller {
  switch (platform) {
    case 'win':
      return new WindowsInstaller();
    case 'mac':
      return new MacInstaller();
    default:
      return new LinuxInstaller();
  }
}

class WindowsInstaller implements PlatformInstaller {
  async install(
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

  async configureService(port: number): Promise<OpResult> {
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

  async configureFirewall(port: number, subnet: string): Promise<OpResult> {
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

  async createAppUser(
    port: number,
    rootPassword: string,
    sql: string
  ): Promise<OpResult> {
    return createAppUserViaDriver(port, rootPassword, sql);
  }
}

class MacInstaller implements PlatformInstaller {
  async install(rootPassword: string): Promise<InstallResult> {
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
      const safeRootPw = rootPassword.replace(/'/g, "''").replace(/\r|\n/g, '');
      const sql = await runCommand('mariadb', [
        '-u',
        'root',
        '-e',
        `ALTER USER 'root'@'localhost' IDENTIFIED BY '${safeRootPw}'; FLUSH PRIVILEGES;`,
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

  async configureService(port: number): Promise<OpResult> {
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

  async configureFirewall(): Promise<OpResult> {
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

  async createAppUser(
    _port: number,
    _rootPassword: string,
    sql: string
  ): Promise<OpResult> {
    void _port;
    void _rootPassword;
    const r = await runCommand('mariadb', ['-u', 'root', '-e', sql]);
    if (r.code !== 0) {
      return {
        ok: false,
        error: `mariadb CLI: ${(r.stderr || r.stdout).trim()}`.trim(),
      };
    }
    return { ok: true };
  }
}

class LinuxInstaller implements PlatformInstaller {
  async install(rootPassword: string): Promise<InstallResult> {
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

    const safeRootPw = rootPassword.replace(/'/g, "''").replace(/\r|\n/g, '');

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

  async configureService(port: number): Promise<OpResult> {
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

  async configureFirewall(port: number, subnet: string): Promise<OpResult> {
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

  async createAppUser(
    port: number,
    rootPassword: string,
    sql: string
  ): Promise<OpResult> {
    return createAppUserViaDriver(port, rootPassword, sql);
  }
}

/** Pinned MariaDB LTS release used for the Windows MSI bundle/download. */
export const MARIADB_VERSION = '11.8.8';

const WINDOWS_MSI_URL = `https://dlm.mariadb.com/4707366/MariaDB/mariadb-${MARIADB_VERSION}/winx64-packages/mariadb-${MARIADB_VERSION}-winx64.msi`;
const WINDOWS_MSI_FILENAME = `mariadb-${MARIADB_VERSION}-winx64.msi`;

/**
 * Pinned SHA-256 of the MariaDB Windows MSI.
 * If empty or set to 'skip', checksum verification is bypassed for local/custom builds.
 */
export const MARIADB_MSI_SHA256 =
  '42ee5ab1609031bed58bf19876000fd6c13aca4878126faabc1da490d1fe9ce2';

export function getBundledMsiPath(): string {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  return path.join(
    resourcesPath ?? process.cwd(),
    'mariadb',
    WINDOWS_MSI_FILENAME
  );
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
  const doDownload = async () => {
    await downloadFile(WINDOWS_MSI_URL, dest, (p) =>
      onProgress?.({
        percent: p.percent,
        downloaded: p.downloaded,
        total: p.total,
      })
    );
  };
  if (!fs.pathExistsSync(dest)) {
    try {
      await doDownload();
    } catch {
      await fs.remove(dest).catch(() => undefined);
      await doDownload();
    }
  }
  try {
    await verifyMsi(dest);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/checksum mismatch/i.test(msg)) {
      await fs.remove(dest).catch(() => undefined);
      await doDownload();
      await verifyMsi(dest);
    } else {
      throw err;
    }
  }
  return dest;
}

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

/** Connect as root over TCP (127.0.0.1) and run the provisioning SQL. */
export async function createAppUserViaDriver(
  port: number,
  rootPassword: string,
  sql: string
): Promise<OpResult> {
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

export function appUserStatements(
  database: string,
  appPassword: string,
  host: string
): string {
  const safeAppPw = appPassword.replace(/'/g, "''").replace(/\r|\n/g, '');
  return [
    `CREATE DATABASE IF NOT EXISTS \`${database}\`;`,
    `CREATE DATABASE IF NOT EXISTS \`demo\`;`,
    `CREATE USER IF NOT EXISTS 'sotrama_app'@'${host}' IDENTIFIED BY '${safeAppPw}';`,
    `ALTER USER 'sotrama_app'@'${host}' IDENTIFIED BY '${safeAppPw}';`,
    `GRANT ALL PRIVILEGES ON \`${database}\`.* TO 'sotrama_app'@'${host}';`,
    `GRANT ALL PRIVILEGES ON \`demo\`.* TO 'sotrama_app'@'${host}';`,
    `FLUSH PRIVILEGES;`,
  ].join('\n');
}

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

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

function escapePowerShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "''")}'`;
}

function runElevated(cmd: string, args: string[]): Promise<RunResult> {
  if (process.platform === 'win32') {
    const escapedArgs = args.map(escapePowerShellArg).join(', ');
    // Capture the elevated exit code explicitly: without it powershell.exe
    // exits 0 even when the child (msiexec/netsh) fails, hiding install errors.
    const psCommand = `$p = Start-Process -FilePath ${escapePowerShellArg(cmd)} -ArgumentList @(${escapedArgs}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand];
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

async function brewBin(): Promise<string | null> {
  const r = await runCommand('which', ['brew']);
  const onPath = (r.code === 0 && r.stdout.trim()) || null;
  if (onPath) return onPath;
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    if (fs.pathExistsSync(p)) return p;
  }
  return null;
}

async function brewCellarDir(): Promise<string | null> {
  const brew = await brewBin();
  if (!brew) return null;
  const r = await runCommand(brew, ['--prefix', 'mariadb']);
  if (r.code !== 0) return null;
  return r.stdout.trim() || null;
}

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
