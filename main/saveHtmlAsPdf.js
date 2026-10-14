import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePrintDocumentInput } from './printDocumentPolicy.mjs';

/**
 * Render HTML through Electron's isolated print renderer and save its PDF.
 * Width and height are centimeters, matching the renderer IPC contract.
 * @param {string} html
 * @param {string} savePath
 * @param {import('electron').App} app
 * @param {number} width
 * @param {number} height
 */
export async function saveHtmlAsPdf(html, savePath, app, width, height) {
  validatePrintDocumentInput(html, width, height);
  if (typeof savePath !== 'string' || savePath.length === 0 || savePath.length > 32768) {
    throw new Error('PDF destination path is invalid');
  }

  const tempDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'sotrama-print-'));
  const htmlPath = path.join(tempDir, 'document.html');
  let printWindow;
  try {
    await fs.writeFile(htmlPath, html, { encoding: 'utf8', flag: 'wx' });
    printWindow = await getInitializedPrintWindow(htmlPath, width, height);
    const data = await printWindow.webContents.printToPDF({
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: {
        height: height / 2.54,
        width: width / 2.54,
      },
      printBackground: true,
    });
    await fs.writeFile(path.resolve(savePath), data);
    return true;
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/** @param {string} printFilePath @param {number} width @param {number} height */
export async function getInitializedPrintWindow(printFilePath, width, height) {
  const printWindow = new BrowserWindow({
    width: Math.floor(width * 28.333333),
    height: Math.floor(height * 28.333333),
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await printWindow.loadFile(printFilePath);
    return printWindow;
  } catch (error) {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    throw error;
  }
}
