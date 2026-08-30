import type {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type { ConfigMap } from 'fyo/core/types';
import config from 'utils/config';
import type { DatabaseMethod } from 'utils/db/types';
import type { BackendResponse } from 'utils/ipc/types';
import { IPC_ACTIONS, IPC_CHANNELS, IPC_MESSAGES } from 'utils/messages';
import type {
  ConfigFilesWithModified,
  Creds,
  LanguageMap,
  SelectFileOptions,
  SelectFileReturn,
  TemplateFile,
} from 'utils/types';
import type {
  InstallResult,
  PingOptions,
  PingResult,
  PortCheckResult,
  Platform,
} from 'utils/mariadb-types';

type IPCRendererListener = Parameters<typeof ipcRenderer.on>[1];
const ipc = {
  desktop: true,

  reloadWindow() {
    return ipcRenderer.send(IPC_MESSAGES.RELOAD_MAIN_WINDOW);
  },

  minimizeWindow() {
    return ipcRenderer.send(IPC_MESSAGES.MINIMIZE_MAIN_WINDOW);
  },

  toggleMaximize() {
    return ipcRenderer.send(IPC_MESSAGES.MAXIMIZE_MAIN_WINDOW);
  },

  isMaximized() {
    return new Promise((resolve) => {
      ipcRenderer.send(IPC_MESSAGES.ISMAXIMIZED_MAIN_WINDOW);
      ipcRenderer.once(
        IPC_MESSAGES.ISMAXIMIZED_RESULT,
        (_event, isMaximized) => {
          resolve(isMaximized);
        }
      );
    });
  },

  isFullscreen() {
    return new Promise((resolve) => {
      ipcRenderer.send(IPC_MESSAGES.ISFULLSCREEN_MAIN_WINDOW);
      ipcRenderer.once(
        IPC_MESSAGES.ISFULLSCREEN_RESULT,
        (_event, isFullscreen) => {
          resolve(isFullscreen);
        }
      );
    });
  },

  closeWindow() {
    return ipcRenderer.send(IPC_MESSAGES.CLOSE_MAIN_WINDOW);
  },

  async getCreds() {
    return (await ipcRenderer.invoke(IPC_ACTIONS.GET_CREDS)) as Creds;
  },

  async getLanguageMap(code: string) {
    return (await ipcRenderer.invoke(IPC_ACTIONS.GET_LANGUAGE_MAP, code)) as {
      languageMap: LanguageMap;
      success: boolean;
      message: string;
    };
  },

  async getTemplates(posTemplateWidth?: number): Promise<TemplateFile[]> {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.GET_TEMPLATES,
      posTemplateWidth
    )) as TemplateFile[];
  },

  async initScheduler(time: string) {
    await ipcRenderer.invoke(IPC_ACTIONS.INIT_SHEDULER, time);
  },

  async selectFile(options: SelectFileOptions): Promise<SelectFileReturn> {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.SELECT_FILE,
      options
    )) as SelectFileReturn;
  },

  async getSaveFilePath(options: SaveDialogOptions) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.GET_SAVE_FILEPATH,
      options
    )) as SaveDialogReturnValue;
  },

  async getOpenFilePath(options: OpenDialogOptions) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.GET_OPEN_FILEPATH,
      options
    )) as OpenDialogReturnValue;
  },

  async checkDbAccess(filePath: string) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.CHECK_DB_ACCESS,
      filePath
    )) as boolean;
  },

  async checkForUpdates() {
    await ipcRenderer.invoke(IPC_ACTIONS.CHECK_FOR_UPDATES);
  },

  openLink(link: string) {
    ipcRenderer.send(IPC_MESSAGES.OPEN_EXTERNAL, link);
  },

  async deleteFile(filePath: string) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.DELETE_FILE,
      filePath
    )) as BackendResponse;
  },

  async saveData(data: string, savePath: string) {
    await ipcRenderer.invoke(IPC_ACTIONS.SAVE_DATA, data, savePath);
  },

  showItemInFolder(filePath: string) {
    ipcRenderer.send(IPC_MESSAGES.SHOW_ITEM_IN_FOLDER, filePath);
  },

  async makePDF(
    html: string,
    savePath: string,
    width: number,
    height: number
  ): Promise<boolean> {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.SAVE_HTML_AS_PDF,
      html,
      savePath,
      width,
      height
    )) as boolean;
  },

  async printDocument(
    html: string,
    width: number,
    height: number
  ): Promise<boolean> {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.PRINT_HTML_DOCUMENT,
      html,
      width,
      height
    )) as boolean;
  },

  async getDbList() {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.GET_DB_LIST
    )) as ConfigFilesWithModified[];
  },

  async isPortAvailable(port: number) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.IS_PORT_AVAILABLE,
      port
    )) as PortCheckResult;
  },

  async getLanIp() {
    return (await ipcRenderer.invoke(IPC_ACTIONS.GET_LAN_IP)) as string | null;
  },

  async checkDbExists(options: { host: string; port: number; user: string; password: string; database: string }) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.CHECK_DB_EXISTS,
      options
    )) as { exists: boolean; error?: string };
  },

  async createDatabase(options: { host: string; port: number; user: string; password: string; database: string }) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.CREATE_DATABASE,
      options
    )) as { ok: boolean; error?: string };
  },

  async downloadMariaDBInstaller(emitProgress: boolean) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.DOWNLOAD_MARIADB_INSTALLER,
      emitProgress
    )) as string;
  },

  async installMariaDB(options: {
    rootPassword: string;
    appPassword: string;
    database: string;
    port: number;
    platform?: Platform;
    hostMode?: boolean;
  }) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.INSTALL_MARIA_DB,
      options
    )) as InstallResult;
  },

  async pingMariaDB(options: PingOptions) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.PING_MARIA_DB,
      options
    )) as PingResult;
  },

  registerMariaDBProgressListener(
    channel:
      IPC_ACTIONS.INSTALL_MARIA_DB | IPC_ACTIONS.DOWNLOAD_MARIADB_INSTALLER,
    listener: IPCRendererListener
  ) {
    ipcRenderer.on(channel, listener);
  },

  removeMariaDBProgressListener(
    channel:
      IPC_ACTIONS.INSTALL_MARIA_DB | IPC_ACTIONS.DOWNLOAD_MARIADB_INSTALLER,
    listener?: IPCRendererListener
  ) {
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
    } else {
      ipcRenderer.removeAllListeners(channel);
    }
  },

  async getEnv() {
    return (await ipcRenderer.invoke(IPC_ACTIONS.GET_ENV)) as {
      isDevelopment: boolean;
      platform: string;
      version: string;
    };
  },

  openExternalUrl(url: string) {
    ipcRenderer.send(IPC_MESSAGES.OPEN_EXTERNAL, url);
  },

  async showError(title: string, content: string) {
    await ipcRenderer.invoke(IPC_ACTIONS.SHOW_ERROR, { title, content });
  },

  async sendError(body: string) {
    await ipcRenderer.invoke(IPC_ACTIONS.SEND_ERROR, body);
  },

  async sendAPIRequest(endpoint: string, options: RequestInit | undefined) {
    return (await ipcRenderer.invoke(
      IPC_ACTIONS.SEND_API_REQUEST,
      endpoint,
      options
    )) as Promise<
      {
        [key: string]: string | number | boolean | Date | object | object[];
      }[]
    >;
  },

  registerMainProcessErrorListener(listener: IPCRendererListener) {
    ipcRenderer.on(IPC_CHANNELS.LOG_MAIN_PROCESS_ERROR, listener);
  },

  registerTriggerFrontendActionListener(listener: IPCRendererListener) {
    ipcRenderer.on(IPC_CHANNELS.TRIGGER_ERPNEXT_SYNC, listener);
  },

  registerConsoleLogListener(listener: IPCRendererListener) {
    ipcRenderer.on(IPC_CHANNELS.CONSOLE_LOG, listener);
  },

  db: {
    async getSchema() {
      return (await ipcRenderer.invoke(
        IPC_ACTIONS.DB_SCHEMA
      )) as BackendResponse;
    },

    async create(dbPath: string, countryCode?: string) {
      return (await ipcRenderer.invoke(
        IPC_ACTIONS.DB_CREATE,
        dbPath,
        countryCode
      )) as BackendResponse;
    },

    async connect(dbPath: string, countryCode?: string) {
      return (await ipcRenderer.invoke(
        IPC_ACTIONS.DB_CONNECT,
        dbPath,
        countryCode
      )) as BackendResponse;
    },

    async call(method: DatabaseMethod, ...args: unknown[]) {
      return (await ipcRenderer.invoke(
        IPC_ACTIONS.DB_CALL,
        method,
        ...args
      )) as BackendResponse;
    },

    async bespoke(method: string, ...args: unknown[]) {
      return (await ipcRenderer.invoke(
        IPC_ACTIONS.DB_BESPOKE,
        method,
        ...args
      )) as BackendResponse;
    },
  },

  store: {
    get<K extends keyof ConfigMap>(key: K) {
      const value = config.get(key);
      // Never expose raw connections with passwords to renderer; return safe metadata
      if (key === 'connections' && Array.isArray(value)) {
        return (value as unknown as import('utils/mariadb-types').PersistedConnection[]).map(
          (c) => ({
            id: c.id,
            companyName: c.companyName,
            host: c.host,
            port: c.port,
            user: c.user,
            database: c.database,
            openCount: c.openCount,
            display: `${c.database} @ ${c.host}:${c.port} (${c.user})`,
          })
        ) as unknown as ConfigMap[K];
      }
      if (key === 'lastSelectedFilePath' && typeof value === 'string') {
        // If it's a MariaDB JSON, don't expose raw password to renderer via store; return ID if available
        try {
          const { parseMariaDBConfigString } = require('utils/mariadb-types') as typeof import('utils/mariadb-types');
          parseMariaDBConfigString(value);
          // It's a MariaDB JSON — try to map to connection ID
          const conns = config.get('connections' as never) as import('utils/mariadb-types').PersistedConnection[] | undefined;
          const found = conns?.find(
            (c) => c.host === JSON.parse(value).host && c.port === JSON.parse(value).port && c.database === JSON.parse(value).database
          );
          if (found) return found.id as unknown as ConfigMap[K];
        } catch {}
      }
      return value;
    },

    set<K extends keyof ConfigMap>(key: K, value: ConfigMap[K]) {
      // Disallow renderer from directly writing connections with arbitrary passwords; must go via IPC
      if (key === 'connections') {
        throw new Error('connections must be set via main process');
      }
      return config.set(key, value);
    },

    delete(key: keyof ConfigMap) {
      return config.delete(key);
    },
  },
} as const;

// Robust preload exposure: supports contextIsolation + sandbox false/true, with fallback logging
try {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('ipc', ipc);
  } else {
    // Fallback for environments where contextIsolation is disabled (should not happen in prod)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as unknown as { ipc: typeof ipc }).ipc = ipc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as unknown as { ipc: typeof ipc }).ipc = ipc;
  }
} catch (error) {
  // Last resort: attempt direct window assignment and log
  // no-console: preload bootstrap failure must be visible in the main process logs
  // eslint-disable-next-line no-console
  console.error('[preload] contextBridge.exposeInMainWorld failed:', error);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as unknown as { ipc: typeof ipc }).ipc = ipc;
  } catch {}
}

// Ensure unhandled preload errors are visible in main logs
window.addEventListener('error', (event) => {
  // no-console: preload has no access to electron-log; forward to devtools console
  // eslint-disable-next-line no-console
  console.error('[preload] window.onerror:', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  // no-console: preload has no access to electron-log; forward to devtools console
  // eslint-disable-next-line no-console
  console.error('[preload] unhandledrejection:', event.reason);
});

export type IPC = typeof ipc;
