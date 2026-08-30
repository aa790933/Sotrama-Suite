import Bree from 'bree';
import { app } from 'electron';
import path from 'path';
import type { Main } from 'main';

let bree: Bree;

export async function initScheduler(main: Main, interval: string) {
  const isPackaged = app.isPackaged;
  const jobsRoot = isPackaged
    ? path.join(process.resourcesPath, 'jobs')
    : path.join(__dirname, '..', '..', 'jobs');

  if (bree) {
    await bree.stop();
  }

  bree = new Bree({
    root: jobsRoot,
    defaultExtension: isPackaged ? 'js' : 'ts',
    jobs: [
      {
        name: 'triggerErpNextSync',
        interval: interval,
        worker: isPackaged
          ? {}
          : {
              workerData: {
                useTsNode: true,
              },
            },
      },
      {
        name: 'checkLoyaltyProgramExpiry',
        interval: '24 hours',
        worker: isPackaged
          ? {}
          : {
              workerData: {
                useTsNode: true,
              },
            },
      },
    ],
    worker: isPackaged ? {} : { argv: ['--require', 'ts-node/register'] },
  });

  bree.on('worker created', () => {
    main.mainWindow?.webContents.send('trigger-erpnext-sync');
  });

  await bree.start();
}
