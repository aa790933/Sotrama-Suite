/**
 * Process entry point.
 *
 * Module-level failures (e.g. MODULE_NOT_FOUND in bundled externals) occur
 * before any application code runs, so error handlers must be installed here,
 * before the dependency graph is loaded. The application itself lives in
 * ./main/bootstrap and is loaded asynchronously for exactly that reason.
 */

type ErrorSink = (error: Error, phase: string) => void;

const reportFatal: ErrorSink = (error, phase) => {
  // stderr first: available even when Electron APIs are unusable
  // eslint-disable-next-line no-console
  console.error(`[main] ${phase}:`, error);

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dialog } = require('electron') as typeof import('electron');
    dialog.showErrorBox(
      'Sotrama Suite failed to start',
      `${error.message}\n\n${error.stack ?? ''}`
    );
  } catch {
    // Electron unavailable; the stderr output above is the record
  }
};

process.on('uncaughtException', (error) =>
  reportFatal(error, 'uncaughtException')
);
process.on('unhandledRejection', (reason) =>
  reportFatal(
    reason instanceof Error ? reason : new Error(String(reason)),
    'unhandledRejection'
  )
);

// Dynamic import keeps the application dependency graph out of the critical
// path above; see file header.
void import('./main/bootstrap');

export type { Main } from './main/bootstrap';
