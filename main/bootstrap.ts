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
import registerAppLifecycleListeners from './registerAppLifecycleListeners';
import registerAutoUpdaterListeners from './registerAutoUpdaterListeners';
import registerIpcMainMessageListeners from './registerIpcMainMessageListeners';
import registerProcessListeners from './registerProcessListeners';
import { createProdRouter } from './ipc/router';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sourceMapSupport = require('source-map-support') as {
  install: (options?: {
    handleUncaughtExceptions?: boolean;
    environment?: string;
  }) => void;
};
sourceMapSupport.install({
  handleUncaughtExceptions: false,
  environment: 'node',
});

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
  // console fallback is fine; crash handlers below do not depend on it
}

/**
 * Last-resort handlers for errors escaping every other guard.
 *
 * Packaged builds must never die silently: a modal dialog is shown even when
 * the renderer never came up. Dev builds surface the same errors via dialog +
 * stderr without interrupting watch-mode restarts.
 */
function setupCrashHandlers() {
  const showFatalDialog = (title: string, error: Error) => {
    try {
      dialog.showErrorBox(title, `${error.message}\n\n${error.stack ?? ''}`);
    } catch {
      // Dialog unavailable during very early shutdown; already logged
    }
  };

  process.on('uncaughtException', (error) => {
    log.error('[main] uncaughtException:', error);
    try {
      emitMainProcessError(error);
    } catch {}
    showFatalDialog('Unexpected Error', error);
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
    relaunchWithoutGpuOnCrash(details.reason);
  });
  app.on('child-process-gone', (_event, details) => {
    log.error('[main] child-process-gone:', details);
  });
}

/**
 * Some Windows GPU drivers repeatedly crash the renderer, leaving an
 * invisible or white window. Relaunching once with --disable-gpu breaks the
 * crash loop; the flag guard prevents relaunch recursion.
 */
let gpuRelaunchAttempted = false;
function relaunchWithoutGpuOnCrash(reason: string) {
  if (
    process.platform !== 'win32' ||
    process.argv.includes('--disable-gpu') ||
    (reason !== 'crashed' && reason !== 'oom') ||
    gpuRelaunchAttempted
  ) {
    return;
  }
  gpuRelaunchAttempted = true;
  log.warn('[main] relaunching with --disable-gpu after', reason);
  app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu'] });
  app.exit(0);
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

    autoUpdater.logger = log as unknown as typeof autoUpdater.logger;

    // https://github.com/electron-userland/electron-builder/issues/4987
    app.commandLine.appendSwitch('disable-http2');
    autoUpdater.requestHeaders = {
      'Cache-Control':
        'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    };

    this.registerListeners();
    if (this.isMac && this.isDevelopment && app.dock) {
      app.dock.setIcon(this.icon);
    }
  }

  get isDevelopment() {
    // app.isPackaged is canonical; NODE_ENV may be unset in packaged builds
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
    const candidates = [
      path.resolve('./build/icon.png'),
      path.join(__dirname, 'icons', '512x512.png'),
      path.join(__dirname, '..', 'icons', '512x512.png'),
      path.join(process.resourcesPath, 'app', 'icons', '512x512.png'),
      path.join(process.resourcesPath, 'icons', '512x512.png'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    return path.join(__dirname, 'icons', '512x512.png');
  }

  private getPreloadPath(): string {
    // esbuild emits build/main.js and build/main/preload.js; inside the asar
    // __dirname is the app root, so candidate #1 is the packaged location.
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

    // A missing preload leaves the renderer without window.ipc, which fails
    // later in ways that look unrelated. Fail here, loudly.
    const expected = candidates[0];
    const error = new Error(`Preload script not found at ${expected}`);
    log.error('[main]', error.message);
    emitMainProcessError(error);
    throw error;
  }

  registerListeners() {
    registerIpcMainMessageListeners(this);
    createProdRouter(this).register();
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
      show: false,
    };

    if (this.isDevelopment || this.isLinux) {
      Object.assign(options, { icon: this.icon });
    }

    return options;
  }

  async createWindow() {
    const options = this.getOptions();
    this.mainWindow = new BrowserWindow(options);

    let shown = false;
    const reveal = () => {
      if (!shown && this.mainWindow && !this.mainWindow.isDestroyed()) {
        shown = true;
        this.mainWindow.show();
      }
    };

    this.mainWindow.once('ready-to-show', reveal);
    this.mainWindow.webContents.on('did-finish-load', reveal);

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

    /**
     * ready-to-show can be skipped entirely when the renderer dies early
     * (GPU crashes, failed loads). Without this watchdog the window stays
     * hidden forever, which users report as "the app does not open".
     */
    setTimeout(reveal, 15_000);

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

    this.winURL = `http://${host}:${port}/`;
  }

  registerAppProtocol() {
    if (process.argv.includes('--disable-gpu')) {
      app.disableHardwareAcceleration();
    }

    // protocol.handle (Electron >= 25) with registerBufferProtocol fallback
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
          const filePath = resolveAppFilePath(request.url);
          const data = await fs.promises.readFile(filePath);

          return new Response(data, {
            headers: { 'content-type': mimeTypeFor(filePath) },
          });
        } catch (err) {
          log.error('[protocol] handle failed for', request.url, err);
          return new Response('Not Found', { status: 404 });
        }
      });
    } else {
      protocol.registerBufferProtocol('app', bufferProtocolCallback);
    }

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
 * Maps an app:// URL onto a file under dist_electron/build/src.
 *
 * Vite emits asset references like `app://assets/index-HASH.js` (no leading
 * slash), while the entry point is loaded as `app://./index.html`. Both shapes
 * must resolve to real files inside the asar, otherwise the packaged app
 * renders nothing.
 */
export function resolveAppFilePath(requestUrl: string): string {
  const url = new URL(requestUrl);
  let filePath: string;

  if (url.host && url.host !== '.' && !url.pathname.includes('.')) {
    // Host carries a directory segment without extension
    filePath = path.join(
      __dirname,
      'src',
      decodeURI(url.host),
      decodeURI(url.pathname)
    );
  } else {
    const pathname =
      url.pathname === '/' && url.host !== '.' ? `/${url.host}` : url.pathname;
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

  return filePath;
}

function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return (
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
    }[extension] ?? 'application/octet-stream'
  );
}

/**
 * Legacy (Electron < 25) protocol callback serving files over app://.
 */
function bufferProtocolCallback(
  request: ProtocolRequest,
  callback: (response: ProtocolResponse) => void
) {
  try {
    const filePath = resolveAppFilePath(request.url);
    fs.readFile(filePath, (_, data) => {
      callback({ mimeType: mimeTypeFor(filePath), data });
    });
  } catch {
    callback({ mimeType: 'text/plain', data: Buffer.from('Not Found') });
  }
}

export default new Main();
