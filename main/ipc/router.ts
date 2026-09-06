import type { MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import type { SelectFileOptions, SelectFileReturn } from 'utils/types';
import { emitMainProcessError } from '../../backend/helpers';
import type DatabaseCore from '../../backend/database/core';
import type { FieldValueMap } from '../../backend/database/types';
import type { DatabaseMethod, GetAllOptions, QueryFilter } from '../../utils/db/types';
import { IPC_ACTIONS } from '../../utils/messages';
import type { MariaDBConfig, PingOptions, InstallResult, HostProvisionConfig } from '../../utils/mariadb-types';
import { detectLanIp, pingMariaDB as pingMariaDBHost, provision as provisionHost } from '../provision/hostProvision';
import { parseMariaDBConfigString } from '../../utils/mariadb-types';
// getUrlAndTokenString / sendError are lazy-imported inside getCreds/sendError to avoid pulling electron at module load
import type { RequestInit as NodeFetchRequestInit } from 'node-fetch';
import { getLanguageMap } from '../getLanguageMap';
import { getTemplates } from '../getPrintTemplates';
// isExpectedUpdateError is lazy-imported inside checkForUpdates to avoid pulling electron-store at module load
import { sendAPIRequest } from '../api';
import type { BackendResponse } from '../../utils/ipc/types';
import {
  AppPaths,
  ElectronSenderPolicy,
  PathPolicy,
  SenderPolicy,
  assertAllowedApiEndpoint,
  sanitizeDatabaseName,
} from './policies';
import type { ConnectionStore } from './connectionStore';
import { ElectronStoreConnectionStore } from './connectionStore';

// ---- Dependency contracts ----

export interface WindowProvider {
  getWindow(): Electron.BrowserWindow | null;
  isDevelopment: boolean;
  isLinux: boolean;
  checkedForUpdate: boolean;
  icon: string;
}

export interface IpcRouterDeps {
  database: DatabaseCore;
  windowProvider: WindowProvider;
  app: Electron.App;
  dialog: Electron.Dialog;
  ipcMain?: typeof import('electron').ipcMain;
  autoUpdater?: typeof import('electron-updater').autoUpdater;
  senderPolicy?: SenderPolicy;
  pathPolicy?: PathPolicy;
  connectionStore?: ConnectionStore;
}

// ---- Typed sub-interfaces (the seam) ----

export interface DbOps {
  checkDbAccess(config: MariaDBConfig): Promise<{ ok: boolean; error?: string }>;
  createNewDatabase(dbPath: string, countryCode: string): Promise<BackendResponse>;
  connectToDatabase(dbPath: string, countryCode?: string): Promise<BackendResponse>;
  dbCall(method: DatabaseMethod, ...args: unknown[]): Promise<BackendResponse>;
  dbSchema(): Promise<BackendResponse>;
  getDbList(): Promise<unknown>;
}

export interface InstallerOps {
  getLanIp(): Promise<string | null>;
  pingMariaDB(opts: PingOptions): Promise<{ ok: boolean; error?: string }>;
  provisionMariaDB(opts: HostProvisionConfig, sender: Electron.WebContents | null): Promise<InstallResult>;
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

/** IPC router: exposes DbOps/InstallerOps/FileOps/AppOps over validated channels. */
export class IpcRouter {
  public readonly dbOps: DbOps;
  public readonly installerOps: InstallerOps;
  public readonly fileOps: FileOps;
  public readonly appOps: AppOps;

  private readonly senderPolicy: SenderPolicy;
  private readonly pathPolicy: PathPolicy;
  private readonly connectionStore: ConnectionStore;

  constructor(private readonly deps: IpcRouterDeps) {
    this.senderPolicy = deps.senderPolicy ?? new ElectronSenderPolicy(() => deps.windowProvider.getWindow());
    const appPaths: AppPaths = {
      userData: deps.app.getPath('userData'),
      temp: deps.app.getPath('temp'),
      documents: deps.app.getPath('documents') ?? '',
    };
    this.pathPolicy = deps.pathPolicy ?? new PathPolicy(appPaths);
    this.connectionStore = deps.connectionStore ?? new ElectronStoreConnectionStore();

    this.dbOps = {
      checkDbAccess: this.checkDbAccess.bind(this),
      createNewDatabase: this.createNewDatabase.bind(this),
      connectToDatabase: this.connectToDatabase.bind(this),
      dbCall: this.dbCall.bind(this),
      dbSchema: this.dbSchema.bind(this),
      getDbList: this.getDbList.bind(this),
    };

    this.installerOps = {
      getLanIp: this.getLanIp.bind(this),
      pingMariaDB: this.pingMariaDB.bind(this),
      provisionMariaDB: this.provisionMariaDB.bind(this),
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

  async checkDbAccess(config: MariaDBConfig): Promise<{ ok: boolean; error?: string }> {
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
        connectTimeout: 8000,
      });
      const conn = await pool.getConnection();
      await conn.release();
      await pool.end();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private peekConfig(idOrJson: string): MariaDBConfig {
    const byId = this.connectionStore.findById(idOrJson);
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
      const conn = await createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, connectTimeout: 8000 });
      try {
        const result: unknown = await conn.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [config.database]);
        const rows = Array.isArray(result) ? result : [];
        return { exists: rows.length > 0 };
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
      const conn = await createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, connectTimeout: 8000 });
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLanIp() {
    return detectLanIp();
  }

  async pingMariaDB(opts: PingOptions) {
    return pingMariaDBHost(opts);
  }

  async provisionMariaDB(
    opts: HostProvisionConfig,
    sender: Electron.WebContents | null
  ) {
    const safeDb = sanitizeDatabaseName(opts.database);
    return provisionHost({ ...opts, database: safeDb }, (e) =>
      sender?.send(IPC_ACTIONS.INSTALL_MARIA_DB, e)
    );
  }

  async createNewDatabase(dbPath: string, countryCode: string): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => {
      this.deps.database.setDbConfig(this.connectionStore.resolve(dbPath));
      return this.deps.database.createNewDatabase(dbPath, countryCode);
    });
  }

  async connectToDatabase(dbPath: string, countryCode?: string): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => {
      this.deps.database.setDbConfig(this.connectionStore.resolve(dbPath));
      return this.deps.database.connectToDatabase(dbPath, countryCode);
    });
  }

  async dbCall(method: DatabaseMethod, ...args: unknown[]): Promise<BackendResponse> {
    return getErrorHandledResponse(async () => {
      const db = this.deps.database;
      switch (method) {
        case 'insert': {
          const [schemaName, fieldValueMap] = args as [string, FieldValueMap];
          return db.insert(schemaName, fieldValueMap);
        }
        case 'get': {
          const [schemaName, name, fields] = args as [string, string, (string | string[]) | undefined];
          return db.get(schemaName, name, fields);
        }
        case 'getAll': {
          const [schemaName, options] = args as [string, GetAllOptions | undefined];
          return db.getAll(schemaName, options);
        }
        case 'getSingleValues': {
          return db.getSingleValues(...(args as ({ fieldname: string; parent?: string } | string)[]));
        }
        case 'rename': {
          const [schemaName, oldName, newName] = args as [string, string, string];
          return db.rename(schemaName, oldName, newName);
        }
        case 'update': {
          const [schemaName, fieldValueMap] = args as [string, FieldValueMap];
          return db.update(schemaName, fieldValueMap);
        }
        case 'delete': {
          const [schemaName, name] = args as [string, string];
          return db.delete(schemaName, name);
        }
        case 'deleteAll': {
          const [schemaName, filters] = args as [string, QueryFilter];
          return db.deleteAll(schemaName, filters);
        }
        case 'exists': {
          const [schemaName, name] = args as [string, string | undefined];
          return db.exists(schemaName, name);
        }
        case 'close': {
          return db.close();
        }
        case 'count': {
          const [schemaName, options] = args as [string, GetAllOptions | undefined];
          return db.count(schemaName, options);
        }
        case 'getNextAutoincrementId': {
          const [schemaName] = args as [string];
          return db.getNextAutoincrementId(schemaName);
        }
        case 'getNextSeriesValue': {
          const [prefix, schemaName] = args as [string, string];
          return db.getNextSeriesValue(prefix, schemaName);
        }
        default: {
          throw new Error(`Unknown database method: ${String(method)}`);
        }
      }
    });
  }

  async dbSchema(): Promise<BackendResponse> {
    return getErrorHandledResponse(() => this.deps.database.getSchemaMap());
  }

  async getDbList(): Promise<unknown> {
    return this.connectionStore.getDbList();
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
    const byId = this.connectionStore.findById(filePath);
    if (byId) {
      this.connectionStore.deleteById(filePath);
      return getErrorHandledResponse(() => undefined);
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
    const { saveHtmlAsPdf: fn } = await import('../saveHtmlAsPdf');
    return fn(html, savePath, app as never, width, height);
  }

  async printHtmlDocument(html: string, width: number, height: number, app: Electron.App) {
    const { printHtmlDocument: fn } = await import('../printHtmlDocument');
    return fn(html, app as never, width, height);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
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
    const { initScheduler: fn } = await import('../initSheduler');
    return fn(main as never, interval);
  }

  getCreds() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getUrlAndTokenString: getCredsFn } = require('../contactMothership') as typeof import('../contactMothership');
    return getCredsFn();
  }

  async checkForUpdates(isDevelopment: boolean, checkedForUpdate: boolean, onChecked: () => void) {
    if (isDevelopment || checkedForUpdate) return;
    try {
      const updater = this.deps.autoUpdater ?? (await import('electron-updater')).autoUpdater;
      await updater.checkForUpdates();
    } catch (error) {
      // Lazy to avoid pulling electron-store at module load
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isExpectedUpdateError: isExpected } = require('../helpers') as typeof import('../helpers');
      if (isExpected(error as Error)) return;
      emitMainProcessError(error);
    }
    onChecked();
  }

  async sendError(bodyJson: string, main: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendError: sendErr } = require('../contactMothership') as typeof import('../contactMothership');
    await sendErr(bodyJson, main as never);
  }

  async sendAPIRequest(endpoint: string, options: NodeFetchRequestInit | undefined, event: Electron.IpcMainInvokeEvent) {
    this.assertValidSender(event);
    assertAllowedApiEndpoint(endpoint);
    return sendAPIRequest(endpoint, options);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async showError(title: string, content: string) {
    return this.deps.dialog.showErrorBox(title, content);
  }

  register(): void {
    const w = () => this.deps.windowProvider.getWindow();
    const ipc = this.deps.ipcMain ?? ((): typeof import('electron').ipcMain => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return require('electron').ipcMain as typeof import('electron').ipcMain;
    })();

    const withSender = <T extends unknown[]>(fn: (event: Electron.IpcMainInvokeEvent, ...args: T) => Promise<unknown>) =>
      async (event: Electron.IpcMainInvokeEvent, ...args: T) => {
        this.assertValidSender(event);
        return fn(event, ...args);
      };

    // DbOps
    ipc.handle(IPC_ACTIONS.CHECK_DB_ACCESS, withSender(async (_e, dbPathOrConfig: string | MariaDBConfig) => {
      const cfg = typeof dbPathOrConfig === 'string' ? this.peekConfig(dbPathOrConfig) : dbPathOrConfig;
      return this.checkDbAccess(cfg);
    }));
    ipc.handle(IPC_ACTIONS.CHECK_DB_EXISTS, withSender(async (_e, config: MariaDBConfig) => this.checkDbExists(config)));
    ipc.handle(IPC_ACTIONS.CREATE_DATABASE, withSender(async (_e, config: MariaDBConfig) => this.createDatabase(config)));
    ipc.handle(IPC_ACTIONS.DB_CREATE, withSender(async (_e, dbPath: string, countryCode: string) => this.createNewDatabase(dbPath, countryCode)));
    ipc.handle(IPC_ACTIONS.DB_CONNECT, withSender(async (_e, dbPath: string, countryCode?: string) => this.connectToDatabase(dbPath, countryCode)));
    ipc.handle(IPC_ACTIONS.DB_CALL, withSender(async (_e, method: DatabaseMethod, ...args: unknown[]) => this.dbCall(method, ...args)));
    ipc.handle(IPC_ACTIONS.DB_SCHEMA, withSender(async () => this.dbSchema()));
    ipc.handle(IPC_ACTIONS.GET_DB_LIST, withSender(async () => this.getDbList()));

    // InstallerOps
    ipc.handle(IPC_ACTIONS.GET_LAN_IP, withSender(async () => this.getLanIp()));
    ipc.handle(IPC_ACTIONS.PING_MARIA_DB, withSender(async (_e, opts: PingOptions) => this.pingMariaDB(opts)));
    ipc.handle(IPC_ACTIONS.INSTALL_MARIA_DB, withSender(async (e, opts: HostProvisionConfig) => this.provisionMariaDB(opts, (e as unknown as { sender: Electron.WebContents }).sender ?? w()?.webContents ?? null)));

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
    ipc.handle(IPC_ACTIONS.SEND_API_REQUEST, withSender(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (event, endpoint: string, options: NodeFetchRequestInit | undefined) => this.sendAPIRequest(endpoint, options, event)
    ));
    ipc.handle(IPC_ACTIONS.CHECK_FOR_UPDATES, withSender(async () => this.checkForUpdates(this.deps.windowProvider.isDevelopment, this.deps.windowProvider.checkedForUpdate, () => { this.deps.windowProvider.checkedForUpdate = true; })));
    ipc.handle(IPC_ACTIONS.GET_LANGUAGE_MAP, withSender(async (_e, code: string) => this.getLanguageMap(code)));
    ipc.handle(IPC_ACTIONS.GET_CREDS, withSender(
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => this.getCreds()
    ));
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
  // Lazy to avoid pulling the mariadb driver into unit tests at module load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: MainDatabase } = require('../../backend/database/core') as typeof import('../../backend/database/core');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ElectronStoreConnectionStore } = require('./connectionStore') as typeof import('./connectionStore');
  return new IpcRouter({
    database: new MainDatabase(),
    windowProvider: winProvider,
    app: electronApp,
    dialog: electronDialog,
    connectionStore: new ElectronStoreConnectionStore(),
  });
}
