import type { MariaDBConfig } from '../../utils/mariadb-types';
import type { FieldValueMap } from '../../backend/database/types';
import type { GetAllOptions, QueryFilter } from '../../utils/db/types';
import type { SchemaMap } from '../../schemas/types';
import { RustBackendClient } from './rustBackendClient';

/** Database surface consumed by the main-process IPC router. */
export interface RouterDatabase {
  setDbConfig(config: MariaDBConfig): void;
  createNewDatabase(dbPath: string, countryCode: string): Promise<string>;
  connectToDatabase(dbPath: string, countryCode?: string): Promise<string>;
  getSchemaMap(): SchemaMap | Promise<SchemaMap>;
  insert(schemaName: string, values: FieldValueMap): Promise<unknown>;
  get(schemaName: string, name: string, fields?: string | string[]): Promise<unknown>;
  getAll(schemaName: string, options?: GetAllOptions): Promise<unknown[]>;
  getSingleValues(...fields: ({ fieldname: string; parent?: string } | string)[]): Promise<unknown[]>;
  rename(schemaName: string, oldName: string, newName: string): Promise<void>;
  update(schemaName: string, values: FieldValueMap): Promise<void>;
  delete(schemaName: string, name: string): Promise<void>;
  deleteAll(schemaName: string, filters: QueryFilter): Promise<number>;
  exists(schemaName: string, name?: string): Promise<boolean>;
  close(): Promise<void>;
  count(schemaName: string, options?: GetAllOptions): Promise<number>;
  getNextAutoincrementId(schemaName: string): Promise<number>;
  getNextSeriesValue(prefix: string, schemaName: string): Promise<number>;
}

/** Routes the existing database contract through the Rust JSON-RPC sidecar. */
export class RustDatabaseAdapter implements RouterDatabase {
  private config: MariaDBConfig | null = null;
  private readonly client: RustBackendClient;

  constructor(client = new RustBackendClient()) {
    this.client = client;
  }

  setDbConfig(config: MariaDBConfig): void {
    this.config = config;
  }

  async createNewDatabase(_dbPath: string, countryCode: string): Promise<string> {
    return this.start(countryCode, true);
  }

  async connectToDatabase(_dbPath: string, countryCode?: string): Promise<string> {
    return this.start(countryCode ?? '', false);
  }

  async getSchemaMap(): Promise<SchemaMap> {
    return await this.client.schema<SchemaMap>();
  }

  async insert(schemaName: string, values: FieldValueMap): Promise<unknown> {
    return this.client.call('insert', schemaName, values);
  }

  async get(schemaName: string, name: string, fields?: string | string[]): Promise<unknown> {
    return this.client.call('get', schemaName, name, fields);
  }

  async getAll(schemaName: string, options: GetAllOptions = {}): Promise<unknown[]> {
    return this.client.call('getAll', schemaName, options);
  }

  async getSingleValues(...fields: ({ fieldname: string; parent?: string } | string)[]): Promise<unknown[]> {
    return this.client.call('getSingleValues', ...fields);
  }

  async rename(schemaName: string, oldName: string, newName: string): Promise<void> {
    await this.client.call('rename', schemaName, oldName, newName);
  }

  async update(schemaName: string, values: FieldValueMap): Promise<void> {
    await this.client.call('update', schemaName, values);
  }

  async delete(schemaName: string, name: string): Promise<void> {
    await this.client.call('delete', schemaName, name);
  }

  async deleteAll(schemaName: string, filters: QueryFilter): Promise<number> {
    return this.client.call('deleteAll', schemaName, filters);
  }

  async exists(schemaName: string, name?: string): Promise<boolean> {
    return this.client.call('exists', schemaName, name);
  }

  async close(): Promise<void> {
    await this.client.stop();
  }

  async count(schemaName: string, options: GetAllOptions = {}): Promise<number> {
    return this.client.call('count', schemaName, options);
  }

  async getNextAutoincrementId(schemaName: string): Promise<number> {
    return this.client.call('getNextAutoincrementId', schemaName);
  }

  async getNextSeriesValue(prefix: string, schemaName: string): Promise<number> {
    return this.client.call('getNextSeriesValue', prefix, schemaName);
  }

  private async start(countryCode: string, createDatabase: boolean): Promise<string> {
    if (!this.config) throw new Error('Database configuration must be set before connecting.');
    return this.client.connect(this.config, countryCode, createDatabase);
  }
}
