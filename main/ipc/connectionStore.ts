import {
  equalsConnection,
  fromMariaDBConfigToPersisted,
  parseMariaDBConfigString,
  toConnectionMetadata,
  type ConnectionMetadata,
  type MariaDBConfig,
  type PersistedConnection,
} from '../../utils/mariadb-types';
import { sanitizeDatabaseName } from './policies';

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
  getDbList(): Promise<unknown>;
  setLastSelected(id: string): void;
  /** Resolve a connection id or JSON string to its config, persisting as needed. */
  resolve(input: string): MariaDBConfig;
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const config = require('utils/config').default as typeof import('utils/config').default;
    const conns = getPersistedConnections();
    const filtered = conns.filter((c) => c.id !== id);
    config.set('connections' as never, filtered as never);
  }

  getDbList(): Promise<unknown> {
    return Promise.resolve(
      this.getMetadata().map((m) => ({
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
      }))
    );
  }

  setLastSelected(id: string): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const config = require('utils/config').default as typeof import('utils/config').default;
    config.set('lastSelectedConnectionId' as never, id as never);
  }

  resolve(input: string): MariaDBConfig {
    const byId = this.findById(input);
    if (byId) {
      this.setLastSelected(byId.id);
      return {
        host: byId.host,
        port: byId.port,
        user: byId.user,
        password: byId.password,
        database: byId.database,
      };
    }
    const cfg = parseMariaDBConfigString(input);
    sanitizeDatabaseName(cfg.database);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { upsertConnectionFromConfig } = require('../helpers') as typeof import('../helpers');
    const conn = upsertConnectionFromConfig(cfg.database, cfg);
    this.setLastSelected(conn.id);
    return cfg;
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
    return this.getAll().map(toConnectionMetadata);
  }

  upsert(companyName: string, config: MariaDBConfig): PersistedConnection {
    const existing = Array.from(this.conns.values()).find((c) =>
      equalsConnection(c, config)
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
    const created = fromMariaDBConfigToPersisted(id, companyName, config, 1);
    this.conns.set(id, created);
    return created;
  }

  deleteById(id: string): void {
    this.conns.delete(id);
  }

  getDbList(): Promise<unknown> {
    return Promise.resolve(
      this.getMetadata().map((m) => ({
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
      }))
    );
  }

  setLastSelected(id: string): void {
    this.lastSelected = id;
  }

  resolve(input: string): MariaDBConfig {
    const byId = this.findById(input);
    if (byId) {
      this.setLastSelected(byId.id);
      return {
        host: byId.host,
        port: byId.port,
        user: byId.user,
        password: byId.password,
        database: byId.database,
      };
    }
    const cfg = parseMariaDBConfigString(input);
    sanitizeDatabaseName(cfg.database);
    const conn = this.upsert(cfg.database, cfg);
    this.setLastSelected(conn.id);
    return cfg;
  }
}
