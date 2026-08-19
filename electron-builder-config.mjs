// App is tagged with a .mjs extension to allow
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * electron-builder doesn't look for the APPLE_TEAM_ID environment variable for some reason.
 * This workaround allows an environment variable to be added to the electron-builder.yml config
 * collection. See: https://github.com/electron-userland/electron-builder/issues/7812
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
// const root = path.join(dirname, '..', '..');
const root = dirname; // redundant, but is meant to keep with the previous line
const buildDirPath = path.join(root, 'dist_electron', 'build');
const packageDirPath = path.join(root, 'dist_electron', 'bundled');

const sotramaSuiteConfig = {
  productName: 'Sotrama Suite',
  // If real user data exists under the old io.frappe.books path before a public/production release,
  // add a migration step here first — see git history for a prior draft migration approach.
  appId: 'io.sotrama.suite',
  artifactName: '${productName}-v${version}-${os}-${arch}.${ext}',
  asarUnpack: ['**/*.node', 'mariadb/**/*.msi'],
  extraFiles: [
    // Windows: bundle the pinned MariaDB MSI so the "Install for me" path
    // works offline. The MSI is expected under build/mariadb at build time
    // (download script); resolveMsiPath falls back to a runtime download.
    { from: 'build/mariadb', to: 'mariadb', filter: ['*.msi'] },
  ],
  extraResources: [
    { from: 'log_creds.txt', to: '../creds/log_creds.txt' },
    { from: 'translations', to: '../translations' },
    { from: 'templates', to: '../templates' },
  ],
  files: '**',
  extends: null,
  directories: {
    output: packageDirPath,
    app: buildDirPath,
  },
  mac: {
    type: 'distribution',
    artifactName: '${productName}-v${version}-mac-${arch}.${ext}',
    category: 'public.app-category.finance',
    icon: 'build/icon.icns',
    notarize: {
      teamId: process.env.APPLE_TEAM_ID || '',
    },
    hardenedRuntime: true,
    gatekeeperAssess: false,
    darkModeSupport: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    publish: ['github'],
  },
  win: {
    publisherName: 'Frappe Technologies Pvt. Ltd.',
    artifactName: '${productName}-v${version}-windows-${arch}.${ext}',
    signDlls: true,
    icon: 'build/icon.ico',
    publish: ['github'],
    target: [
      {
        target: 'nsis',
        arch: ['x64', 'ia32'],
      },
      {
        target: 'portable',
        arch: ['x64', 'ia32'],
      },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/installericon.ico',
    uninstallerIcon: 'build/uninstallericon.ico',
    publish: ['github'],
  },
  linux: {
    icon: 'build/icons',
    artifactName: '${productName}-v${version}-linux-${arch}.${ext}',
    category: 'Finance',
    publish: ['github'],
    target: [
      {
        target: 'deb',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'rpm',
        arch: ['x64', 'arm64'],
      },
    ],
  },
};

export default sotramaSuiteConfig;
