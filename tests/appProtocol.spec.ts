import test from 'tape';
import path from 'path';
import { resolveAppFilePath } from '../main/resolveAppFilePath';

function expectEndsWith(actual: string, suffix: string, msg: string, t: any) {
  const normalized = actual.replace(/\\/g, '/');
  const expected = suffix.replace(/\\/g, '/');
  t.ok(normalized.endsWith(expected), `${msg}: ${actual} should end with ${expected}`);
}

test('resolveAppFilePath: SPA routes fallback to index.html', (t) => {
  const base = path.join('src', 'index.html').replace(/\\/g, '/');
  expectEndsWith(resolveAppFilePath('app://./settings'), base, '/settings', t);
  expectEndsWith(resolveAppFilePath('app://./list/Account'), base, '/list/Account', t);
  expectEndsWith(resolveAppFilePath('app://./report/ProfitAndLoss'), base, 'report route', t);
  expectEndsWith(resolveAppFilePath('app:///settings'), base, 'triple slash', t);
  expectEndsWith(resolveAppFilePath('app://./settings?tab=System'), base, 'with query', t);
  expectEndsWith(resolveAppFilePath('app://./customize-form'), base, 'customize-form', t);
  t.end();
});

test('resolveAppFilePath: entry point and assets', (t) => {
  expectEndsWith(resolveAppFilePath('app://./index.html'), path.join('src', 'index.html'), 'index.html', t);
  // Vite assets like app://assets/index-ABC123.js
  const asset = resolveAppFilePath('app://assets/index-abc123.js');
  t.ok(asset.replace(/\\/g, '/').endsWith('src/assets/index-abc123.js'), `asset: ${asset}`);
  const css = resolveAppFilePath('app://assets/style-xyz.css');
  t.ok(css.replace(/\\/g, '/').endsWith('src/assets/style-xyz.css'), `css: ${css}`);
  t.end();
});

test('resolveAppFilePath: path traversal blocked', (t) => {
  const base = path.join('src', 'index.html').replace(/\\/g, '/');
  // Attempt to traverse outside src via .. or encoded ..
  expectEndsWith(resolveAppFilePath('app://./../etc/passwd'), base, 'traversal should fallback', t);
  expectEndsWith(resolveAppFilePath('app://../etc/passwd'), base, 'host traversal', t);
  expectEndsWith(resolveAppFilePath('app://./%2e%2e/%2e%2e/etc/passwd'), base, 'encoded traversal', t);
  // Windows backslash encoded
  expectEndsWith(resolveAppFilePath('app://./..\\..\\windows\\system32'), base, 'backslash traversal', t);
  t.end();
});

test('resolveAppFilePath: invalid SPA still fallback', (t) => {
  const base = path.join('src', 'index.html').replace(/\\/g, '/');
  expectEndsWith(resolveAppFilePath('app://./nonexistent-route-xyz'), base, 'unknown route', t);
  expectEndsWith(resolveAppFilePath('app://./'), base, 'root slash', t);
  expectEndsWith(resolveAppFilePath('app:///'), base, 'triple slash root', t);
  t.end();
});

test('resolveAppFilePath: static assets with extension not fallback', (t) => {
  const js = resolveAppFilePath('app://./assets/app.js');
  t.ok(js.endsWith('app.js'), `js asset: ${js}`);
  t.notOk(js.endsWith('index.html'), 'js should not fallback');
  const png = resolveAppFilePath('app://./icon.png');
  t.ok(png.endsWith('icon.png'));
  t.end();
});
