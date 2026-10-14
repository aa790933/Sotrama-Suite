import { contextBridge, ipcRenderer } from 'electron';
import config from 'utils/config';
import { IPC_ACTIONS, IPC_CHANNELS, IPC_MESSAGES } from 'utils/messages';
import { equalsConnection, toSafeDisplay } from 'utils/mariadb-types';
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
            ipcRenderer.once(IPC_MESSAGES.ISMAXIMIZED_RESULT, (_event, isMaximized) => {
                resolve(isMaximized);
            });
        });
    },
    isFullscreen() {
        return new Promise((resolve) => {
            ipcRenderer.send(IPC_MESSAGES.ISFULLSCREEN_MAIN_WINDOW);
            ipcRenderer.once(IPC_MESSAGES.ISFULLSCREEN_RESULT, (_event, isFullscreen) => {
                resolve(isFullscreen);
            });
        });
    },
    closeWindow() {
        return ipcRenderer.send(IPC_MESSAGES.CLOSE_MAIN_WINDOW);
    },
    async getCreds() {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_CREDS));
    },
    async getLanguageMap(code) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_LANGUAGE_MAP, code));
    },
    async getTemplates(posTemplateWidth) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_TEMPLATES, posTemplateWidth));
    },
    async initScheduler(time) {
        await ipcRenderer.invoke(IPC_ACTIONS.INIT_SHEDULER, time);
    },
    async selectFile(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.SELECT_FILE, options));
    },
    async getSaveFilePath(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_SAVE_FILEPATH, options));
    },
    async getOpenFilePath(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_OPEN_FILEPATH, options));
    },
    async checkDbAccess(filePath) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.CHECK_DB_ACCESS, filePath));
    },
    /**
     * Main-process-owned connection persistence. The preload `store.set`
     * guard rejects direct `connections` writes from the renderer (password
     * custody); connection upserts go through this channel instead.
     */
    async upsertConnection(payload) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.UPSERT_CONNECTION, payload));
    },
    async checkForUpdates() {
        await ipcRenderer.invoke(IPC_ACTIONS.CHECK_FOR_UPDATES);
    },
    openLink(link) {
        ipcRenderer.send(IPC_MESSAGES.OPEN_EXTERNAL, link);
    },
    async deleteFile(filePath) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.DELETE_FILE, filePath));
    },
    async saveData(data, savePath) {
        await ipcRenderer.invoke(IPC_ACTIONS.SAVE_DATA, data, savePath);
    },
    showItemInFolder(filePath) {
        ipcRenderer.send(IPC_MESSAGES.SHOW_ITEM_IN_FOLDER, filePath);
    },
    async makePDF(html, savePath, width, height) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.SAVE_HTML_AS_PDF, html, savePath, width, height));
    },
    async printDocument(html, width, height) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.PRINT_HTML_DOCUMENT, html, width, height));
    },
    async getDbList() {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_DB_LIST));
    },
    async getLanIp() {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_LAN_IP));
    },
    async checkDbExists(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.CHECK_DB_EXISTS, options));
    },
    async createDatabase(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.CREATE_DATABASE, options));
    },
    async provisionMariaDB(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.INSTALL_MARIA_DB, options));
    },
    async pingMariaDB(options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.PING_MARIA_DB, options));
    },
    registerMariaDBProgressListener(channel, listener) {
        ipcRenderer.on(channel, listener);
    },
    removeMariaDBProgressListener(channel, listener) {
        if (listener) {
            ipcRenderer.removeListener(channel, listener);
        }
        else {
            ipcRenderer.removeAllListeners(channel);
        }
    },
    async getEnv() {
        return (await ipcRenderer.invoke(IPC_ACTIONS.GET_ENV));
    },
    openExternalUrl(url) {
        ipcRenderer.send(IPC_MESSAGES.OPEN_EXTERNAL, url);
    },
    async showError(title, content) {
        await ipcRenderer.invoke(IPC_ACTIONS.SHOW_ERROR, { title, content });
    },
    async sendError(body) {
        await ipcRenderer.invoke(IPC_ACTIONS.SEND_ERROR, body);
    },
    async sendAPIRequest(endpoint, options) {
        return (await ipcRenderer.invoke(IPC_ACTIONS.SEND_API_REQUEST, endpoint, options));
    },
    registerMainProcessErrorListener(listener) {
        ipcRenderer.on(IPC_CHANNELS.LOG_MAIN_PROCESS_ERROR, listener);
    },
    registerTriggerFrontendActionListener(listener) {
        ipcRenderer.on(IPC_CHANNELS.TRIGGER_ERPNEXT_SYNC, listener);
    },
    registerConsoleLogListener(listener) {
        ipcRenderer.on(IPC_CHANNELS.CONSOLE_LOG, listener);
    },
    db: {
        async getSchema() {
            return (await ipcRenderer.invoke(IPC_ACTIONS.DB_SCHEMA));
        },
        async create(dbPath, countryCode) {
            return (await ipcRenderer.invoke(IPC_ACTIONS.DB_CREATE, dbPath, countryCode));
        },
        async connect(dbPath, countryCode) {
            return (await ipcRenderer.invoke(IPC_ACTIONS.DB_CONNECT, dbPath, countryCode));
        },
        async call(method, ...args) {
            return (await ipcRenderer.invoke(IPC_ACTIONS.DB_CALL, method, ...args));
        },
    },
    store: {
        get(key) {
            const value = config.get(key);
            // Never expose raw connections with passwords to renderer; return safe metadata
            if (key === 'connections') {
                if (!Array.isArray(value)) {
                    return [];
                }
                return value.filter((c) => c && typeof c === 'object').map((c) => ({
                    id: c.id,
                    companyName: c.companyName,
                    host: c.host,
                    port: c.port,
                    user: c.user,
                    database: c.database,
                    openCount: c.openCount,
                    display: toSafeDisplay(c),
                }));
            }
            if (key === 'lastSelectedFilePath' && typeof value === 'string') {
                // If it's a MariaDB JSON, don't expose raw password to renderer via store; return ID if available
                if (value.trimStart().startsWith('{')) {
                    try {
                        const { parseMariaDBConfigString } = require('utils/mariadb-types');
                        const parsed = parseMariaDBConfigString(value);
                        const conns = config.get('connections');
                        const found = Array.isArray(conns)
                            ? conns.find((c) => c && typeof c === 'object' && equalsConnection(c, parsed))
                            : undefined;
                        return found?.id ?? null;
                    }
                    catch {
                        // A JSON-looking value may contain credentials; never return it unchanged.
                        return null;
                    }
                }
                try {
                    const { parseMariaDBConfigString } = require('utils/mariadb-types');
                    const parsed = parseMariaDBConfigString(value);
                    // It's a MariaDB JSON — try to map to connection ID
                    const conns = config.get('connections');
                    const found = conns?.find((c) => equalsConnection(c, parsed));
                    if (found)
                        return found.id;
                }
                catch { }
            }
            return value;
        },
        set(key, value) {
            // Disallow renderer from directly writing connections with arbitrary passwords; must go via IPC
            if (key === 'connections') {
                throw new Error('connections must be set via main process');
            }
            return config.set(key, value);
        },
        delete(key) {
            return config.delete(key);
        },
    },
};
// Robust preload exposure: supports contextIsolation + sandbox false/true, with fallback logging
try {
    if (process.contextIsolated) {
        contextBridge.exposeInMainWorld('ipc', ipc);
    }
    else {
        // Fallback for environments where contextIsolation is disabled (should not happen in prod)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        globalThis.ipc = ipc;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.ipc = ipc;
    }
}
catch (error) {
    // Last resort: attempt direct window assignment and log
    // no-console: preload bootstrap failure must be visible in the main process logs
    // eslint-disable-next-line no-console
    console.error('[preload] contextBridge.exposeInMainWorld failed:', error);
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.ipc = ipc;
    }
    catch { }
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
