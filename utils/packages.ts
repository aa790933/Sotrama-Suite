import fs from 'fs-extra';
import * as http from 'http';
import https from 'https';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Stream a file from `url` to `destPath`, invoking `onProgress` with byte counts.
 * Uses Node's built-in https/http modules (main process only) and follows
 * HTTP redirects (301, 302, 303, 307, 308) up to 5 hops.
 * Handles both relative and absolute Location headers, enforces a 30s
 * timeout, and cleans up partial files if the chain ultimately fails.
 */
export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  redirects = 5
): Promise<void> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, (res: http.IncomingMessage) => {
      let stalled: NodeJS.Timeout | null = setTimeout(() => {
        req.destroy(new Error('Download timeout'));
        // @ts-ignore destroy with error
        try { res.destroy(new Error('Download stalled')); } catch {}
      }, DOWNLOAD_TIMEOUT_MS);
      const clearStalled = () => {
        if (stalled) clearTimeout(stalled);
        stalled = null;
      };
      const resetStalled = () => {
        if (stalled) clearTimeout(stalled);
        stalled = setTimeout(() => {
          req.destroy(new Error('Download stalled'));
          try { res.destroy(new Error('Download stalled')); } catch {}
        }, DOWNLOAD_TIMEOUT_MS);
      };
      // Also enforce timeout on the request socket itself
      try { req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('Download timeout'))); } catch {}
      try { res.setTimeout(DOWNLOAD_TIMEOUT_MS, () => { try { res.destroy(new Error('Download stalled')); } catch {} }); } catch {}
      const status = res.statusCode ?? 0;
      const rawLocation = res.headers.location as
        | string
        | string[]
        | undefined;
      const location = Array.isArray(rawLocation)
        ? rawLocation[0]
        : rawLocation;

      if (
        REDIRECT_STATUS_CODES.has(status) &&
        typeof location === 'string' &&
        location.length > 0 &&
        redirects > 0
      ) {
        clearStalled();
        res.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, destPath, onProgress, redirects - 1)
          .then((v) => { clearStalled(); resolve(v); })
          .catch((err) => {
            void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
          });
        return;
      }
      if (status < 200 || status >= 300) {
        clearStalled();
        res.resume();
        const err = new Error(`Download failed (${status}): ${url}`);
        void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk: Buffer) => {
        resetStalled();
        downloaded += chunk.length;
        if (total && onProgress) {
          onProgress({
            downloaded,
            total,
            percent: (downloaded / total) * 100,
          });
        }
      });
      res.pipe(file);
      file.on('finish', () => { clearStalled(); file.close(() => resolve()); });
      file.on('error', (err) => {
        clearStalled();
        void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
      });
      res.on('error', (err) => {
        clearStalled();
        void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
      });
    });
    req.on('error', (err) => {
      void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
    });
  });
}

export function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function cacheDir(): string {
  return path.join(tmpdir(), 'sotrama-suite', 'mariadb');
}

export function ensureCacheDir(): string {
  const dir = cacheDir();
  fs.ensureDirSync(dir);
  return dir;
}
