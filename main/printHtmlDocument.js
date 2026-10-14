import fs from 'node:fs/promises';
import path from 'node:path';
import { getInitializedPrintWindow } from './saveHtmlAsPdf.js';
import { validatePrintDocumentInput } from './printDocumentPolicy.mjs';

/** @param {string} html @param {import('electron').App} app @param {number} width @param {number} height */
export async function printHtmlDocument(html, app, width, height) {
  validatePrintDocumentInput(html, width, height);
  const tempDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'sotrama-print-'));
  const tempFile = path.join(tempDir, 'document.html');
  let printWindow;
  try {
    await fs.writeFile(tempFile, html, { encoding: 'utf8', flag: 'wx' });
    printWindow = await getInitializedPrintWindow(tempFile, width, height);
    return await new Promise((resolve) => {
      printWindow.webContents.print(
        { silent: false, printBackground: true },
        (success) => resolve(Boolean(success))
      );
    });
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
