import fs from 'fs';
import path from 'path';
import { _electron } from 'playwright';
import { fileURLToPath } from 'url';
import test from 'tape';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, '..');
const appSourcePath = path.join(root, 'dist_electron', 'build', 'main.js');

if (!fs.existsSync(appSourcePath)) {
  console.error(
    `uitest: ${appSourcePath} not found. Run: yarn build --nosign --nopackage`
  );
  process.exit(1);
}

(async function run() {
  const electronApp = await _electron.launch({
    args: [appSourcePath],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const window = await electronApp.firstWindow();
  window.setDefaultTimeout(60_000);

  test('load app', async (t) => {
    t.equal(await window.title(), 'Sotrama Suite', 'title matches');

    await new Promise((r) => window.once('load', () => r()));
    t.ok(true, 'window has loaded');
  });

  test('host setup: connect to existing MariaDB', async (t) => {
    /**
     * A fresh instance boots into the HostSetup screen (MariaDB bootstrap)
     * on role selection. The CI job runs a real MariaDB service mapped to
     * host port 3307, so pick the host role and drive the "advanced"
     * connect flow instead of the local MSI installer.
     */
    await window.getByTestId('role-host').click();
    const advancedRadio = window.getByTestId('advanced-mode-radio');
    await advancedRadio.waitFor({ state: 'visible', timeout: 60_000 });
    await advancedRadio.check();

    await window.getByTestId('host-input').fill('127.0.0.1');
    await window.getByTestId('port-input').fill('3307');
    await window.getByTestId('database-input').fill('sotrama_uitest');
    await window.getByTestId('user-input').fill('sotra');
    await window.getByTestId('password-input').fill('password');

    await window.getByTestId('test-connection-button').click();
    await window.getByTestId('continue-button').click({ timeout: 60_000 });

    t.ok(true, 'host configured, company setup shown');
  });

  test('fill setup form', async (t) => {
    await window.getByTestId('submit-button').waitFor();

    t.equal(
      await window.getByTestId('submit-button').isDisabled(),
      true,
      'submit button is disabled before form fill'
    );

    await window.getByPlaceholder('Company Name').fill('Test Company');
    await window.getByPlaceholder('John Doe').fill('Test Owner');
    await window.getByPlaceholder('john@doe.com').fill('test@example.com');
    await window.getByPlaceholder('Select Country').fill('India');
    await window.getByPlaceholder('Select Country').blur();
    await window.getByPlaceholder('Prime Bank').fill('Test Bank');
    await window.getByPlaceholder('Prime Bank').blur();

    t.equal(
      await window.getByTestId('submit-button').isDisabled(),
      false,
      'submit button enabled after form fill'
    );
  });

  test('create new instance', async (t) => {
    await window.getByTestId('submit-button').click();
    await window.getByTestId('company-name').waitFor({ timeout: 60_000 });
    t.equal(
      await window.getByTestId('company-name').innerText(),
      'Test Company',
      'new instance created, company name found in sidebar'
    );
  });

  test('close app', async (t) => {
    await electronApp.close();
    t.ok(true, 'app closed without errors');
  });
})();
