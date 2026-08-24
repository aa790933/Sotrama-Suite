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
