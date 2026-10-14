const path = require('node:path');

/**
 * Maps an app:// URL onto a file under dist_electron/build/src.
 * Vite emits both app://assets/... and app://./index.html; extensionless SPA
 * routes fall back to index.html. Both separator styles are normalized before
 * containment checks so Windows traversal strings are rejected on every OS.
 *
 * This stays in the Electron host: it is called for every protocol request and
 * spawning Rust for path resolution would add latency without domain value.
 */
export function resolveAppFilePath(requestUrl: string): string {
  const baseDir = path.join(__dirname, 'src');
  const url = new URL(requestUrl);

  let hostPart = '';
  const pathnamePart = url.pathname;

  if (url.host && url.host !== '.' && url.host !== '') {
    hostPart = url.host;
  }

  if (url.host === '.' && url.pathname === '/') {
    return path.join(baseDir, 'index.html');
  }

  let decodedHost = '';
  let decodedPath = '';
  try {
    decodedHost = decodeURI(hostPart);
  } catch {
    decodedHost = hostPart;
  }
  try {
    decodedPath = decodeURI(pathnamePart);
  } catch {
    decodedPath = pathnamePart;
  }

  if (url.host === '.' && decodedPath === '/index.html') {
    return path.join(baseDir, 'index.html');
  }

  const portableHost = decodedHost.replace(/\\/g, '/');
  const portablePath = decodedPath.replace(/\\/g, '/');
  const cleanPath = portablePath.replace(/^\/+/, '');
  const filePath = path.join(baseDir, portableHost, cleanPath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(baseDir + path.sep) && normalized !== baseDir) {
    return path.join(baseDir, 'index.html');
  }

  if (normalized.endsWith(path.sep) || normalized.endsWith('/')) {
    return path.join(normalized, 'index.html');
  }

  if (!path.extname(normalized)) {
    return path.join(baseDir, 'index.html');
  }

  return normalized;
}
