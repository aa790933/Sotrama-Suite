import { ipcMain, Menu, shell } from 'electron';
import { emitMainProcessError } from 'backend/helpers';
import { IPC_MESSAGES } from '../utils/messages';
import { normalizeExternalUrl } from './externalUrlPolicy.mjs';

function isCurrentWindowSender(main, event) {
  return Boolean(main.mainWindow && event.sender === main.mainWindow.webContents);
}

export default function registerIpcMainMessageListeners(main) {
  ipcMain.on(IPC_MESSAGES.OPEN_MENU, (event) => {
    if (!isCurrentWindowSender(main, event)) return;
    const menu = Menu.getApplicationMenu();
    if (!menu || !main.mainWindow) return;
    menu.popup({ window: main.mainWindow });
  });

  ipcMain.on(IPC_MESSAGES.RELOAD_MAIN_WINDOW, (event) => {
    if (isCurrentWindowSender(main, event)) main.mainWindow?.reload();
  });

  ipcMain.on(IPC_MESSAGES.MINIMIZE_MAIN_WINDOW, (event) => {
    if (isCurrentWindowSender(main, event)) main.mainWindow?.minimize();
  });

  ipcMain.on(IPC_MESSAGES.MAXIMIZE_MAIN_WINDOW, (event) => {
    if (!isCurrentWindowSender(main, event) || !main.mainWindow) return;
    if (main.mainWindow.isMaximized()) main.mainWindow.unmaximize();
    else main.mainWindow.maximize();
  });

  ipcMain.on(IPC_MESSAGES.ISMAXIMIZED_MAIN_WINDOW, (event) => {
    if (!isCurrentWindowSender(main, event)) return;
    event.sender.send(IPC_MESSAGES.ISMAXIMIZED_RESULT, main.mainWindow?.isMaximized() ?? false);
  });

  ipcMain.on(IPC_MESSAGES.ISFULLSCREEN_MAIN_WINDOW, (event) => {
    if (!isCurrentWindowSender(main, event)) return;
    event.sender.send(IPC_MESSAGES.ISFULLSCREEN_RESULT, main.mainWindow?.isFullScreen() ?? false);
  });

  ipcMain.on(IPC_MESSAGES.CLOSE_MAIN_WINDOW, (event) => {
    if (isCurrentWindowSender(main, event)) main.mainWindow?.close();
  });

  ipcMain.on(IPC_MESSAGES.OPEN_EXTERNAL, (event, input) => {
    if (!isCurrentWindowSender(main, event)) return;
    const url = normalizeExternalUrl(input);
    if (!url) {
      // Do not echo attacker-controlled URLs: they may contain secrets.
      emitMainProcessError(new Error('OPEN_EXTERNAL blocked: invalid or unsupported URL'));
      return;
    }
    void shell.openExternal(url).catch(() => {
      emitMainProcessError(new Error('OPEN_EXTERNAL failed to open the requested URL'));
    });
  });

  ipcMain.on(IPC_MESSAGES.SHOW_ITEM_IN_FOLDER, (event, filePath) => {
    if (!isCurrentWindowSender(main, event)) return;
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 32768) return;
    shell.showItemInFolder(filePath);
  });
}
