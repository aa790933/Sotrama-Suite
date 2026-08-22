// eslint-disable-next-line @typescript-eslint/no-require-imports
const sourceMapSupport =
  require('source-map-support') as typeof import('source-map-support');
sourceMapSupport.install({
  handleUncaughtExceptions: false,
  environment: 'node',
});

import { emitMainProcessError } from 'backend/helpers';
import {
  app,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  dialog,
  protocol,
  ProtocolRequest,
  ProtocolResponse,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import path from 'path';
import registerAppLifecycleListeners from './main/registerAppLifecycleListeners';
import registerAutoUpdaterListeners from './main/registerAutoUpdaterListeners';
import registerIpcMainActionListeners from './main/registerIpcMainActionListeners';
import registerIpcMainMessageListeners from './main/registerIpcMainMessageListeners';
import registerProcessListeners from './main/registerProcessListeners';

// --- Robust crash logger: electron-log if available, fallback to console ---
type MainLogger = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  transports?: unknown;
};
let log: MainLogger = console as unknown as MainLogger;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const el = require('electron-log') as MainLogger & {
    initialize?: (opts: unknown) => void;
  };
  if (el && typeof el.initialize === 'function') {
    el.initialize({ preload: true });
  }
  if (el) log = el;
  if (log.transports) {
    // File logging only in packaged app to avoid dev noise
    const file = (log.transports as { file?: { level?: string } }).file;
    if (file)
      file.level = app.isPackaged ? 'info' : (false as unknown as string);
  }
} catch {
  // electron-log not installed yet – console fallback
}

function setupCrashHandlers() {
  process.on('uncaughtException', (error) => {
    log.error('[main] uncaughtException:', error);
    try {
      emitMainProcessError(error);
    } catch {}
    if (!app.isPackaged) {
      dialog.showErrorBox(
        'Unexpected Error',
        `${error.message}\n\n${error.stack ?? ''}`
      );
    }
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.error('[main] unhandledRejection:', error);
    try {
      emitMainProcessError(error);
    } catch {}
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    log.error('[main] render-process-gone:', details, webContents.getURL());
  });
  app.on('child-process-gone', (_event, details) => {
    log.error('[main] child-process-gone:', details);
  });
}

setupCrashHandlers();

export class Main {
  title = 'Sotrama Suite';
  icon: string;

  winURL = '';
  checkedForUpdate = false;
  mainWindow: BrowserWindow | null = null;

  WIDTH = 1200;
  HEIGHT = process.platform === 'win32' ? 826 : 800;

  constructor() {
    // Use app.isPackaged for reliable prod detection (NODE_ENV may be unset in packaged build)
    this.icon = this.resolveIconPath();

    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'app',
        privileges: {
          secure: true,
          standard: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ]);

    if (this.isDevelopment) {
      autoUpdater.logger = log as unknown as typeof autoUpdater.logger;
    } else {
      autoUpdater.logger = log as unknown as typeof autoUpdater.logger;
    }

    // https://github.com/electron-userland/electron-builder/issues/4987
    app.commandLine.appendSwitch('disable-http2');
    autoUpdater.requestHeaders = {
      'Cache-Control':
        'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    };

    this.registerListeners();
    if (this.isMac && this.isDevelopment) {
      app.dock.setIcon(this.icon);
    }
  }

  get isDevelopment() {
    // Prefer app.isPackaged (Electron's canonical flag) over NODE_ENV
    if (app.isPackaged) return false;
    return process.env.NODE_ENV === 'development';
  }

  get isTest() {
    return !!process.env.IS_TEST;
  }

  get isMac() {
    return process.platform === 'darwin';
  }

  get isLinux() {
    return process.platform === 'linux';
  }

  private resolveIconPath(): string {
    // In prod __dirname = dist_electron/build ; icons are at build/icons/512x512.png
    // Also check process.resourcesPath for asar-unpacked location
    const candidates = [
      // dev
      path.resolve('./build/icon.png'),
      // prod relative to compiled main.js
      path.join(__dirname, 'icons', '512x512.png'),
      path.join(__dirname, '..', 'icons', '512x512.png'),
      // resourcesPath fallback
      path.join(process.resourcesPath, 'app', 'icons', '512x512.png'),
      path.join(process.resourcesPath, 'icons', '512x512.png'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    // fallback to __dirname variant (may not exist yet but Electron tolerates missing icon)
    return path.join(__dirname, 'icons', '512x512.png');
  }

  private getPreloadPath(): string {
    // esbuild emits: main.js at build/ and main/preload.js at build/main/preload.js
    const candidates = [
      path.join(__dirname, 'main', 'preload.js'),
      path.join(__dirname, 'preload.js'),
      path.join(process.resourcesPath, 'app', 'main', 'preload.js'),
      path.join(process.resourcesPath, 'app.asar', 'main', 'preload.js'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          log.info('[main] preload resolved:', p);
          return p;
        }
      } catch {}
    }
    const fallback = path.join(__dirname, 'main', 'preload.js');
    log.warn(
      '[main] preload not found in candidates, using fallback:',
      fallback
    );
    return fallback;
  }

  registerListeners() {
    registerIpcMainMessageListeners(this);
    registerIpcMainActionListeners(this);
    registerAutoUpdaterListeners(this);
    registerAppLifecycleListeners(this);
    registerProcessListeners(this);
  }

  getOptions(): BrowserWindowConstructorOptions {
    const preload = this.getPreloadPath();
    const options: BrowserWindowConstructorOptions = {
      width: this.WIDTH,
      height: this.HEIGHT,
      title: this.title,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload,
      },
      autoHideMenuBar: true,
      frame: !this.isMac,
      resizable: true,
      show: false, // show after ready-to-show to avoid blank flash
    };

    if (this.isDevelopment || this.isLinux) {
      Object.assign(options, { icon: this.icon });
    }

    if (this.isLinux) {
      Object.assign(options, {
        icon: path.join(__dirname, 'icons', '512x512.png'),
      });
    }

    return options;
  }

  async createWindow() {
    const options = this.getOptions();
    this.mainWindow = new BrowserWindow(options);

    // Show window gracefully
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    try {
      if (this.isDevelopment) {
        this.setViteServerURL();
      } else {
        this.registerAppProtocol();
      }

      log.info(
        '[main] loading URL:',
        this.winURL,
        'isPackaged:',
        app.isPackaged,
        'isDevelopment:',
        this.isDevelopment
      );
      await this.mainWindow.loadURL(this.winURL);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('[main] loadURL failed:', error, 'winURL:', this.winURL);
      emitMainProcessError(error);
      if (!this.isDevelopment) {
        // Fallback: try loadFile directly from disk
        try {
          const fallbackPath = path.join(__dirname, 'src', 'index.html');
          log.warn('[main] attempting loadFile fallback:', fallbackPath);
          if (fs.existsSync(fallbackPath)) {
            await this.mainWindow.loadFile(fallbackPath);
          } else {
            dialog.showErrorBox(
              'Failed to load app',
              `${error.message}\nURL: ${this.winURL}\nFallback: ${fallbackPath}`
            );
          }
        } catch (fallbackErr) {
          log.error('[main] fallback loadFile also failed:', fallbackErr);
          dialog.showErrorBox('Failed to load app', `${error.message}`);
        }
      } else {
        dialog.showErrorBox(
          'Failed to load dev server',
          `${error.message}\nURL: ${this.winURL}\nIs vite running on 6969?`
        );
      }
    }

    if (this.isDevelopment && !this.isTest) {
      this.mainWindow.webContents.openDevTools();
    }

    this.setMainWindowListeners();
  }

  setViteServerURL() {
    let port = 6969;
    let host = '127.0.0.1';

    if (process.env.VITE_PORT && process.env.VITE_HOST) {
      port = Number(process.env.VITE_PORT);
      host = process.env.VITE_HOST;
    }

    // Load the url of the dev server if in development mode
    this.winURL = `http://${host}:${port}/`;
  }

  registerAppProtocol() {
    // Modern Electron (>=25) uses protocol.handle with Fetch API
    const protocolHandle = (
      protocol as unknown as {
        handle?: (
          scheme: string,
          handler: (request: Request) => Promise<Response>
        ) => void;
      }
    ).handle;
    if (typeof protocolHandle === 'function') {
      (
        protocolHandle as (
          scheme: string,
          handler: (request: Request) => Promise<Response>
        ) => void
      )('app', async (request: Request) => {
        try {
          const url = new URL(request.url);
          // app://./index.html  -> host=".", pathname="/index.html"
          // app://index.html     -> host="index.html", pathname=""
          let filePath: string;
          if (url.host && url.host !== '.' && !url.pathname.includes('.')) {
            // Rare case: host contains filename without leading dot
            filePath = path.join(
              __dirname,
              'src',
              decodeURI(url.host),
              decodeURI(url.pathname)
            );
          } else {
            const pathname =
              url.pathname === '/' && url.host !== '.'
                ? `/${url.host}`
                : url.pathname;
            const hostPart = url.host === '.' ? '' : url.host;
            filePath = path.join(
              __dirname,
              'src',
              decodeURI(hostPart),
              decodeURI(pathname)
            );
            // Normalize: app://./index.html -> __dirname/src/index.html
            if (filePath.endsWith(path.join('src', '.'))) {
              filePath = path.join(__dirname, 'src', 'index.html');
            }
          }
          // Handle directory request -> serve index.html
          if (filePath.endsWith(path.sep) || filePath.endsWith('/')) {
            filePath = path.join(filePath, 'index.html');
          }
          log.info('[protocol] handle:', request.url, '->', filePath);
          const data = await fs.promises.readFile(filePath);
          const extension = path.extname(filePath).toLowerCase();
          const mimeType =
            {
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.html': 'text/html',
              '.svg': 'image/svg+xml',
              '.json': 'application/json',
              '.woff': 'font/woff',
              '.woff2': 'font/woff2',
              '.ttf': 'font/ttf',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.ico': 'image/x-icon',
            }[extension] ?? 'application/octet-stream';

          return new Response(data, {
            headers: { 'content-type': mimeType },
          });
        } catch (err) {
          log.error('[protocol] handle failed for', request.url, err);
          return new Response('Not Found', { status: 404 });
        }
      });
    } else {
      // Legacy Electron 22 fallback
      protocol.registerBufferProtocol('app', bufferProtocolCallback);
    }

    // Use the registered protocol url to load the files.
    this.winURL = 'app://./index.html';
  }

  setMainWindowListeners() {
    if (this.mainWindow === null) {
      return;
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL) => {
        log.error('[main] did-fail-load:', {
          errorCode,
          errorDescription,
          validatedURL,
          winURL: this.winURL,
        });
        // Avoid infinite loop: only retry once
        if (validatedURL === this.winURL) {
          setTimeout(() => {
            this.mainWindow?.loadURL(this.winURL).catch((err) => {
              log.error('[main] retry loadURL failed:', err);
              emitMainProcessError(err);
            });
          }, 1000);
        }
      }
    );

    this.mainWindow.webContents.on('render-process-gone', (_event, details) => {
      log.error('[main] render-process-gone (window):', details);
    });
  }
}

/**
 * Callback used to register the custom app protocol,
 * during prod, files are read and served by using this
 * protocol. (Legacy Electron <25)
 */
function bufferProtocolCallback(
  request: ProtocolRequest,
  callback: (response: ProtocolResponse) => void
) {
  try {
    const url = new URL(request.url);
    let filePath: string;
    if (url.host && url.host !== '.' && !url.pathname.includes('.')) {
      filePath = path.join(
        __dirname,
        'src',
        decodeURI(url.host),
        decodeURI(url.pathname)
      );
    } else {
      const pathname =
        url.pathname === '/' && url.host !== '.'
          ? `/${url.host}`
          : url.pathname;
      const hostPart = url.host === '.' ? '' : url.host;
      filePath = path.join(
        __dirname,
        'src',
        decodeURI(hostPart),
        decodeURI(pathname)
      );
      if (filePath.endsWith(path.join('src', '.'))) {
        filePath = path.join(__dirname, 'src', 'index.html');
      }
    }
    if (filePath.endsWith(path.sep) || filePath.endsWith('/')) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (_, data) => {
      const extension = path.extname(filePath).toLowerCase();
      const mimeType =
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.html': 'text/html',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
        }[extension] ?? '';

      callback({ mimeType, data });
    });
  } catch (err) {
    callback({ mimeType: 'text/plain', data: Buffer.from('Not Found') });
  }
}

export default new Main();
