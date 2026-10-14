import { app } from 'electron';
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer';
import { Main } from '../main';
import { rendererLog } from './helpers';
import { emitMainProcessError } from 'backend/helpers';
import { closeRustApiClient } from './rustApiClient';

export default function registerAppLifecycleListeners(main: Main) {
  let apiClientShutdownStarted = false;
  let apiClientShutdownComplete = false;
  app.on('before-quit', (event) => {
    if (apiClientShutdownComplete) return;
    event.preventDefault();
    if (apiClientShutdownStarted) return;
    apiClientShutdownStarted = true;
    void closeRustApiClient()
      .catch(() => undefined)
      .finally(() => {
        apiClientShutdownComplete = true;
        app.quit();
      });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (main.mainWindow === null) {
      main.createWindow().catch((err) => emitMainProcessError(err));
    }
  });

  app.on('ready', () => {
    if (main.isDevelopment && !main.isTest) {
      installDevTools(main).catch((err) => emitMainProcessError(err));
    }

    main.createWindow().catch((err) => emitMainProcessError(err));
  });
}

async function installDevTools(main: Main) {
  try {
    await installExtension(VUEJS3_DEVTOOLS);
  } catch (e) {
    rendererLog(main, 'Vue Devtools failed to install', e);
  }
}
