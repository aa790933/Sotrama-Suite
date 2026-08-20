import fs from 'fs';
import path from 'path';

/**
 * Common ESBuild config used for building main process source
 * code for both dev and production.
 *
 * @param {string} root
 * @returns {import('esbuild').BuildOptions}
 */
export function getMainProcessCommonConfig(root) {
  return {
    entryPoints: [
      path.join(root, 'main.ts'),
      path.join(root, 'main', 'preload.ts'),
    ],
    bundle: true,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    // Align with Node LTS 22 host & Electron 33 (Node 20) / Electron 36 (Node 22).
    // For Electron 33 LTS use node20, for Electron 36 latest use node22. Keep node20 for max compat;
    // override to node22 when upgrading to Electron 36.
    target: 'node20',
    external: ['electron', 'electron-store', 'electron-log', 'electron-updater', 'node-fetch', 'mariadb'],
    plugins: [excludeVendorFromSourceMap],
    write: true,
  };
}

/**
 * ESBuild plugin used to prevent source maps from being generated for
 * packages inside node_modules, only first-party code source maps
 * are to be included.
 *
 * Note, this is used only for the main process source code.
 *
 * source: https://github.com/evanw/esbuild/issues/1685#issuecomment-944916409
 * @type {import('esbuild').Plugin}
 */
export const excludeVendorFromSourceMap = {
  name: 'excludeVendorFromSourceMap',
  setup(build) {
    build.onLoad({ filter: /node_modules/ }, (args) => {
      if (args.path.endsWith('.json')) {
        return;
      }

      return {
        contents:
          fs.readFileSync(args.path, 'utf8') +
          '\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJtYXBwaW5ncyI6IkEifQ==',
        loader: 'default',
      };
    });
  },
};
