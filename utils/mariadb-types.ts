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
