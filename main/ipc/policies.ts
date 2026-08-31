import path from 'path';

/**
 * Policies extracted from the shallow registerIpcMainActionListeners module.
 * Each policy concentrates one security/validation concern in one place
 * (locality), hidden behind a tiny interface (depth).
 */

export function sanitizeDatabaseName(name: string): string {
  if (typeof name !== 'string' || !name) throw new Error('Invalid database name');
  if (name.includes('`')) throw new Error('Invalid database name: must not contain backticks');
  if (!/^[a-zA-Z0-9_\-]+$/.test(name)) {
    throw new Error('Invalid database name: must match [a-zA-Z0-9_-]');
  }
  return name;
}

// PathPolicy — single place for SAVE_DATA / DELETE_FILE traversal guards.
// was duplicated in 2 handlers; now one module owns it.
export interface AppPaths {
  userData: string;
  temp: string;
  documents: string;
}

export class PathPolicy {
  constructor(private readonly appPaths: AppPaths) {}

  isAllowed(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    const roots = [this.appPaths.userData, this.appPaths.temp, this.appPaths.documents].filter(Boolean);
    return roots.some((root) => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
  }

  assertAllowed(targetPath: string): void {
    if (!this.isAllowed(targetPath)) {
      throw new Error('Path not allowed');
    }
  }
}

// SenderPolicy — seam for assertValidSender.
// Prod checks event.sender === window.webContents; test allows all.
export interface SenderPolicy {
  isValidSender(event: Electron.IpcMainInvokeEvent): boolean;
}

export class ElectronSenderPolicy implements SenderPolicy {
  constructor(private readonly getWindow: () => Electron.BrowserWindow | null) {}
  isValidSender(event: Electron.IpcMainInvokeEvent): boolean {
    const win = this.getWindow();
    if (!win) return false;
    return event.sender === win.webContents;
  }
}

export class AllowAllSenderPolicy implements SenderPolicy {
  isValidSender(_event: Electron.IpcMainInvokeEvent): boolean {
    return true;
  }
}

// Api endpoint guard — was inline in SEND_API_REQUEST handler.
export function assertAllowedApiEndpoint(endpoint: string): void {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    throw new Error('SEND_API_REQUEST: only https allowed');
  }
  const allowed = endpoint.includes('/api/method/books_integration.api.');
  if (!allowed) {
    throw new Error('SEND_API_REQUEST: endpoint not allowed');
  }
}
