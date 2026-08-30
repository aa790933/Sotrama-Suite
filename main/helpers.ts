import { constants } from 'fs';
import fs from 'fs/promises';
import { ConfigFile } from 'fyo/core/types';
import { Main } from 'main';
import config from 'utils/config';
import { BackendResponse } from 'utils/ipc/types';
import { IPC_CHANNELS } from 'utils/messages';
import type { ConfigFilesWithModified } from 'utils/types';
import {
  fromMariaDBConfigToPersisted,
  parseMariaDBConfigString,
  toConnectionMetadata,
} from 'utils/mariadb-types';
import type {
  ConnectionMetadata,
  PersistedConnection,
} from 'utils/mariadb-types';

function isMariaDBConfigString(value: string): boolean {
  try {
    parseMariaDBConfigString(value);
    return true;
  } catch {
    return false;
  }
}

export async function setAndGetCleanedConfigFiles() {
  const files = config.get('files', []);

  const cleanedFileMap: Map<string, ConfigFile> = new Map();
  for (const file of files) {
    if (!file.companyName) {
      continue;
    }

    const key = `${file.companyName}-${file.dbPath}`;
    if (cleanedFileMap.has(key)) {
      continue;
    }

    // For MariaDB JSON, skip filesystem checks — keep entry if companyName is valid
    // For legacy SQLite paths, verify file accessibility
    if (isMariaDBConfigString(file.dbPath)) {
      cleanedFileMap.set(key, file);
      continue;
    }

    const exists = await fs
      .access(file.dbPath, constants.W_OK)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      continue;
    }

    cleanedFileMap.set(key, file);
  }

  const cleanedFiles = Array.from(cleanedFileMap.values());
  config.set('files', cleanedFiles);
  return cleanedFiles;
}

export async function getConfigFilesWithModified(files: ConfigFile[]) {
  const filesWithModified: ConfigFilesWithModified[] = [];
  for (const { dbPath, id, companyName, openCount } of files) {
    // For MariaDB configs, do not use fs.stat (dbPath is JSON) — use current time
    if (isMariaDBConfigString(dbPath)) {
      filesWithModified.push({
        id,
        dbPath,
        companyName,
        modified: new Date().toISOString(),
        openCount,
      });
      continue;
    }
    try {
      const { mtime } = await fs.stat(dbPath);
      filesWithModified.push({
        id,
        dbPath,
        companyName,
        modified: mtime.toISOString(),
        openCount,
      });
    } catch {
      // If stat fails, still include with current time to avoid losing the entry
      filesWithModified.push({
        id,
        dbPath,
        companyName,
        modified: new Date().toISOString(),
        openCount,
      });
    }
  }

  return filesWithModified;
}

export function getPersistedConnections(): PersistedConnection[] {
  return (config.get('connections' as never) as PersistedConnection[] | undefined) ?? [];
}

export function getConnectionsMetadata(): ConnectionMetadata[] {
  return getPersistedConnections().map(toConnectionMetadata);
}

export function findConnectionById(id: string): PersistedConnection | undefined {
  return getPersistedConnections().find((c) => c.id === id);
}

export function findConnectionByConfig(config: import('utils/mariadb-types').MariaDBConfig): PersistedConnection | undefined {
  return getPersistedConnections().find(
    (c) => c.host === config.host && c.port === config.port && c.database === config.database && c.user === config.user
  );
}

export function upsertConnectionFromConfig(
  companyName: string,
  cfg: import('utils/mariadb-types').MariaDBConfig,
  id?: string
): PersistedConnection {
  const connections = getPersistedConnections();
  let existing: import('utils/mariadb-types').PersistedConnection | undefined;
  if (id) {
    existing = connections.find((c) => c.id === id);
  } else {
    existing = findConnectionByConfig(cfg);
  }
  if (existing) {
    existing.companyName = companyName || existing.companyName;
    existing.host = cfg.host;
    existing.port = cfg.port;
    existing.user = cfg.user;
    existing.database = cfg.database;
    existing.password = cfg.password;
    existing.openCount = (existing.openCount ?? 0) + 1;
    config.set('connections' as never, connections as never);
    return existing;
  }
  const newId = id || `${companyName}-${cfg.host}-${cfg.port}-${cfg.database}-${Date.now()}`.replace(/\s+/g, '_');
  const created = fromMariaDBConfigToPersisted(newId, companyName, cfg, 1);
  connections.push(created);
  config.set('connections' as never, connections as never);
  return created;
}

export function migrateLegacyConnections(): void {
  const connections = getPersistedConnections();
  if (connections.length > 0) return; // already migrated
  const files = config.get('files', []) as ConfigFile[];
  if (!files.length) return;
  let migrated = false;
  for (const file of files) {
    try {
      const cfg = parseMariaDBConfigString(file.dbPath);
      const existing = findConnectionByConfig(cfg);
      if (existing) continue;
      const conn = fromMariaDBConfigToPersisted(file.id, file.companyName, cfg, file.openCount ?? 0);
      connections.push(conn);
      migrated = true;
    } catch {
      // legacy SQLite path, ignore
    }
  }
  if (migrated) {
    config.set('connections' as never, connections as never);
  }
  // Migrate lastSelectedFilePath -> lastSelectedConnectionId
  const last = config.get('lastSelectedFilePath', null) as string | null;
  const lastId = config.get('lastSelectedConnectionId' as never) as string | null | undefined;
  if (last && !lastId) {
    try {
      const cfg = parseMariaDBConfigString(last);
      const found = findConnectionByConfig(cfg);
      if (found) {
        config.set('lastSelectedConnectionId' as never, found.id as never);
      }
    } catch {}
  }
}

export async function getErrorHandledReponse(func: () => unknown) {
  const response: BackendResponse = {};

  try {
    response.data = await func();
  } catch (err) {
    response.error = {
      name: (err as NodeJS.ErrnoException).name,
      message: (err as NodeJS.ErrnoException).message,
      stack: (err as NodeJS.ErrnoException).stack,
      code: (err as NodeJS.ErrnoException).code,
    };
  }

  return response;
}

export function rendererLog(main: Main, ...args: unknown[]) {
  main.mainWindow?.webContents.send(IPC_CHANNELS.CONSOLE_LOG, ...args);
}

export function isNetworkError(error: Error) {
  switch (error?.message) {
    case 'net::ERR_INTERNET_DISCONNECTED':
    case 'net::ERR_NETWORK_CHANGED':
    case 'net::ERR_PROXY_CONNECTION_FAILED':
    case 'net::ERR_CONNECTION_RESET':
    case 'net::ERR_CONNECTION_CLOSE':
    case 'net::ERR_NAME_NOT_RESOLVED':
    case 'net::ERR_TIMED_OUT':
    case 'net::ERR_CONNECTION_TIMED_OUT':
      return true;
    default:
      return false;
  }
}

export function isGitHubApiError(
  error: Error | Record<string, unknown>
): boolean {
  const code =
    (error as Record<string, unknown>)?.statusCode ??
    (error as Record<string, unknown>)?.status ??
    (error as Record<string, unknown>)?.code;
  if (typeof code === 'number' && (code === 403 || code === 404)) {
    return true;
  }
  const msg = (error as { message?: string }).message ?? '';
  return /^(403|404)/.test(msg);
}

export function isExpectedUpdateError(error: Error): boolean {
  return isNetworkError(error) || isGitHubApiError(error);
}
