import fs from 'fs-extra';
import https from 'https';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

/**
 * Stream a file from `url` to `destPath`, invoking `onProgress` with byte counts.
 * Uses Node's built-in https module (main process only).
 */
export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        reject(new Error(`Download failed (${res.statusCode}): ${url}`));
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
      file.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

export function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
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
