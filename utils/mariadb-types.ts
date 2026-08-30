/**
 * Shared MariaDB onboarding types.
 * Lives in root `utils/` so both the main process (`../utils/...`) and the
 * renderer (`utils/...`) can import the same shape.
 */
export type Platform = 'win' | 'mac' | 'linux';

export interface InstallOptions {
  platform: Platform;
  rootPassword: string;
  appPassword: string;
  port: number;
  database: string;
  hostMode?: boolean;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  log?: string;
}

export interface PingOptions {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface PingResult {
  ok: boolean;
  error?: string;
}

export interface PortCheckResult {
  available: boolean;
  error?: string;
}

export interface DownloadProgressEvent {
  percent: number;
  downloaded: number;
  total: number;
}

export interface MariaDBConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Strictly parse and minimally validate a serialized MariaDBConfig.
 * HostSetup.vue is the canonical producer (JSON.stringify). All main-process
 * IPC handlers must go through this helper — do not accept raw objects.
 */
export function parseMariaDBConfigString(json: string): MariaDBConfig {
  if (typeof json !== 'string') {
    throw new TypeError('MariaDBConfig must be a JSON string');
  }
  const parsed = JSON.parse(json) as MariaDBConfig;
  if (
    typeof parsed.host !== 'string' ||
    !parsed.host ||
    typeof parsed.port !== 'number' ||
    !Number.isFinite(parsed.port) ||
    typeof parsed.user !== 'string' ||
    !parsed.user ||
    typeof parsed.password !== 'string' ||
    typeof parsed.database !== 'string' ||
    !parsed.database
  ) {
    throw new Error('Invalid MariaDBConfig: missing required fields');
  }
  return parsed;
}

export interface PersistedConnection {
  id: string;
  companyName: string;
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  openCount: number;
  createdAt?: string;
}

export interface ConnectionMetadata {
  id: string;
  companyName: string;
  host: string;
  port: number;
  user: string;
  database: string;
  openCount: number;
  display: string;
  modified?: string;
}

export function toConnectionMetadata(conn: PersistedConnection): ConnectionMetadata {
  return {
    id: conn.id,
    companyName: conn.companyName,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    database: conn.database,
    openCount: conn.openCount,
    display: `${conn.database} @ ${conn.host}:${conn.port} (${conn.user})`,
    modified: conn.createdAt,
  };
}

export function fromMariaDBConfigToPersisted(
  id: string,
  companyName: string,
  config: MariaDBConfig,
  openCount = 0
): PersistedConnection {
  return {
    id,
    companyName,
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    password: config.password,
    openCount,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generic, non-sensitive label used whenever a stored value cannot be parsed
 * as a MariaDBConfig. Raw input is never echoed back: it may be malformed
 * JSON that contains credentials, and truncation can still expose them.
 */
export const INVALID_CONFIG_LABEL = 'Invalid configuration';

/**
 * Returns a safe, non-secret display string for a MariaDBConfig JSON.
 * Never includes password. Used for title bars, lists, and dialogs.
 * Falls back to a generic label if parsing fails — never raw input.
 */
export function getSafeConfigDisplay(dbPath: string): string {
  try {
    const cfg = parseMariaDBConfigString(dbPath);
    return `${cfg.database} @ ${cfg.host}:${cfg.port} (${cfg.user})`;
  } catch {
    if (!dbPath) return '';
    return INVALID_CONFIG_LABEL;
  }
}

/**
 * Returns a safe detail string for error dialogs — never includes password,
 * and never echoes raw configuration on parse failure.
 */
export function getSafeConfigDetail(dbPath: string): string {
  try {
    const cfg = parseMariaDBConfigString(dbPath);
    return `Database "${cfg.database}" on ${cfg.host}:${cfg.port} (user: ${cfg.user})`;
  } catch {
    return INVALID_CONFIG_LABEL;
  }
}
