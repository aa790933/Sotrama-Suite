import { Main } from 'main';
import config from 'utils/config';
import { BackendResponse } from 'utils/ipc/types';
import { IPC_CHANNELS } from 'utils/messages';
import {
  equalsConnection,
  fromMariaDBConfigToPersisted,
  toConnectionMetadata,
} from 'utils/mariadb-types';
import type {
  ConnectionMetadata,
  PersistedConnection,
} from 'utils/mariadb-types';

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
  return getPersistedConnections().find((c) => equalsConnection(c, config));
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
