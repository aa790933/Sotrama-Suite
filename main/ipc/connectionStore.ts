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

type ConnectionStoreHelpers = Pick<
  typeof import('../helpers'),
  | 'findConnectionById'
  | 'getPersistedConnections'
  | 'getConnectionsMetadata'
  | 'upsertConnectionFromConfig'
>;
type ConnectionStoreConfig = Pick<typeof import('utils/config').default, 'set'>;

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
  /** Patch display metadata (companyName/openCount) on an existing row. Returns false when unknown. */
  setMeta(
    id: string,
    patch: { companyName?: string; openCount?: number }
  ): boolean;
  getDbList(): Promise<unknown>;
  setLastSelected(id: string): void;
  /** Resolve a connection id or JSON string to its config, persisting as needed. */
  resolve(input: string): MariaDBConfig;
}

// Production adapter — wraps the existing helpers + config store
export class ElectronStoreConnectionStore implements ConnectionStore {
  constructor(
    private readonly helpers: ConnectionStoreHelpers,
    private readonly config: ConnectionStoreConfig
  ) {}

  findById(id: string): PersistedConnection | undefined {
    return this.helpers.findConnectionById(id);
  }

  getAll(): PersistedConnection[] {
    return this.helpers.getPersistedConnections();
  }

  getMetadata(): ConnectionMetadata[] {
    return this.helpers.getConnectionsMetadata();
  }

  upsert(companyName: string, config: MariaDBConfig): PersistedConnection {
    return this.helpers.upsertConnectionFromConfig(companyName, config);
  }

  deleteById(id: string): void {
    const conns = this.helpers.getPersistedConnections();
    const filtered = conns.filter((c) => c.id !== id);
    this.config.set('connections' as never, filtered as never);
  }

  setMeta(
    id: string,
    patch: { companyName?: string; openCount?: number }
  ): boolean {
    const conns = this.helpers.getPersistedConnections();
    const conn = conns.find((c) => c.id === id);
    if (!conn) {
      return false;
    }
    if (typeof patch.companyName === 'string' && patch.companyName) {
      conn.companyName = patch.companyName;
    }
    if (typeof patch.openCount === 'number') {
      conn.openCount = patch.openCount;
    }
    this.config.set('connections' as never, conns as never);
    return true;
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
    this.config.set('lastSelectedConnectionId' as never, id as never);
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
    const conn = this.helpers.upsertConnectionFromConfig(cfg.database, cfg);
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
    const id =
      `${companyName}-${config.host}-${config.port}-${config.database}-${Date.now()}`.replace(
        /\s+/g,
        '_'
      );
    const created = fromMariaDBConfigToPersisted(id, companyName, config, 1);
    this.conns.set(id, created);
    return created;
  }

  deleteById(id: string): void {
    this.conns.delete(id);
  }

  setMeta(
    id: string,
    patch: { companyName?: string; openCount?: number }
  ): boolean {
    const conn = this.conns.get(id);
    if (!conn) {
      return false;
    }
    if (typeof patch.companyName === 'string' && patch.companyName) {
      conn.companyName = patch.companyName;
    }
    if (typeof patch.openCount === 'number') {
      conn.openCount = patch.openCount;
    }
    return true;
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
