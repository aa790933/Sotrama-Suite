import path from 'path';

/**
 * Maps an app:// URL onto a file under dist_electron/build/src.
 *
 * Vite emits asset references like `app://assets/index-HASH.js` (no leading
 * slash), while the entry point is loaded as `app://./index.html`. SPA routes
 * like `app://./settings` or `app:///list/Account` have no file extension
 * and must fallback to `src/index.html` so Vue Router can handle them.
 * The fallback preserves asset resolution and blocks path traversal.
 */
export function resolveAppFilePath(requestUrl: string): string {
  const baseDir = path.join(__dirname, 'src');
  const url = new URL(requestUrl);

  let hostPart = '';
  const pathnamePart = url.pathname;

  if (url.host && url.host !== '.' && url.host !== '') {
    hostPart = url.host;
  } else if (url.host === '.' || url.host === '') {
    hostPart = '';
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

  const cleanPath = decodedPath.replace(/^\/+/, '');
  const relative = path.join(decodedHost, cleanPath);
  const filePath = path.join(baseDir, relative);

  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(baseDir + path.sep) && normalized !== baseDir) {
    return path.join(baseDir, 'index.html');
  }

  if (normalized.endsWith(path.sep) || normalized.endsWith('/')) {
    return path.join(normalized, 'index.html');
  }

  const ext = path.extname(normalized);
  if (!ext) {
    return path.join(baseDir, 'index.html');
  }

  return normalized;
}
