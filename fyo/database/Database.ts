import { SchemaMap } from 'schemas/types';
import { DatabaseBase, GetAllOptions, QueryFilter } from 'utils/db/types';
import { FieldValueMap } from 'backend/database/types';
import { DocValue, DocValueMap } from 'fyo/core/types';

export type StockQuery = {
  item: string;
  location?: string;
  batch?: string;
  serialNumbers?: string[];
  fromDate?: string;
  toDate?: string;
};

/**
 * Typed Database interface at the external Fyo.db seam.
 *
 * This is the seam callers (Doc, models, src/utils) depend on.
 * Both the production IpcDatabaseAdapter (renderer → IPC → Main Core)
 * and the test MemoryDatabaseAdapter satisfy this same interface.
 *
 * Two-adapter proof: one interface, two adapters.
 * IPC/maria pool remains an internal implementation detail.
 */
export interface Database extends DatabaseBase {
  // Lifecycle — previously on DatabaseDemuxBase, now part of the typed seam
  getSchemaMap(): Promise<SchemaMap>;
  createNewDatabase(dbPath: string, countryCode: string): Promise<string>;
  connectToDatabase(dbPath: string, countryCode?: string): Promise<string>;

  // Typed CRUD — external seam works with DocValueMap (Raw hidden inside adapters)
  insert(schemaName: string, docValueMap: DocValueMap): Promise<DocValueMap>;
  get(schemaName: string, name: string, fields?: string | string[]): Promise<DocValueMap>;
  getAll(schemaName: string, options?: GetAllOptions): Promise<DocValueMap[]>;
  getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<{ fieldname: string; parent: string; value: DocValue }[]>;
  update(schemaName: string, docValueMap: DocValueMap): Promise<void>;
  // getAllRaw intentionally leaks RawValueMap for callers that genuinely need it (search, export)
  getAllRaw(schemaName: string, options?: GetAllOptions): Promise<FieldValueMap[]>;
  count(schemaName: string, options?: GetAllOptions): Promise<number>;

  // Typed persistence — genuine DB ownership (FOR UPDATE / transaction)
  getNextAutoincrementId(schemaName: string): Promise<number>;
  getNextSeriesValue(prefix: string, schemaName: string): Promise<number>;
  getStockQuantity(query: StockQuery): Promise<number | null>;
  getStockQuantity(
    item: string,
    location?: string,
    fromDate?: string,
    toDate?: string,
    batch?: string,
    serialNumbers?: string[]
  ): Promise<number | null>;

  // Legacy stringly-typed dispatch — retained temporarily for compatibility
  call?(method: keyof DatabaseBase, ...args: unknown[]): Promise<unknown>;
  callBespoke?(method: string, ...args: unknown[]): Promise<unknown>;
}

export type { GetAllOptions, QueryFilter };
