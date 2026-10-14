import config from 'utils/config';
import { IPC_CHANNELS } from 'utils/messages';
import {
  equalsConnection,
  fromMariaDBConfigToPersisted,
  toConnectionMetadata,
} from 'utils/mariadb-types';

/** @typedef {import('utils/mariadb-types').PersistedConnection} PersistedConnection */
/** @typedef {import('utils/mariadb-types').ConnectionMetadata} ConnectionMetadata */
/** @typedef {import('utils/mariadb-types').MariaDBConfig} MariaDBConfig */

/** @returns {PersistedConnection[]} */
export function getPersistedConnections() {
  const connections = config.get('connections');
  return Array.isArray(connections) ? connections : [];
}

/** @returns {ConnectionMetadata[]} */
export function getConnectionsMetadata() {
  return getPersistedConnections().map(toConnectionMetadata);
}

/** @param {string} id @returns {PersistedConnection | undefined} */
export function findConnectionById(id) {
  return getPersistedConnections().find((connection) => connection.id === id);
}

/** @param {MariaDBConfig} connectionConfig @returns {PersistedConnection | undefined} */
export function findConnectionByConfig(connectionConfig) {
  return getPersistedConnections().find((connection) =>
    equalsConnection(connection, connectionConfig)
  );
}

/**
 * @param {string} companyName
 * @param {MariaDBConfig} connectionConfig
 * @param {string} [id]
 * @returns {PersistedConnection}
 */
export function upsertConnectionFromConfig(companyName, connectionConfig, id) {
  const connections = getPersistedConnections();
  const existing = id
    ? connections.find((connection) => connection.id === id)
    : findConnectionByConfig(connectionConfig);

  if (existing) {
    existing.companyName = companyName || existing.companyName;
    existing.host = connectionConfig.host;
    existing.port = connectionConfig.port;
    existing.user = connectionConfig.user;
    existing.database = connectionConfig.database;
    existing.password = connectionConfig.password;
    existing.openCount = (existing.openCount ?? 0) + 1;
    config.set('connections', connections);
    return existing;
  }

  const newId = id || `${companyName}-${connectionConfig.host}-${connectionConfig.port}-${connectionConfig.database}-${Date.now()}`.replace(/\s+/g, '_');
  const created = fromMariaDBConfigToPersisted(newId, companyName, connectionConfig, 1);
  connections.push(created);
  config.set('connections', connections);
  return created;
}

/** @param {() => unknown | Promise<unknown>} func */
export async function getErrorHandledReponse(func) {
  try {
    return { data: await func() };
  } catch (error) {
    const value = error instanceof Error ? error : new Error(String(error));
    return {
      error: {
        name: value.name,
        message: value.message,
        stack: value.stack,
        code: typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined,
      },
    };
  }
}

/** @param {{ mainWindow?: import('electron').BrowserWindow | null }} main @param {...unknown} args */
export function rendererLog(main, ...args) {
  main.mainWindow?.webContents.send(IPC_CHANNELS.CONSOLE_LOG, ...args);
}

/** @param {unknown} error */
export function isNetworkError(error) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '';
  return new Set([
    'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_NETWORK_CHANGED',
    'net::ERR_PROXY_CONNECTION_FAILED',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_CONNECTION_CLOSE',
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_TIMED_OUT',
    'net::ERR_CONNECTION_TIMED_OUT',
  ]).has(message);
}

/** @param {unknown} error */
export function isGitHubApiError(error) {
  if (!error || typeof error !== 'object') return false;
  const value = /** @type {Record<string, unknown>} */ (error);
  const code = value.statusCode ?? value.status ?? value.code;
  if (code === 403 || code === 404 || code === '403' || code === '404') return true;
  const message = typeof value.message === 'string' ? value.message : '';
  return /^(403|404)(?:\b|\s|:)/.test(message);
}

/** @param {unknown} error */
export function isExpectedUpdateError(error) {
  return isNetworkError(error) || isGitHubApiError(error);
}
