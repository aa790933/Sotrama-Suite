// App is tagged with a .mjs extension to allow ESM import
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * electron-builder doesn't look for the APPLE_TEAM_ID environment variable for some reason.
 * This workaround allows an environment variable to be added to the electron-builder.yml config
 * collection. See: https://github.com/electron-userland/electron-builder/issues/7812
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = dirname;
const buildDirPath = path.join(root, 'dist_electron', 'build');
const packageDirPath = path.join(root, 'dist_electron', 'bundled');

/**
 * Optional payloads must not abort packaging: CI builds without release
 * credentials or the MariaDB MSI are still expected to produce installers.
 */
const optionalCopy = (from, to, filter) =>
  fs.existsSync(path.join(root, from))
    ? [{ from: path.join(root, from), to, ...(filter ? { filter } : {}) }]
    : [];

const sotramaSuiteConfig = {
  productName: 'Sotrama Suite',
  appId: 'io.sotrama.suite',
  artifactName: '${productName}-v${version}-${os}-${arch}.${ext}',
  asar: true,
  asarUnpack: ['**/*.node', 'mariadb/**/*.msi'],
  // Only include built files – buildDirPath already contains the bundled main + renderer
  files: ['**/*', '!**/*.ts', '!**/*.map', '!**/*.md'],
  npmRebuild: false,
  buildDependenciesFromSource: false,
  extraFiles: optionalCopy(path.join('build', 'mariadb'), 'mariadb', ['*.msi']),
  extraResources: [
    ...optionalCopy('log_creds.txt', '../creds/log_creds.txt'),
    { from: path.join(root, 'translations'), to: '../translations' },
    { from: path.join(root, 'templates'), to: '../templates' },
    { from: path.join(root, 'jobs'), to: 'jobs' },
  ],
  extends: null,
  directories: {
    output: packageDirPath,
    app: buildDirPath,
    buildResources: 'build',
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
