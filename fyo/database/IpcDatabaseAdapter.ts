import { DatabaseError } from 'fyo/utils/errors';
import { FieldValueMap } from 'backend/database/types';
import { SchemaMap } from 'schemas/types';
import { DatabaseBase, GetAllOptions, QueryFilter } from 'utils/db/types';
import { BackendResponse } from 'utils/ipc/types';
import { Database } from './Database';
import { DocValue, DocValueMap, RawValueMap } from 'fyo/core/types';
import { Converter } from 'fyo/core/converter';
import type { Field } from 'schemas/types';
import type { MoneyMaker } from 'pesa';

type FieldMap = Record<string, Record<string, Field>>;

export class IpcDatabaseAdapter extends DatabaseBase implements Database {
  private converter: Converter;
  private fieldMapProvider: () => FieldMap;
  private pesaProvider: () => MoneyMaker;

  constructor(
    fieldMapProvider: () => FieldMap = () => ({} as FieldMap),
    pesaProvider: () => MoneyMaker = () => ((v: unknown) => v) as unknown as MoneyMaker
  ) {
    super();
    this.fieldMapProvider = fieldMapProvider;
    this.pesaProvider = pesaProvider;
    this.converter = new Converter(fieldMapProvider, pesaProvider);
  }

  // For Fyo wiring after handler's fieldMap is populated, allow updating providers
  setProviders(fieldMapProvider: () => FieldMap, pesaProvider: () => MoneyMaker) {
    this.fieldMapProvider = fieldMapProvider;
    this.pesaProvider = pesaProvider;
    this.converter = new Converter(fieldMapProvider, pesaProvider);
  }

  async #handleDBCall(func: () => Promise<BackendResponse>): Promise<unknown> {
    const response = await func();
    if (response.error?.name) {
      const { name, message, stack } = response.error;
      const dberror = new DatabaseError(`${name}\n${message}`);
      dberror.stack = stack;
      throw dberror;
    }
    return response.data;
  }

  async getSchemaMap(): Promise<SchemaMap> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.getSchema();
    })) as SchemaMap;
  }

  async createNewDatabase(dbPath: string, countryCode: string): Promise<string> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.create(dbPath, countryCode);
    })) as string;
  }

  async connectToDatabase(dbPath: string, countryCode?: string): Promise<string> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.connect(dbPath, countryCode);
    })) as string;
  }

  async insert(schemaName: string, docValueMap: DocValueMap): Promise<DocValueMap> {
    const raw = this.converter.toRawValueMap(schemaName, docValueMap) as RawValueMap;
    const resultRaw = (await this.#handleDBCall(async () => {
      return await ipc.db.call('insert', schemaName, raw as unknown as FieldValueMap);
    })) as RawValueMap;
    return this.converter.toDocValueMap(schemaName, resultRaw) as DocValueMap;
  }

  async get(schemaName: string, name: string, fields?: string | string[]): Promise<DocValueMap> {
    const raw = (await this.#handleDBCall(async () => {
      return await ipc.db.call('get', schemaName, name, fields);
    })) as RawValueMap;
    return this.converter.toDocValueMap(schemaName, raw) as DocValueMap;
  }

  async getAll(schemaName: string, options: GetAllOptions = {}): Promise<DocValueMap[]> {
    const raws = (await this.#handleDBCall(async () => {
      return await ipc.db.call('getAll', schemaName, options);
    })) as RawValueMap[];
    return this.converter.toDocValueMap(schemaName, raws) as DocValueMap[];
  }

  async getAllRaw(schemaName: string, options: GetAllOptions = {}): Promise<FieldValueMap[]> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('getAll', schemaName, options);
    })) as FieldValueMap[];
  }

  async getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<{ fieldname: string; parent: string; value: DocValue }[]> {
    const raws = (await this.#handleDBCall(async () => {
      return await ipc.db.call('getSingleValues', ...fieldnames);
    })) as { fieldname: string; parent: string; value: unknown }[];
    const out: { fieldname: string; parent: string; value: DocValue }[] = [];
    for (const sv of raws) {
      const field = this.fieldMapProvider()[sv.parent]?.[sv.fieldname];
      if (!field) {
        out.push(sv as { fieldname: string; parent: string; value: DocValue });
        continue;
      }
      const docVal = Converter.toDocValue(sv.value as never, field, this.pesaProvider());
      out.push({ fieldname: sv.fieldname, parent: sv.parent, value: docVal });
    }
    return out;
  }

  async rename(schemaName: string, oldName: string, newName: string): Promise<void> {
    await this.#handleDBCall(async () => {
      return await ipc.db.call('rename', schemaName, oldName, newName);
    });
  }

  async update(schemaName: string, docValueMap: DocValueMap): Promise<void> {
    const raw = this.converter.toRawValueMap(schemaName, docValueMap) as RawValueMap;
    await this.#handleDBCall(async () => {
      return await ipc.db.call('update', schemaName, raw as unknown as FieldValueMap);
    });
  }

  async delete(schemaName: string, name: string): Promise<void> {
    await this.#handleDBCall(async () => {
      return await ipc.db.call('delete', schemaName, name);
    });
  }

  async deleteAll(schemaName: string, filters: QueryFilter): Promise<number> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('deleteAll', schemaName, filters);
    })) as number;
  }

  async exists(schemaName: string, name?: string): Promise<boolean> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('exists', schemaName, name);
    })) as boolean;
  }

  async close(): Promise<void> {
    await this.#handleDBCall(async () => {
      return await ipc.db.call('close');
    });
  }

  async count(schemaName: string, options: GetAllOptions = {}): Promise<number> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('count', schemaName, options);
    })) as number;
  }

  async getNextAutoincrementId(schemaName: string): Promise<number> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('getNextAutoincrementId', schemaName);
    })) as number;
  }

  async getNextSeriesValue(prefix: string, schemaName: string): Promise<number> {
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('getNextSeriesValue', prefix, schemaName);
    })) as number;
  }

  async getStockQuantity(
    query: import('./Database').StockQuery | string,
    location?: string,
    fromDate?: string,
    toDate?: string,
    batch?: string,
    serialNumbers?: string[]
  ): Promise<number | null> {
    let q: import('./Database').StockQuery;
    if (typeof query === 'string') {
      q = { item: query, location, fromDate, toDate, batch, serialNumbers };
    } else {
      q = query;
    }
    return (await this.#handleDBCall(async () => {
      return await ipc.db.call('getStockQuantity', q);
    })) as number | null;
  }

  async call(method: keyof DatabaseBase, ...args: unknown[]): Promise<unknown> {
    return await this.#handleDBCall(async () => {
      return await ipc.db.call(method, ...args);
    });
  }

  async callBespoke(method: string, ...args: unknown[]): Promise<unknown> {
    return await this.#handleDBCall(async () => {
      return await ipc.db.bespoke(method, ...args);
    });
  }
}
