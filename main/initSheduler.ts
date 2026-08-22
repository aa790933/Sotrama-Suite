import Bree from 'bree';
import { app } from 'electron';
import path from 'path';
import type { Main } from 'main';

let bree: Bree;

export async function initScheduler(main: Main, interval: string) {
  // Worker files live outside the bundler graph; in packaged builds they are
  // shipped via extraResources instead of the asar.
  const jobsRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'jobs')
    : path.join(__dirname, '..', '..', 'jobs');

  if (bree) {
    await bree.stop();
  }

  bree = new Bree({
    root: jobsRoot,
    defaultExtension: 'ts',
    jobs: [
      {
        name: 'triggerErpNextSync',
        interval: interval,
        worker: {
          workerData: {
            useTsNode: true,
          },
        },
      },
      {
        name: 'checkLoyaltyProgramExpiry',
        interval: '24 hours',
        worker: {
          workerData: {
            useTsNode: true,
          },
        },
      },
    ],
    worker: {
      argv: ['--require', 'ts-node/register'],
    },
  });

  bree.on('worker created', () => {
    main.mainWindow?.webContents.send('trigger-erpnext-sync');
  });

  await bree.start();
}
