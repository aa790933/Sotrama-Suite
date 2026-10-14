import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { ipcRenderer } from 'electron';
import type { ConfigMap } from 'fyo/core/types';
import type { DatabaseMethod } from 'utils/db/types';
import type { BackendResponse } from 'utils/ipc/types';
import { IPC_ACTIONS } from 'utils/messages';
import type { ConfigFilesWithModified, Creds, LanguageMap, SelectFileOptions, SelectFileReturn, TemplateFile } from 'utils/types';
import type { ConnectionMetadata, HostProvisionConfig, InstallResult, MariaDBConfig, PingOptions, PingResult } from 'utils/mariadb-types';
type IPCRendererListener = Parameters<typeof ipcRenderer.on>[1];
declare const ipc: {
    readonly desktop: true;
    readonly reloadWindow: () => void;
    readonly minimizeWindow: () => void;
    readonly toggleMaximize: () => void;
    readonly isMaximized: () => Promise<unknown>;
    readonly isFullscreen: () => Promise<unknown>;
    readonly closeWindow: () => void;
    readonly getCreds: () => Promise<Creds>;
    readonly getLanguageMap: (code: string) => Promise<{
        languageMap: LanguageMap;
        success: boolean;
        message: string;
    }>;
    readonly getTemplates: (posTemplateWidth?: number) => Promise<TemplateFile[]>;
    readonly initScheduler: (time: string) => Promise<void>;
    readonly selectFile: (options: SelectFileOptions) => Promise<SelectFileReturn>;
    readonly getSaveFilePath: (options: SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
    readonly getOpenFilePath: (options: OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
    readonly checkDbAccess: (filePath: string) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    /**
     * Main-process-owned connection persistence. The preload `store.set`
     * guard rejects direct `connections` writes from the renderer (password
     * custody); connection upserts go through this channel instead.
     */
    readonly upsertConnection: (payload: {
        companyName: string;
        config?: MariaDBConfig;
        connectionId?: string;
        openCount?: number;
    }) => Promise<{
        ok: boolean;
        id?: string;
        error?: string;
    }>;
    readonly checkForUpdates: () => Promise<void>;
    readonly openLink: (link: string) => void;
    readonly deleteFile: (filePath: string) => Promise<BackendResponse>;
    readonly saveData: (data: string, savePath: string) => Promise<void>;
    readonly showItemInFolder: (filePath: string) => void;
    readonly makePDF: (html: string, savePath: string, width: number, height: number) => Promise<boolean>;
    readonly printDocument: (html: string, width: number, height: number) => Promise<boolean>;
    readonly getDbList: () => Promise<ConfigFilesWithModified[]>;
    readonly getLanIp: () => Promise<string | null>;
    readonly checkDbExists: (options: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
    }) => Promise<{
        exists: boolean;
        error?: string;
    }>;
    readonly createDatabase: (options: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
    }) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    readonly provisionMariaDB: (options: HostProvisionConfig) => Promise<InstallResult>;
    readonly pingMariaDB: (options: PingOptions) => Promise<PingResult>;
    readonly registerMariaDBProgressListener: (channel: IPC_ACTIONS.INSTALL_MARIA_DB, listener: IPCRendererListener) => void;
    readonly removeMariaDBProgressListener: (channel: IPC_ACTIONS.INSTALL_MARIA_DB, listener?: IPCRendererListener) => void;
    readonly getEnv: () => Promise<{
        isDevelopment: boolean;
        platform: string;
        version: string;
    }>;
    readonly openExternalUrl: (url: string) => void;
    readonly showError: (title: string, content: string) => Promise<void>;
    readonly sendError: (body: string) => Promise<void>;
    readonly sendAPIRequest: (endpoint: string, options: RequestInit | undefined) => Promise<{
        [key: string]: string | number | boolean | object | Date | object[];
    }[]>;
    readonly registerMainProcessErrorListener: (listener: IPCRendererListener) => void;
    readonly registerTriggerFrontendActionListener: (listener: IPCRendererListener) => void;
    readonly registerConsoleLogListener: (listener: IPCRendererListener) => void;
    readonly db: {
        readonly getSchema: () => Promise<BackendResponse>;
        readonly create: (dbPath: string, countryCode?: string) => Promise<BackendResponse>;
        readonly connect: (dbPath: string, countryCode?: string) => Promise<BackendResponse>;
        readonly call: (method: DatabaseMethod, ...args: unknown[]) => Promise<BackendResponse>;
    };
    readonly store: {
        readonly get: (key: 'connections') => ConnectionMetadata[];
        readonly get: <K extends Exclude<keyof ConfigMap, 'connections'>>(key: K) => ConfigMap[K];
        readonly set: <K extends Exclude<keyof ConfigMap, 'connections'>>(key: K, value: ConfigMap[K]) => void;
        readonly delete: (key: keyof ConfigMap) => void;
    };
};
export type IPC = typeof ipc;
export {};
