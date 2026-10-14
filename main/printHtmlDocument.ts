import fs from 'node:fs/promises';
import path from 'node:path';
import type { App } from 'electron';
import { getInitializedPrintWindow } from './saveHtmlAsPdf';
import { validatePrintDocumentInput } from './printDocumentPolicy';

export async function printHtmlDocument(
  html: string,
  app: App,
  width: number,
  height: number
): Promise<boolean> {
  validatePrintDocumentInput(html, width, height);
  const tempDir = await fs.mkdtemp(path.join(app.getPath('temp'), 'sotrama-print-'));
  const tempFile = path.join(tempDir, 'document.html');
  let printWindow: Awaited<ReturnType<typeof getInitializedPrintWindow>> | undefined;
  try {
    await fs.writeFile(tempFile, html, { encoding: 'utf8', flag: 'wx' });
    const window = await getInitializedPrintWindow(tempFile, width, height);
    printWindow = window;
    return await new Promise((resolve) => {
      window.webContents.print(
        { silent: false, printBackground: true },
        (success) => resolve(Boolean(success))
      );
    });
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
