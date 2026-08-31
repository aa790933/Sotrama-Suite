import type { PersistedConnection, ConnectionMetadata, MariaDBConfig } from '../../utils/mariadb-types';

/**
 * Small ConnectionStore seam — abstracts PersistedConnection persistence.
 * Two adapters: ElectronStoreConnectionStore (prod, wraps electron-store via utils/config)
 * and InMemoryConnectionStore (test, plain Map). IpcRouter depends on this interface,
 * not on main/helpers.ts → utils/config.ts → electron-store chain.
 */
export interface ConnectionStore {
  findById(id: string): PersistedConnection | undefined;
  getAll(): PersistedConnection[];
  getMetadata(): ConnectionMetadata[];
  upsert(companyName: string, config: MariaDBConfig): PersistedConnection;
  deleteById(id: string): void;
  migrateLegacy(): void;
  getDbList(): Promise<unknown>;
  setLastSelected(id: string, rawJsonForLegacy?: string): void;
}

// Production adapter — wraps the existing helpers + config store
export class ElectronStoreConnectionStore implements ConnectionStore {
  findById(id: string): PersistedConnection | undefined {
    // Lazy import to avoid pulling electron-store at module load time in tests
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { findConnectionById } = require('../helpers') as typeof import('../helpers');
    return findConnectionById(id);
  }

  getAll(): PersistedConnection[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPersistedConnections } = require('../helpers') as typeof import('../helpers');
    return getPersistedConnections();
  }

  getMetadata(): ConnectionMetadata[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getConnectionsMetadata } = require('../helpers') as typeof import('../helpers');
    return getConnectionsMetadata();
  }

  upsert(companyName: string, config: MariaDBConfig): PersistedConnection {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { upsertConnectionFromConfig } = require('../helpers') as typeof import('../helpers');
    return upsertConnectionFromConfig(companyName, config);
  }

  deleteById(id: string): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPersistedConnections } = require('../helpers') as typeof import('../helpers');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('utils/config').default as typeof import('utils/config').default;
    const conns = getPersistedConnections();
    const filtered = conns.filter((c) => c.id !== id);
    config.set('connections' as never, filtered as never);
    const files = (config.get('files', []) as import('fyo/core/types').ConfigFile[]).filter((f) => f.id !== id);
    config.set('files', files);
  }

  migrateLegacy(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { migrateLegacyConnections } = require('../helpers') as typeof import('../helpers');
    migrateLegacyConnections();
  }

  async getDbList(): Promise<unknown> {
    this.migrateLegacy();
    const metas = this.getMetadata();
    if (metas.length > 0) {
      return metas.map((m) => ({
        id: m.id,
        companyName: m.companyName,
        dbPath: m.id,
        openCount: m.openCount,
        modified: m.modified ?? new Date().toISOString(),
        display: m.display,
        host: m.host,
        port: m.port,
        database: m.database,
        user: m.user,
      }));
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setAndGetCleanedConfigFiles, getConfigFilesWithModified } = require('../helpers') as typeof import('../helpers');
    const files = await setAndGetCleanedConfigFiles();
    return getConfigFilesWithModified(files);
  }

  setLastSelected(id: string, rawJsonForLegacy?: string): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('utils/config').default as typeof import('utils/config').default;
    config.set('lastSelectedConnectionId' as never, id as never);
    if (rawJsonForLegacy) {
      config.set('lastSelectedFilePath' as never, rawJsonForLegacy as never);
    }
  }
}

// Test adapter — plain in-memory Map, no electron/store
export class InMemoryConnectionStore implements ConnectionStore {
  private conns = new Map<string, PersistedConnection>();
  private lastSelected: string | null = null;

  findById(id: string): PersistedConnection | undefined {
    return this.conns.get(id);
  }

  getAll(): PersistedConnection[] {
    return Array.from(this.conns.values());
  }

  getMetadata(): ConnectionMetadata[] {
    return this.getAll().map((c) => ({
      id: c.id,
      companyName: c.companyName,
      host: c.host,
      port: c.port,
      user: c.user,
      database: c.database,
      openCount: c.openCount,
      display: `${c.database} @ ${c.host}:${c.port} (${c.user})`,
      modified: c.createdAt,
    }));
  }

  upsert(companyName: string, config: MariaDBConfig): PersistedConnection {
    const existing = Array.from(this.conns.values()).find(
      (c) => c.host === config.host && c.port === config.port && c.database === config.database && c.user === config.user
    );
    if (existing) {
      existing.companyName = companyName || existing.companyName;
      existing.host = config.host;
      existing.port = config.port;
      existing.user = config.user;
      existing.database = config.database;
      existing.password = config.password;
      existing.openCount = (existing.openCount ?? 0) + 1;
      return existing;
    }
    const id = `${companyName}-${config.host}-${config.port}-${config.database}-${Date.now()}`.replace(/\s+/g, '_');
    const { fromMariaDBConfigToPersisted } = require('../../utils/mariadb-types') as typeof import('../../utils/mariadb-types');
    const created = fromMariaDBConfigToPersisted(id, companyName, config, 1);
    this.conns.set(id, created);
    return created;
  }

  deleteById(id: string): void {
    this.conns.delete(id);
  }

  migrateLegacy(): void {
    // no-op for in-memory
  }

  async getDbList(): Promise<unknown> {
    return this.getMetadata().map((m) => ({
      id: m.id,
      companyName: m.companyName,
      dbPath: m.id,
      openCount: m.openCount,
      modified: m.modified ?? new Date().toISOString(),
      display: m.display,
      host: m.host,
      port: m.port,
      database: m.database,
      user: m.user,
    }));
  }

  setLastSelected(id: string): void {
    this.lastSelected = id;
  }
}
