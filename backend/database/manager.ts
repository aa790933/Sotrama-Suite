import fs from 'fs-extra';
import { DatabaseError } from 'fyo/utils/errors';
import path from 'path';
import { DatabaseDemuxBase, DatabaseMethod } from 'utils/db/types';
import { getMapFromList } from 'utils/index';
import { Version } from 'utils/version';
import { getSchemas } from '../../schemas';
import { databaseMethodSet } from '../helpers';
import patches from '../patches';
import { BespokeQueries } from './bespoke';
import DatabaseCore from './core';
import { runPatches } from './runPatch';
import { BespokeFunction, Patch, RawCustomField } from './types';
import type { MariaDBConfig } from './core';

export class DatabaseManager extends DatabaseDemuxBase {
  db?: DatabaseCore;
  rawCustomFields: RawCustomField[] = [];
  dbConfig?: MariaDBConfig;

  get #isInitialized(): boolean {
    return this.db !== undefined && this.db.pool !== null;
  }

  getSchemaMap() {
    if (this.#isInitialized) {
      return this.db?.schemaMap ?? getSchemas('-', this.rawCustomFields);
    }

    return getSchemas('-', this.rawCustomFields);
  }

  async createNewDatabase(_dbPath: string, countryCode: string) {
    // For MariaDB, createNewDatabase is effectively the same as connect
    return await this.connectToDatabase(_dbPath, countryCode);
  }

  async connectToDatabase(_dbPath: string, countryCode?: string) {
    countryCode = await this._connect(_dbPath, countryCode);
    await this.#migrate();
    return countryCode;
  }

  async _connect(_dbPath: string, countryCode?: string) {
    countryCode ??= await DatabaseCore.getCountryCode(this.dbConfig!);
    this.db = new DatabaseCore(undefined, this.dbConfig);
    this.db.connect();
    await this.setRawCustomFields();
    const schemaMap = getSchemas(countryCode, this.rawCustomFields);
    this.db.setSchemaMap(schemaMap);
    return countryCode;
  }

  async setRawCustomFields() {
    try {
      this.rawCustomFields = (await this.db?.query(
        'SELECT * FROM customfield'
      )) as RawCustomField[];
    } catch {}
  }

  async #migrate(): Promise<void> {
    if (!this.#isInitialized) {
      return;
    }

    const isFirstRun = await this.#getIsFirstRun();
    if (isFirstRun) {
      await this.db!.migrate();
    }

    await this.#executeMigration();
  }

  async #executeMigration() {
    const version = await this.#getAppVersion();
    const patches = await this.#getPatchesToExecute(version);

    const hasPatches = !!patches.pre.length || !!patches.post.length;
    if (hasPatches) {
      await this.#createBackup();
    }

    await runPatches(patches.pre, this, version);
    await this.db!.migrate({
      pre: async () => {
        if (hasPatches) {
          return;
        }

        await this.#createBackup();
      },
    });
    await runPatches(patches.post, this, version);
  }

  async #getPatchesToExecute(
    version: string
  ): Promise<{ pre: Patch[]; post: Patch[] }> {
    if (this.db === undefined) {
      return { pre: [], post: [] };
    }

    const query = (await this.db.query(
      'SELECT name, version, failed FROM patchrun'
    )) as {
      name: string;
      version?: string;
      failed?: boolean;
    }[];

    const runPatchesMap = getMapFromList(query, 'name');
    const filtered = patches
      .filter((p) => {
        const exec = runPatchesMap[p.name];
        if (!exec && Version.lte(version, p.version)) {
          return true;
        }

        if (exec?.failed && exec?.version !== version) {
          return true;
        }

        return false;
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return {
      pre: filtered.filter((p) => p.patch.beforeMigrate),
      post: filtered.filter((p) => !p.patch.beforeMigrate),
    };
  }

  // Typed CRUD — direct, no string dispatch (replaces call)
  async insert(schemaName: string, fieldValueMap: import('./types').FieldValueMap): Promise<import('./types').FieldValueMap> {
    if (!this.#isInitialized) throw new Error('Database not initialized');
    return this.db!.insert(schemaName, fieldValueMap);
  }
  async get(schemaName: string, name: string, fields?: string | string[]): Promise<import('./types').FieldValueMap> {
    if (!this.#isInitialized) throw new Error('Database not initialized');
    return this.db!.get(schemaName, name, fields);
  }
  async getAll(schemaName: string, options: import('utils/db/types').GetAllOptions = {}): Promise<import('./types').FieldValueMap[]> {
    if (!this.#isInitialized) return [];
    return this.db!.getAll(schemaName, options);
  }
  async getSingleValues(...fieldnames: ({ fieldname: string; parent?: string } | string)[]): Promise<import('./types').SingleValue<import('schemas/types').RawValue>> {
    if (!this.#isInitialized) return [];
    return this.db!.getSingleValues(...fieldnames);
  }
  async rename(schemaName: string, oldName: string, newName: string): Promise<void> {
    if (!this.#isInitialized) return;
    return this.db!.rename(schemaName, oldName, newName);
  }
  async update(schemaName: string, fieldValueMap: import('./types').FieldValueMap): Promise<void> {
    if (!this.#isInitialized) return;
    return this.db!.update(schemaName, fieldValueMap);
  }
  async delete(schemaName: string, name: string): Promise<void> {
    if (!this.#isInitialized) return;
    return this.db!.delete(schemaName, name);
  }
  async deleteAll(schemaName: string, filters: import('utils/db/types').QueryFilter): Promise<number> {
    if (!this.#isInitialized) return 0;
    return this.db!.deleteAll(schemaName, filters);
  }
  async exists(schemaName: string, name?: string): Promise<boolean> {
    if (!this.#isInitialized) return false;
    return this.db!.exists(schemaName, name);
  }
  async close(): Promise<void> {
    if (!this.#isInitialized) return;
    await this.db!.close();
    delete this.db;
  }

  async call(method: DatabaseMethod, ...args: unknown[]) {
    if (!this.#isInitialized) {
      return;
    }

    if (!databaseMethodSet.has(method)) {
      return;
    }

    // @ts-ignore
    const response = await this.db[method](...args);
    if (method === 'close') {
      delete this.db;
    }

    return response;
  }

  async count(schemaName: string, options: import('utils/db/types').GetAllOptions = {}): Promise<number> {
    if (!this.#isInitialized) return 0;
    return this.db!.count(schemaName, options);
  }

  async getNextAutoincrementId(schemaName: string): Promise<number> {
    if (!this.#isInitialized) return 0;
    return this.db!.getNextAutoincrementId(schemaName);
  }

  async getNextSeriesValue(prefix: string, schemaName: string): Promise<number> {
    if (!this.#isInitialized) return 0;
    return this.db!.getNextSeriesValue(prefix, schemaName);
  }

  async getStockQuantity(
    query: import('utils/db/types').StockQuery | string,
    location?: string,
    fromDate?: string,
    toDate?: string,
    batch?: string,
    serialNumbers?: string[]
  ): Promise<number | null> {
    if (!this.#isInitialized) return null;
    let q: import('utils/db/types').StockQuery;
    if (typeof query === 'string') {
      q = { item: query, location, fromDate, toDate, batch, serialNumbers };
    } else {
      q = query;
    }
    return this.db!.getStockQuantity(q);
  }

  async callBespoke(method: string, ...args: unknown[]): Promise<unknown> {
    if (!this.#isInitialized) {
      return;
    }

    if (!BespokeQueries.hasOwnProperty(method)) {
      throw new DatabaseError(`invalid bespoke db function ${method}`);
    }

    const queryFunction: BespokeFunction =
      BespokeQueries[method as keyof BespokeFunction];
    return await queryFunction(this.db!, ...args);
  }

  async #getIsFirstRun(): Promise<boolean> {
    const db = this.db;
    if (!db || !db.pool) {
      return true;
    }

    const query = (await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patchrun' LIMIT 1`
    )) as unknown[];
    return query.length === 0;
  }

  async #createBackup() {
    if (process.env.IS_TEST) {
      return;
    }

    const backupPath = await this.#getBackupFilePath();
    if (!backupPath || !this.db || !this.dbConfig) {
      return;
    }

    const mysqldumpPath = await this.#getMysqldumpPath();
    if (mysqldumpPath) {
      try {
        await fs.ensureDir(path.dirname(backupPath));
        const { spawn } = await import('child_process');
        const safeDb = this.dbConfig.database.replace(/`/g, '');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            mysqldumpPath,
            [
              '-h',
              this.dbConfig!.host,
              '-P',
              String(this.dbConfig!.port),
              '-u',
              this.dbConfig!.user,
              safeDb,
            ],
            {
              env: { ...process.env, MYSQL_PWD: this.dbConfig!.password },
              timeout: 60000,
            }
          );
          const out = fs.createWriteStream(backupPath);
          child.stdout?.pipe(out);
          let stderr = '';
          child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
          child.on('error', reject);
          child.on('close', (code) => {
            out.close();
            if (code === 0) resolve();
            else reject(new Error(`mysqldump failed (code ${code}): ${stderr}`));
          });
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Backup via mysqldump failed:', (err as Error).message);
      }
    }
  }

  async #getMysqldumpPath(): Promise<string | null> {
    const { execSync } = await import('child_process');
    try {
      const result = execSync(
        'which mysqldump 2>/dev/null || where mysqldump 2>nul',
        {
          encoding: 'utf8',
          timeout: 5000,
        }
      );
      return result.trim();
    } catch {
      return null;
    }
  }

  async #getBackupFilePath() {
    if (!this.dbConfig) return null;

    const fileName = this.dbConfig.database;
    const backupFolder = path.join(process.cwd(), 'backups');
    const date = new Date().toISOString().split('T')[0];
    const version = await this.#getAppVersion();
    const backupFile = `${fileName}_${version}_${date}.sql`;
    fs.ensureDirSync(backupFolder);
    return path.join(backupFolder, backupFile);
  }

  async #getAppVersion(): Promise<string> {
    if (!this.db || !this.db.pool) {
      return '0.0.0';
    }

    const query = (await this.db.query(
      `SELECT value FROM singlevalue WHERE fieldname = 'version' AND parent = 'systemsettings' LIMIT 1`
    )) as { value: string }[];
    const value = query[0]?.value;
    return value || '0.0.0';
  }

  setDbConfig(config: MariaDBConfig) {
    this.dbConfig = config;
  }
}

export default new DatabaseManager();
