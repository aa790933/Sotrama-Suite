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

/**
 * Stream a file from `url` to `destPath`, invoking `onProgress` with byte counts.
 * Uses Node's built-in https/http modules (main process only) and follows
 * HTTP redirects (301, 302, 303, 307, 308) up to 5 hops.
 * Handles both relative and absolute Location headers and cleans up partial
 * files if the chain ultimately fails.
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
        res.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, destPath, onProgress, redirects - 1)
          .then(resolve)
          .catch((err) => {
            void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
          });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        const err = new Error(`Download failed (${status}): ${url}`);
        void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk: Buffer) => {
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
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        void fs.remove(destPath).catch(() => undefined).finally(() => reject(err));
      });
      res.on('error', (err) => {
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
