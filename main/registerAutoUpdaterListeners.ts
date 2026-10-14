import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { emitMainProcessError } from '../backend/helpers';
import { isExpectedUpdateError } from './helpers';
import type { Main } from './bootstrap';

export default function registerAutoUpdaterListeners(main: Main): void {
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    if (!main.checkedForUpdate) main.checkedForUpdate = true;
    if (!isExpectedUpdateError(error)) emitMainProcessError(error);
  });

  autoUpdater.on('update-available', (info) => {
    void (async () => {
      const currentVersion = app.getVersion();
      const nextVersion = info.version;
      const isCurrentBeta = currentVersion.includes('beta');
      const isNextBeta = nextVersion.includes('beta');

      if (!isCurrentBeta && isNextBeta) {
        const option = await dialog.showMessageBox({
          type: 'info',
          title: 'Update Available',
          message: `Download version ${nextVersion}?`,
          buttons: ['Yes', 'No'],
        });
        if (option.response !== 0) return;
      }

      await autoUpdater.downloadUpdate();
    })().catch(() => {
      emitMainProcessError(new Error('Failed to download the application update'));
    });
  });

  autoUpdater.on('update-downloaded', () => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Update Downloaded',
      message: 'Restart Sotrama Suite to install update?',
      buttons: ['Yes', 'No'],
    }).then((option) => {
      if (option.response !== 1) autoUpdater.quitAndInstall();
    }).catch(() => {
      emitMainProcessError(new Error('Could not show the update restart prompt'));
    });
  });
}
