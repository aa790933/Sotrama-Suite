import { app } from 'electron';
import { CUSTOM_EVENTS, IPC_CHANNELS } from 'utils/messages';
import type { Main } from './bootstrap';

function reportToRenderer(main: Main, ...args: unknown[]): void {
  const window = main.mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.LOG_MAIN_PROCESS_ERROR, ...args);
}

export default function registerProcessListeners(main: Main): void {
  if (main.isDevelopment) {
    if (process.platform === 'win32') {
      process.on('message', (data) => {
        if (data === 'graceful-exit') app.quit();
      });
    } else {
      process.on('SIGTERM', () => app.quit());
    }
  }

  process.on(CUSTOM_EVENTS.MAIN_PROCESS_ERROR, (error, more) => {
    reportToRenderer(main, error, more);
  });

  process.on('unhandledRejection', (error) => {
    reportToRenderer(main, error);
  });

  process.on('uncaughtException', (error) => {
    reportToRenderer(main, error);
    setTimeout(() => process.exit(1), 10000);
  });
}
