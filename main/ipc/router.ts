import type { MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import type { SelectFileOptions, SelectFileReturn } from 'utils/types';
import databaseManager from '../../backend/database/manager';
import { emitMainProcessError } from '../../backend/helpers';
import type { DatabaseMethod } from '../../utils/db/types';
import { IPC_ACTIONS } from '../../utils/messages';
import type { MariaDBConfig, Platform, PingOptions, InstallResult, PortCheckResult } from '../../utils/mariadb-types';
import { parseMariaDBConfigString } from '../../utils/mariadb-types';
import { getUrlAndTokenString, sendError } from '../contactMothership';
import type { RequestInit as NodeFetchRequestInit } from 'node-fetch';
import { getLanguageMap } from '../getLanguageMap';
import { getTemplates } from '../getPrintTemplates';
import { printHtmlDocument } from '../printHtmlDocument';
import {
  findConnectionById,
  getConfigFilesWithModified,
  getConnectionsMetadata,
  getPersistedConnections,
  isExpectedUpdateError,
  migrateLegacyConnections,
  setAndGetCleanedConfigFiles,
  upsertConnectionFromConfig,
} from '../helpers';
import { saveHtmlAsPdf } from '../saveHtmlAsPdf';
import { sendAPIRequest } from '../api';
import { initScheduler } from '../initSheduler';
import type { BackendResponse } from '../../utils/ipc/types';
import type { Database } from '../../fyo/database/Database';
import type { SchemaMap } from 'schemas/types';
import {
  AppPaths,
  ElectronSenderPolicy,
  PathPolicy,
  SenderPolicy,
  assertAllowedApiEndpoint,
  sanitizeDatabaseName,
} from './policies';

// ---- Dependency contracts ----

export interface WindowProvider {
  getWindow(): Electron.BrowserWindow | null;
  isDevelopment: boolean;
  isLinux: boolean;
  checkedForUpdate: boolean;
  icon: string;
}

function asDatabase(manager: typeof databaseManager): Database {
  return {
    getSchemaMap: () => Promise.resolve(manager.getSchemaMap() as SchemaMap),
    createNewDatabase: (dbPath: string, countryCode: string) => manager.createNewDatabase(dbPath, countryCode),
    connectToDatabase: (dbPath: string, countryCode?: string) => manager.connectToDatabase(dbPath, countryCode),
    insert: (s: string, m: any) => manager.insert(s, m) as Promise<any>,
    get: (s: string, n: string, f?: string | string[]) => manager.get(s, n, f) as Promise<any>,
    getAll: (s: string, o?: any) => manager.getAll(s, o) as Promise<any>,
    getAllRaw: (s: string, o?: any) => manager.getAll(s, o) as Promise<any>,
    getSingleValues: (...a: any[]) => (manager.getSingleValues as any)(...a),
    update: (s: string, m: any) => manager.update(s, m),
    delete: (s: string, n: string) => manager.delete(s, n),
    deleteAll: (s: string, f: any) => manager.deleteAll(s, f),
    exists: (s: string, n?: string) => manager.exists(s, n),
    close: () => manager.close(),
    count: (s: string, o?: any) => manager.count(s, o),
    getNextAutoincrementId: (s: string) => manager.getNextAutoincrementId(s),
    getNextSeriesValue: (p: string, s: string) => manager.getNextSeriesValue(p, s),
    getStockQuantity: ((q: any, ...a: any[]) => (manager.getStockQuantity as any)(q, ...a)) as any,
    rename: (s: string, o: string, n: string) => manager.rename(s, o, n),
    call: (m: DatabaseMethod, ...a: unknown[]) => manager.call(m, ...a),
    callBespoke: (m: string, ...a: unknown[]) => manager.callBespoke(m, ...a),
  } as unknown as Database;
}

export interface IpcRouterDeps {
  database: Database;
  windowProvider: WindowProvider;
  app: Electron.App;
  dialog: Electron.Dialog;
  ipcMain?: typeof import('electron').ipcMain;
  autoUpdater?: typeof import('electron-updater').autoUpdater;
  senderPolicy?: SenderPolicy;
  pathPolicy?: PathPolicy;
  installer?: {
    isPortAvailable(port: number): Promise<PortCheckResult>;
    detectLanIp(): string | null;
    pingMariaDB(opts: PingOptions): Promise<{ ok: boolean; error?: string }>;
    installMariaDBSilent(opts: import('../../utils/mariadb-types').InstallOptions, onProgress?: (e: { percent: number; downloaded: number; total: number }) => void): Promise<InstallResult>;
    resolveMsiPath(onProgress?: (e: { percent: number; downloaded: number; total: number }) => void): Promise<string>;
    detectPlatform(): Platform;
  };
}

// ---- Typed sub-interfaces (the seam) — four as planned ----

export interface DbOps {
  checkDbAccess(config: MariaDBConfig): Promise<boolean>;
  createNewDatabase(dbPath: string, countryCode: string): Promise<BackendResponse>;
  connectToDatabase(dbPath: string, countryCode?: string): Promise<BackendResponse>;
  dbCall(method: DatabaseMethod, ...args: unknown[]): Promise<BackendResponse>;
  dbBespoke(method: string, ...args: unknown[]): Promise<BackendResponse>;
  dbSchema(): Promise<BackendResponse>;
  getDbList(): Promise<unknown>;
}

export interface InstallerOps {
  isPortAvailable(port: number): Promise<PortCheckResult>;
  getLanIp(): Promise<string | null>;
  pingMariaDB(opts: PingOptions): Promise<{ ok: boolean; error?: string }>;
  resolveMsiPath(emitProgress: boolean, sender: Electron.WebContents | null): Promise<string>;
  installMariaDB(opts: { rootPassword: string; appPassword: string; database: string; port: number; platform?: Platform; hostMode?: boolean }, sender: Electron.WebContents | null): Promise<InstallResult>;
  checkDbExists(config: MariaDBConfig): Promise<{ exists: boolean; error?: string }>;
  createDatabase(config: MariaDBConfig): Promise<{ ok: boolean; error?: string }>;
}

export interface FileOps {
  saveData(data: string, savePath: string, event: Electron.IpcMainInvokeEvent): Promise<void>;
  deleteFile(filePath: string, event: Electron.IpcMainInvokeEvent): Promise<BackendResponse>;
  selectFile(options: SelectFileOptions, window: Electron.BrowserWindow | null): Promise<SelectFileReturn>;
  getOpenFilePath(options: OpenDialogOptions, window: Electron.BrowserWindow | null): Promise<Electron.OpenDialogReturnValue>;
  getSaveFilePath(options: SaveDialogOptions, window: Electron.BrowserWindow | null): Promise<Electron.SaveDialogReturnValue>;
  getDialogResponse(options: MessageBoxOptions, window: Electron.BrowserWindow | null, isDevelopment: boolean, isLinux: boolean, icon: string): Promise<Electron.MessageBoxReturnValue>;
  saveHtmlAsPdf(html: string, savePath: string, width: number, height: number, app: Electron.App): Promise<boolean>;
  printHtmlDocument(html: string, width: number, height: number, app: Electron.App): Promise<boolean>;
}

export interface AppOps {
  getEnv(isDevelopment: boolean, platform: NodeJS.Platform, version: string): Promise<{ isDevelopment: boolean; platform: string; version: string }>;
  getLanguageMap(code: string): Promise<{ languageMap: unknown; success: boolean; message: string }>;
  getTemplates(posPrintWidth?: number): Promise<unknown>;
  initScheduler(main: unknown, interval: string): Promise<unknown>;
  getCreds(): unknown;
  checkForUpdates(isDevelopment: boolean, checkedForUpdate: boolean, onChecked: () => void): Promise<void>;
  sendError(bodyJson: string, main: unknown): Promise<void>;
  sendAPIRequest(endpoint: string, options: NodeFetchRequestInit | undefined, event: Electron.IpcMainInvokeEvent): Promise<unknown>;
  showError(title: string, content: string): Promise<void>;
}

// ---- Implementation ----

async function getErrorHandledResponse<T>(fn: () => Promise<T> | T): Promise<BackendResponse> {
  try {
    const data = await fn();
    return { data };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { name?: string; message?: string; stack?: string; code?: string };
    return {
      error: {
        name: e.name ?? 'Error',
        message: e.message ?? String(err),
        stack: e.stack,
        code: e.code,
      },
    };
  }
}

export class IpcRouter {
  public readonly dbOps: DbOps;
  public readonly installerOps: InstallerOps;
  public readonly fileOps: FileOps;
  public readonly appOps: AppOps;

  private readonly senderPolicy: SenderPolicy;
  private readonly pathPolicy: PathPolicy;
  private readonly installer: NonNullable<IpcRouterDeps['installer']>;

  constructor(private readonly deps: IpcRouterDeps) {
    this.senderPolicy = deps.senderPolicy ?? new ElectronSenderPolicy(() => deps.windowProvider.getWindow());
    const appPaths: AppPaths = {
      userData: deps.app.getPath('userData'),
      temp: deps.app.getPath('temp'),
      documents: deps.app.getPath('documents') ?? '',
    };
    this.pathPolicy = deps.pathPolicy ?? new PathPolicy(appPaths);
    this.installer = deps.installer ?? {
      isPortAvailable: async (port: number) => {
        const m = await import('../mariadbInstall');
        return m.isPortAvailable(port);
      },
      detectLanIp: () => {
        const m = require('../mariadbInstall') as typeof import('../mariadbInstall');
        return m.detectLanIp();
      },
      pingMariaDB: async (opts: PingOptions) => {
        const m = await import('../mariadbInstall');
        return m.pingMariaDB(opts);
      },
      installMariaDBSilent: async (opts, onProgress) => {
        const m = await import('../mariadbInstall');
        return m.installMariaDBSilent(opts, onProgress);
      },
      resolveMsiPath: async (onProgress) => {
        const m = await import('../mariadbInstall');
        return m.resolveMsiPath(onProgress);
      },
      detectPlatform: () => {
        const m = require('../mariadbInstall') as typeof import('../mariadbInstall');
        return m.detectPlatform();
      },
    };

    this.dbOps = {
      checkDbAccess: this.checkDbAccess.bind(this),
      createNewDatabase: this.createNewDatabase.bind(this),
      connectToDatabase: this.connectToDatabase.bind(this),
      dbCall: this.dbCall.bind(this),
      dbBespoke: this.dbBespoke.bind(this),
      dbSchema: this.dbSchema.bind(this),
      getDbList: this.getDbList.bind(this),
    };

    this.installerOps = {
      isPortAvailable: this.isPortAvailable.bind(this),
      getLanIp: this.getLanIp.bind(this),
      pingMariaDB: this.pingMariaDB.bind(this),
      resolveMsiPath: this.resolveMsiPath.bind(this),
      installMariaDB: this.installMariaDB.bind(this),
      checkDbExists: this.checkDbExists.bind(this),
      createDatabase: this.createDatabase.bind(this),
    };

    this.fileOps = {
      saveData: this.saveData.bind(this),
      deleteFile: this.deleteFile.bind(this),
      selectFile: this.selectFile.bind(this),
      getOpenFilePath: this.getOpenFilePath.bind(this),
      getSaveFilePath: this.getSaveFilePath.bind(this),
      getDialogResponse: this.getDialogResponse.bind(this),
      saveHtmlAsPdf: this.saveHtmlAsPdf.bind(this),
      printHtmlDocument: this.printHtmlDocument.bind(this),
    };

    this.appOps = {
      getEnv: this.getEnv.bind(this),
      getLanguageMap: this.getLanguageMap.bind(this),
      getTemplates: this.getTemplates.bind(this),
      initScheduler: this.initScheduler.bind(this),
      getCreds: this.getCreds.bind(this),
      checkForUpdates: this.checkForUpdates.bind(this),
      sendError: this.sendError.bind(this),
      sendAPIRequest: this.sendAPIRequest.bind(this),
      showError: this.showError.bind(this),
    };
  }

  private assertValidSender(event: Electron.IpcMainInvokeEvent): void {
    if (!this.senderPolicy.isValidSender(event)) throw new Error('Invalid IPC sender');
  }

  async checkDbAccess(config: MariaDBConfig): Promise<boolean> {
    try {
      sanitizeDatabaseName(config.database);
      const { createPool } = await import('mariadb');
      const pool = createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: 1,
      });
      const conn = await pool.getConnection();
      await conn.release();
      await pool.end();
      return true;
    } catch {
      return false;
    }
  }

  private parseConfigFromString(idOrJson: string): MariaDBConfig {
    const byId = findConnectionById(idOrJson);
    if (byId) {
      return { host: byId.host, port: byId.port, user: byId.user, password: byId.password, database: byId.database };
    }
    const cfg = parseMariaDBConfigString(idOrJson);
    sanitizeDatabaseName(cfg.database);
    return cfg;
  }

  async checkDbExists(config: MariaDBConfig): Promise<{ exists: boolean; error?: string }> {
    try {
      sanitizeDatabaseName(config.database);
      const { createConnection } = await import('mariadb');
      const conn = await createConnection({ host: config.host, port: config.port, user: config.user, password: config.password });
      try {
        const rows = (await conn.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [config.database])) as unknown[];
        return { exists: Array.isArray(rows) && rows.length > 0 };
      } finally {
        await conn.end().catch(() => undefined);
      }
    } catch (err) {
      return { exists: false, error: (err as Error).message };
    }
  }

  async createDatabase(config: MariaDBConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const safeDb = sanitizeDatabaseName(config.database);
      const { createConnection } = await import('mariadb');
      const conn = await createConnection({ host: config.host, port: config.port, user: config.user, password: config.password });
      try {
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${safeDb}\``);
        return { ok: true };
      } finally {
        await conn.end().catch(() => undefined);
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async isPortAvailable(port: number) {
    return this.installer.isPortAvailable(port);
  }

  async getLanIp() {
    return this.installer.detectLanIp();
  }

  async pingMariaDB(opts: PingOptions) {
    return this.installer.pingMariaDB(opts);
  }

  async resolveMsiPath(emitProgress: boolean, sender: Electron.WebContents | null) {
    return this.installer.resolveMsiPath(emitProgress ? (e) => sender?.send(IPC_ACTIONS.DOWNLOAD_MARIADB_INSTALLER, e) : undefined);
  }

  async installMariaDB(
    opts: { rootPassword: string; appPassword: string; database: string; port: number; platform?: Platform; hostMode?: boolean },
    sender: Electron.WebContents | null
  ) {
    const safeDb = sanitizeDatabaseName(opts.database);
    return this.installer.installMariaDBSilent(
      { platform: opts.platform ?? this.installer.detectPlatform(), rootPassword: opts.rootPassword, appPassword: opts.appPassword, database: safeDb, port: opts.port, hostMode: opts.hostMode },
      (e) => sender?.send(IPC_ACTIONS.INSTALL_MARIA_DB, e)
    );
  }

  async createNewDatabase(dbPath: string, countryCode: string): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => {
      const cfg = this.resolveMariaDBConfig(dbPath);
      return this.deps.database.createNewDatabase(dbPath, countryCode);
    });
  }

  async connectToDatabase(dbPath: string, countryCode?: string): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => {
      const cfg = this.resolveMariaDBConfig(dbPath);
      void cfg;
      return this.deps.database.connectToDatabase(dbPath, countryCode);
    });
  }

  private resolveMariaDBConfig(dbPath: string): MariaDBConfig {
    const byId = findConnectionById(dbPath);
    if (byId) {
      const cfgStore = require('utils/config').default as typeof import('utils/config').default;
      cfgStore.set('lastSelectedConnectionId' as never, byId.id as never);
      return { host: byId.host, port: byId.port, user: byId.user, password: byId.password, database: byId.database };
    }
    const cfg = parseMariaDBConfigString(dbPath);
    sanitizeDatabaseName(cfg.database);
    const conn = upsertConnectionFromConfig(cfg.database, cfg);
    const cfgStore = require('utils/config').default as typeof import('utils/config').default;
    cfgStore.set('lastSelectedConnectionId' as never, conn.id as never);
    cfgStore.set('lastSelectedFilePath' as never, dbPath as never);
    return cfg;
  }

  async dbCall(method: DatabaseMethod, ...args: unknown[]): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => (this.deps.database as unknown as { call: (m: DatabaseMethod, ...a: unknown[]) => Promise<unknown> }).call(method, ...args));
  }

  async dbBespoke(method: string, ...args: unknown[]): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => (this.deps.database as unknown as { callBespoke: (m: string, ...a: unknown[]) => Promise<unknown> }).callBespoke(method, ...args));
  }

  async dbSchema(): Promise<BackendResponse> {
    return getErrorHandledResponse(() => this.deps.database.getSchemaMap() as unknown);
  }

  async getDbList(): Promise<unknown> {
    migrateLegacyConnections();
    const metas = getConnectionsMetadata();
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
    const files = await setAndGetCleanedConfigFiles();
    return getConfigFilesWithModified(files);
  }

  async saveData(data: string, savePath: string, event: Electron.IpcMainInvokeEvent): Promise<void> {
    this.assertValidSender(event);
    this.pathPolicy.assertAllowed(savePath);
    if (typeof data !== 'string' || data.length > 50 * 1024 * 1024) {
      throw new Error('SAVE_DATA: invalid data');
    }
    await fs.writeFile(savePath, data, { encoding: 'utf-8' });
  }

  async deleteFile(filePath: string, event: Electron.IpcMainInvokeEvent): Promise<BackendResponse> {
    this.assertValidSender(event);
    const byId = findConnectionById(filePath);
    if (byId) {
      const conns = getPersistedConnections();
      const filtered = conns.filter((c) => c.id !== filePath);
      const cfg = (await import('utils/config')).default;
      cfg.set('connections' as never, filtered as never);
      const files = (cfg.get('files', []) as import('fyo/core/types').ConfigFile[]).filter((f) => f.id !== filePath);
      cfg.set('files', files);
      return getErrorHandledResponse(async () => undefined);
    }
    this.pathPolicy.assertAllowed(filePath);
    return getErrorHandledResponse(async () => fs.unlink(filePath));
  }

  async selectFile(options: SelectFileOptions, window: Electron.BrowserWindow | null): Promise<SelectFileReturn> {
    const response: SelectFileReturn = { name: '', filePath: '', success: false, data: Buffer.from('', 'utf-8'), canceled: false };
    const { filePaths, canceled } = await this.deps.dialog.showOpenDialog(window!, { ...options, properties: ['openFile'] });
    response.filePath = filePaths?.[0];
    response.canceled = canceled;
    if (!response.filePath) return response;
    response.success = true;
    if (canceled) return response;
    response.name = path.basename(response.filePath);
    response.data = await fs.readFile(response.filePath);
    return response;
  }

  async getOpenFilePath(options: OpenDialogOptions, window: Electron.BrowserWindow | null) {
    return this.deps.dialog.showOpenDialog(window!, options);
  }

  async getSaveFilePath(options: SaveDialogOptions, window: Electron.BrowserWindow | null) {
    return this.deps.dialog.showSaveDialog(window!, options);
  }

  async getDialogResponse(options: MessageBoxOptions, window: Electron.BrowserWindow | null, isDevelopment: boolean, isLinux: boolean, icon: string) {
    if (isDevelopment || isLinux) Object.assign(options, { icon });
    return this.deps.dialog.showMessageBox(window!, options);
  }

  async saveHtmlAsPdf(html: string, savePath: string, width: number, height: number, app: Electron.App) {
    return saveHtmlAsPdf(html, savePath, app as never, width, height);
  }

  async printHtmlDocument(html: string, width: number, height: number, app: Electron.App) {
    return printHtmlDocument(html, app as never, width, height);
  }

  async getEnv(isDevelopment: boolean, platform: string, version: string) {
    return { isDevelopment, platform, version };
  }

  async getLanguageMap(code: string) {
    const obj = { languageMap: {}, success: true, message: '' } as { languageMap: unknown; success: boolean; message: string };
    try {
      obj.languageMap = await getLanguageMap(code);
    } catch (err) {
      obj.success = false;
      obj.message = (err as Error).message;
    }
    return obj;
  }

  async getTemplates(posPrintWidth?: number) {
    return getTemplates(posPrintWidth);
  }

  async initScheduler(main: unknown, interval: string) {
    return initScheduler(main as never, interval);
  }

  getCreds() {
    return getUrlAndTokenString();
  }

  async checkForUpdates(isDevelopment: boolean, checkedForUpdate: boolean, onChecked: () => void) {
    if (isDevelopment || checkedForUpdate) return;
    try {
      const updater = this.deps.autoUpdater ?? (await import('electron-updater')).autoUpdater;
      await updater.checkForUpdates();
    } catch (error) {
      if (isExpectedUpdateError(error as Error)) return;
      emitMainProcessError(error);
    }
    onChecked();
  }

  async sendError(bodyJson: string, main: unknown) {
    await sendError(bodyJson, main as never);
  }

  async sendAPIRequest(endpoint: string, options: NodeFetchRequestInit | undefined, event: Electron.IpcMainInvokeEvent) {
    this.assertValidSender(event);
    assertAllowedApiEndpoint(endpoint);
    return sendAPIRequest(endpoint, options);
  }

  async showError(title: string, content: string) {
    return this.deps.dialog.showErrorBox(title, content);
  }

  register(): void {
    const w = () => this.deps.windowProvider.getWindow();
    const ipc = this.deps.ipcMain ?? ((): typeof import('electron').ipcMain => {
      return require('electron').ipcMain as typeof import('electron').ipcMain;
    })();

    const withSender = <T extends unknown[]>(fn: (event: Electron.IpcMainInvokeEvent, ...args: T) => Promise<unknown>) =>
      async (event: Electron.IpcMainInvokeEvent, ...args: T) => {
        this.assertValidSender(event);
        return fn(event, ...args);
      };

    // DbOps
    ipc.handle(IPC_ACTIONS.CHECK_DB_ACCESS, withSender(async (_e, dbPathOrConfig: string | MariaDBConfig) => {
      const cfg = typeof dbPathOrConfig === 'string' ? this.parseConfigFromString(dbPathOrConfig) : dbPathOrConfig as MariaDBConfig;
      return this.checkDbAccess(cfg);
    }));
    ipc.handle(IPC_ACTIONS.CHECK_DB_EXISTS, withSender(async (_e, config: MariaDBConfig) => this.checkDbExists(config)));
    ipc.handle(IPC_ACTIONS.CREATE_DATABASE, withSender(async (_e, config: MariaDBConfig) => this.createDatabase(config)));
    ipc.handle(IPC_ACTIONS.DB_CREATE, withSender(async (_e, dbPath: string, countryCode: string) => this.createNewDatabase(dbPath, countryCode)));
    ipc.handle(IPC_ACTIONS.DB_CONNECT, withSender(async (_e, dbPath: string, countryCode?: string) => this.connectToDatabase(dbPath, countryCode)));
    ipc.handle(IPC_ACTIONS.DB_CALL, withSender(async (_e, method: DatabaseMethod, ...args: unknown[]) => this.dbCall(method, ...args)));
    ipc.handle(IPC_ACTIONS.DB_BESPOKE, withSender(async (_e, method: string, ...args: unknown[]) => this.dbBespoke(method, ...args)));
    ipc.handle(IPC_ACTIONS.DB_SCHEMA, withSender(async () => this.dbSchema()));
    ipc.handle(IPC_ACTIONS.GET_DB_LIST, withSender(async () => this.getDbList()));

    // InstallerOps
    ipc.handle(IPC_ACTIONS.IS_PORT_AVAILABLE, withSender(async (_e, port: number) => this.isPortAvailable(port)));
    ipc.handle(IPC_ACTIONS.GET_LAN_IP, withSender(async () => this.getLanIp()));
    ipc.handle(IPC_ACTIONS.PING_MARIA_DB, withSender(async (_e, opts: PingOptions) => this.pingMariaDB(opts)));
    ipc.handle(IPC_ACTIONS.DOWNLOAD_MARIADB_INSTALLER, withSender(async (e, emitProgress: boolean) => this.resolveMsiPath(emitProgress, (e as unknown as { sender: Electron.WebContents }).sender ?? w()?.webContents ?? null)));
    ipc.handle(IPC_ACTIONS.INSTALL_MARIA_DB, withSender(async (e, opts: { rootPassword: string; appPassword: string; database: string; port: number; platform?: Platform; hostMode?: boolean }) => this.installMariaDB(opts, (e as unknown as { sender: Electron.WebContents }).sender ?? w()?.webContents ?? null)));

    // FileOps
    ipc.handle(IPC_ACTIONS.SAVE_DATA, withSender(async (event, data: string, savePath: string) => this.saveData(data, savePath, event)));
    ipc.handle(IPC_ACTIONS.DELETE_FILE, withSender(async (event, filePath: string) => this.deleteFile(filePath, event)));
    ipc.handle(IPC_ACTIONS.SELECT_FILE, withSender(async (_e, options: SelectFileOptions) => this.selectFile(options, w())));
    ipc.handle(IPC_ACTIONS.GET_OPEN_FILEPATH, withSender(async (_e, options: OpenDialogOptions) => this.getOpenFilePath(options, w())));
    ipc.handle(IPC_ACTIONS.GET_SAVE_FILEPATH, withSender(async (_e, options: SaveDialogOptions) => this.getSaveFilePath(options, w())));
    ipc.handle(IPC_ACTIONS.GET_DIALOG_RESPONSE, withSender(async (_e, options: MessageBoxOptions) => this.getDialogResponse(options, w(), this.deps.windowProvider.isDevelopment, this.deps.windowProvider.isLinux, this.deps.windowProvider.icon)));
    ipc.handle(IPC_ACTIONS.SAVE_HTML_AS_PDF, withSender(async (_e, html: string, savePath: string, width: number, height: number) => this.saveHtmlAsPdf(html, savePath, width, height, this.deps.app)));
    ipc.handle(IPC_ACTIONS.PRINT_HTML_DOCUMENT, withSender(async (_e, html: string, width: number, height: number) => this.printHtmlDocument(html, width, height, this.deps.app)));

    // AppOps
    ipc.handle(IPC_ACTIONS.SHOW_ERROR, withSender(async (_e, { title, content }: { title: string; content: string }) => this.showError(title, content)));
    ipc.handle(IPC_ACTIONS.SEND_ERROR, withSender(async (_e, bodyJson: string) => this.sendError(bodyJson, this.deps.windowProvider as unknown)));
    ipc.handle(IPC_ACTIONS.SEND_API_REQUEST, withSender(async (event, endpoint: string, options: NodeFetchRequestInit | undefined) => this.sendAPIRequest(endpoint, options, event)));
    ipc.handle(IPC_ACTIONS.CHECK_FOR_UPDATES, withSender(async () => this.checkForUpdates(this.deps.windowProvider.isDevelopment, this.deps.windowProvider.checkedForUpdate, () => { this.deps.windowProvider.checkedForUpdate = true; })));
    ipc.handle(IPC_ACTIONS.GET_LANGUAGE_MAP, withSender(async (_e, code: string) => this.getLanguageMap(code)));
    ipc.handle(IPC_ACTIONS.GET_CREDS, withSender(async () => this.getCreds()));
    ipc.handle(IPC_ACTIONS.GET_ENV, withSender(async () => {
      let version = this.deps.app.getVersion();
      if (this.deps.windowProvider.isDevelopment) {
        try {
          const pkg = await fs.readFile('package.json', 'utf-8');
          version = (JSON.parse(pkg) as { version: string }).version;
        } catch {}
      }
      return this.getEnv(this.deps.windowProvider.isDevelopment, process.platform, version);
    }));
    ipc.handle(IPC_ACTIONS.GET_TEMPLATES, withSender(async (_e, posPrintWidth?: number) => this.getTemplates(posPrintWidth)));
    ipc.handle(IPC_ACTIONS.INIT_SHEDULER, withSender(async (_e, interval: string) => this.initScheduler(this.deps.windowProvider as unknown, interval)));
  }
}

export function createProdRouter(main: import('../bootstrap').Main): IpcRouter {
  const winProvider: WindowProvider = {
    getWindow: () => main.mainWindow,
    get isDevelopment() { return main.isDevelopment; },
    get isLinux() { return main.isLinux; },
    get checkedForUpdate() { return main.checkedForUpdate; },
    set checkedForUpdate(v: boolean) { main.checkedForUpdate = v; },
    get icon() { return main.icon; },
  };
  const { app: electronApp, dialog: electronDialog } = require('electron') as typeof import('electron');
  return new IpcRouter({
    database: asDatabase(databaseManager),
    windowProvider: winProvider,
    app: electronApp,
    dialog: electronDialog,
  });
}
