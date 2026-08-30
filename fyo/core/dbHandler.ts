import { FieldValueMap, SingleValue } from 'backend/database/types';
import { cloneDeep } from 'lodash';
import { Fyo } from 'fyo';
import { Database } from 'fyo/database/Database';
import { DatabaseDemux } from 'fyo/demux/db';
import { ValueError } from 'fyo/utils/errors';
import Observable from 'fyo/utils/observable';
import { translateSchema } from 'fyo/utils/translation';
import { Field, RawValue, SchemaMap } from 'schemas/types';
import { getMapFromList } from 'utils';
import {
  Cashflow,
  DatabaseBase,
  DatabaseDemuxBase,
  DatabaseMethod,
  GetAllOptions,
  IncomeExpense,
  QueryFilter,
  TopExpenses,
  TotalCreditAndDebit,
  TotalOutstanding,
} from 'utils/db/types';
import { schemaTranslateables } from 'utils/translationHelpers';
import { LanguageMap } from 'utils/types';
import { Converter } from './converter';
import {
  DatabaseDemuxConstructor,
  DocValue,
  DocValueMap,
  RawValueMap,
} from './types';
import { ReturnDocItem } from 'models/inventory/types';
import { Money } from 'pesa';

type FieldMap = Record<string, Record<string, Field>>;

/**
 * Legacy adapter — wraps the stringly-typed DatabaseDemuxBase so the handler
 * can depend on the typed Database seam without branching in every method.
 * Conversion (Doc↔Raw) is hidden here for the legacy path, so the handler
 * no longer owns Converter — the Database implementation does.
 */
class DemuxDatabaseAdapter implements Database {
  private converter: Converter;
  constructor(
    private readonly demux: Database & DatabaseDemuxBase,
    fieldMapProvider: () => FieldMap,
    pesaProvider: () => import('pesa').MoneyMaker
  ) {
    this.converter = new Converter(fieldMapProvider, pesaProvider);
  }

  getSchemaMap(): Promise<SchemaMap> {
    return this.demux.getSchemaMap() as Promise<SchemaMap>;
  }
  createNewDatabase(dbPath: string, countryCode: string): Promise<string> {
    return this.demux.createNewDatabase(dbPath, countryCode);
  }
  connectToDatabase(dbPath: string, countryCode?: string): Promise<string> {
    return this.demux.connectToDatabase(dbPath, countryCode);
  }
  async insert(schemaName: string, docValueMap: DocValueMap): Promise<DocValueMap> {
    const raw = this.converter.toRawValueMap(schemaName, docValueMap) as RawValueMap;
    const resultRaw = (await (this.demux as unknown as { insert: (s: string, m: FieldValueMap) => Promise<FieldValueMap> }).insert(schemaName, raw as unknown as FieldValueMap)) as unknown as RawValueMap;
    return this.converter.toDocValueMap(schemaName, resultRaw) as DocValueMap;
  }
  async get(schemaName: string, name: string, fields?: string | string[]): Promise<DocValueMap> {
    const raw = (await (this.demux as unknown as { get: (s: string, n: string, f?: string | string[]) => Promise<FieldValueMap> }).get(schemaName, name, fields)) as unknown as RawValueMap;
    return this.converter.toDocValueMap(schemaName, raw) as DocValueMap;
  }
  async getAll(schemaName: string, options: GetAllOptions = {}): Promise<DocValueMap[]> {
    const raws = (await (this.demux as unknown as { getAll: (s: string, o: GetAllOptions) => Promise<FieldValueMap[]> }).getAll(schemaName, options)) as unknown as RawValueMap[];
    return this.converter.toDocValueMap(schemaName, raws) as DocValueMap[];
  }
  getAllRaw(schemaName: string, options: GetAllOptions = {}): Promise<FieldValueMap[]> {
    return (this.demux as unknown as { getAll: (s: string, o: GetAllOptions) => Promise<FieldValueMap[]> }).getAll(schemaName, options);
  }
  async getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<{ fieldname: string; parent: string; value: DocValue }[]> {
    const raws = (await (this.demux as unknown as { getSingleValues: (...a: unknown[]) => Promise<SingleValue<RawValue>> }).getSingleValues(...fieldnames)) as SingleValue<RawValue>;
    const out: { fieldname: string; parent: string; value: DocValue }[] = [];
    for (const sv of raws) {
      const fm = this.converter.fieldMapProvider();
      const fieldDef = fm[sv.parent]?.[sv.fieldname];
      const pesa = this.converter.pesaProvider();
      const docVal = fieldDef ? Converter.toDocValue(sv.value, fieldDef, pesa) : (sv.value as DocValue);
      out.push({ fieldname: sv.fieldname, parent: sv.parent, value: docVal });
    }
    return out;
  }
  rename(schemaName: string, oldName: string, newName: string): Promise<void> {
    return (this.demux as unknown as { rename: (s: string, o: string, n: string) => Promise<void> }).rename(schemaName, oldName, newName);
  }
  async update(schemaName: string, docValueMap: DocValueMap): Promise<void> {
    const raw = this.converter.toRawValueMap(schemaName, docValueMap) as RawValueMap;
    await (this.demux as unknown as { update: (s: string, m: FieldValueMap) => Promise<void> }).update(schemaName, raw as unknown as FieldValueMap);
  }
  delete(schemaName: string, name: string): Promise<void> {
    return (this.demux as unknown as { delete: (s: string, n: string) => Promise<void> }).delete(schemaName, name);
  }
  deleteAll(schemaName: string, filters: QueryFilter): Promise<number> {
    return (this.demux as unknown as { deleteAll: (s: string, f: QueryFilter) => Promise<number> }).deleteAll(schemaName, filters);
  }
  exists(schemaName: string, name?: string): Promise<boolean> {
    return (this.demux as unknown as { exists: (s: string, n?: string) => Promise<boolean> }).exists(schemaName, name);
  }
  close(): Promise<void> {
    return (this.demux as unknown as { close: () => Promise<void> }).close();
  }
  count(schemaName: string, options: GetAllOptions = {}): Promise<number> {
    return (this.demux as unknown as { count: (s: string, o: GetAllOptions) => Promise<number> }).count(schemaName, options);
  }
  getNextAutoincrementId(schemaName: string): Promise<number> {
    return (this.demux as unknown as { getNextAutoincrementId: (s: string) => Promise<number> }).getNextAutoincrementId(schemaName);
  }
  getNextSeriesValue(prefix: string, schemaName: string): Promise<number> {
    return (this.demux as unknown as { getNextSeriesValue: (p: string, s: string) => Promise<number> }).getNextSeriesValue(prefix, schemaName);
  }
  getStockQuantity(
    query: import('fyo/database/Database').StockQuery | string,
    location?: string,
    fromDate?: string,
    toDate?: string,
    batch?: string,
    serialNumbers?: string[]
  ): Promise<number | null> {
    let q: import('fyo/database/Database').StockQuery;
    if (typeof query === 'string') {
      q = { item: query, location, fromDate, toDate, batch, serialNumbers };
    } else {
      q = query;
    }
    return (this.demux as unknown as { getStockQuantity: (q: import('fyo/database/Database').StockQuery) => Promise<number | null> }).getStockQuantity(q);
  }
  call(method: DatabaseMethod, ...args: unknown[]): Promise<unknown> {
    return this.demux.call(method, ...args);
  }
  callBespoke(method: string, ...args: unknown[]): Promise<unknown> {
    return this.demux.callBespoke(method, ...args);
  }
}

export class DatabaseHandler extends DatabaseBase {
  /* eslint-disable @typescript-eslint/no-floating-promises */
  #fyo: Fyo;
  // Kept for backward compat until all callers typed; not used for typed path (conversion behind Database)
  converter: Converter;
  #backend: Database;
  dbPath?: string;
  #schemaMap: SchemaMap = {};
  #fieldMap: FieldMap = {};
  observer: Observable<never> = new Observable();

  constructor(fyo: Fyo, Demux?: DatabaseDemuxConstructor, typed?: Database) {
    super();
    this.#fyo = fyo;
    // Converter kept for legacy fallback only; typed path uses adapter-owned converter
    this.converter = new Converter(() => this.#fieldMap, () => this.#fyo.pesa);

    if (typed) {
      // Wire typed adapter to this handler's live fieldMap/pesa so conversion stays behind Database seam
      const maybeTyped = typed as Database & {
        setProviders?: (fm: () => FieldMap, pp: () => import('pesa').MoneyMaker) => void;
      };
      if (maybeTyped.setProviders) {
        maybeTyped.setProviders(() => this.#fieldMap, () => this.#fyo.pesa);
      }
      this.#backend = typed;
    } else {
      const demux = Demux ? new Demux(fyo.isElectron) : new DatabaseDemux(fyo.isElectron);
      this.#backend = new DemuxDatabaseAdapter(demux as unknown as Database & DatabaseDemuxBase, () => this.#fieldMap, () => this.#fyo.pesa);
    }
  }

  /** Typed adapter accessor — undefined when using legacy Demux path wrapped via DemuxDatabaseAdapter */
  get typedAdapter(): Database | undefined {
    // Expose the underlying typed adapter if directly injected (Memory/Ipc)
    // For legacy Demux path, the backend is a DemuxDatabaseAdapter wrapping a demux.
    // We detect by checking if backend is a DemuxDatabaseAdapter; if so, no direct typed.
    if (this.#backend instanceof DemuxDatabaseAdapter) return undefined;
    return this.#backend;
  }

  /** Expose backend for delegation — single seam, no branching in callers */
  private get backend(): Database {
    return this.#backend;
  }

  get schemaMap(): Readonly<SchemaMap> {
    return this.#schemaMap;
  }

  get fieldMap(): Readonly<FieldMap> {
    return this.#fieldMap;
  }

  get isConnected() {
    return !!this.dbPath;
  }

  async createNewDatabase(dbPath: string, countryCode: string) {
    countryCode = await this.backend.createNewDatabase(dbPath, countryCode);
    await this.init();
    this.dbPath = dbPath;
    return countryCode;
  }

  async connectToDatabase(dbPath: string, countryCode?: string) {
    countryCode = await this.backend.connectToDatabase(dbPath, countryCode);
    await this.init();
    this.dbPath = dbPath;
    return countryCode;
  }

  async init() {
    this.#schemaMap = await this.backend.getSchemaMap();
    this.#setFieldMap();
    this.observer = new Observable();
  }

  async translateSchemaMap(languageMap?: LanguageMap) {
    if (languageMap) {
      this.#schemaMap = cloneDeep(this.#schemaMap);
      translateSchema(this.#schemaMap, languageMap, schemaTranslateables);
      this.#setFieldMap();
    } else {
      this.#schemaMap = await this.backend.getSchemaMap();
      this.#setFieldMap();
    }
  }

  async purgeCache() {
    await this.close();
    this.dbPath = undefined;
    this.#schemaMap = {};
    this.#fieldMap = {};
  }

  async insert(schemaName: string, docValueMap: DocValueMap): Promise<DocValueMap> {
    const result = await this.backend.insert(schemaName, docValueMap);
    this.observer.trigger(`insert:${schemaName}`, docValueMap);
    return result;
  }

  // Read
  async get(schemaName: string, name: string, fields?: string | string[]): Promise<DocValueMap> {
    const result = await this.backend.get(schemaName, name, fields);
    this.observer.trigger(`get:${schemaName}`, { name, fields });
    return result;
  }

  async getAll(schemaName: string, options: GetAllOptions = {}): Promise<DocValueMap[]> {
    const result = await this.backend.getAll(schemaName, options);
    this.observer.trigger(`getAll:${schemaName}`, options);
    return result;
  }

  async getAllRaw(schemaName: string, options: GetAllOptions = {}): Promise<RawValueMap[]> {
    // getAllRaw intentionally leaks Raw — bypass Doc conversion
    const raws = await this.backend.getAllRaw(schemaName, options);
    this.observer.trigger(`getAllRaw:${schemaName}`, options);
    return raws as RawValueMap[];
  }

  async getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<SingleValue<DocValue>> {
    const result = await this.backend.getSingleValues(...fieldnames);
    this.observer.trigger(`getSingleValues`, fieldnames);
    return result as SingleValue<DocValue>;
  }

  async count(schemaName: string, options: GetAllOptions = {}): Promise<number> {
    const count = await this.backend.count(schemaName, options);
    this.observer.trigger(`count:${schemaName}`, options);
    return count;
  }

  // Update
  async rename(schemaName: string, oldName: string, newName: string): Promise<void> {
    await this.backend.rename(schemaName, oldName, newName);
    this.observer.trigger(`rename:${schemaName}`, { oldName, newName });
  }

  async update(schemaName: string, docValueMap: DocValueMap): Promise<void> {
    await this.backend.update(schemaName, docValueMap);
    this.observer.trigger(`update:${schemaName}`, docValueMap);
  }

  // Delete
  async delete(schemaName: string, name: string): Promise<void> {
    await this.backend.delete(schemaName, name);
    this.observer.trigger(`delete:${schemaName}`, name);
  }

  async deleteAll(schemaName: string, filters: QueryFilter): Promise<number> {
    const count = await this.backend.deleteAll(schemaName, filters);
    this.observer.trigger(`deleteAll:${schemaName}`, filters);
    return count;
  }

  // Other
  async exists(schemaName: string, name?: string): Promise<boolean> {
    const doesExist = await this.backend.exists(schemaName, name);
    this.observer.trigger(`exists:${schemaName}`, name);
    return doesExist;
  }

  async close(): Promise<void> {
    await this.backend.close();
  }

  async getNextAutoincrementId(schemaName: string): Promise<number> {
    return (await this.backend.getNextAutoincrementId(schemaName)) as number;
  }

  async getNextSeriesValue(prefix: string, schemaName: string): Promise<number> {
    return (await this.backend.getNextSeriesValue(prefix, schemaName)) as number;
  }

  async getStockQuantity(
    query: import('fyo/database/Database').StockQuery | string,
    location?: string,
    fromDate?: string,
    toDate?: string,
    batch?: string,
    serialNumbers?: string[]
  ): Promise<number | null> {
    let q: import('fyo/database/Database').StockQuery;
    if (typeof query === 'string') {
      q = { item: query, location, fromDate, toDate, batch, serialNumbers };
    } else {
      q = query;
    }
    return (await this.backend.getStockQuantity(q)) as number | null;
  }

  /**
   * Internal — kept for any legacy callers that still expect Raw via #getAll;
   * now correctly delegates to getAllRaw (Raw) rather than getAll (Doc).
   */
  async #getAll(schemaName: string, options: GetAllOptions = {}): Promise<RawValueMap[]> {
    return (await this.backend.getAllRaw(schemaName, options)) as RawValueMap[];
  }

  #setFieldMap() {
    this.#fieldMap = Object.values(this.schemaMap).reduce((acc, sch) => {
      if (!sch?.name) return acc;
      acc[sch?.name] = getMapFromList(sch?.fields, 'fieldname');
      return acc;
    }, {} as FieldMap);
  }
}
