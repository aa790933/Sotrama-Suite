import { setupDummyInstance } from 'dummy';
import { unlink } from 'fs/promises';
import { Fyo } from 'fyo';
import { DummyAuthDemux } from 'fyo/tests/helpers';
import { getTestDbPath, MariaDBTestDemux } from 'tests/helpers';

async function run() {
  const fyo = new Fyo({
    DatabaseDemux: MariaDBTestDemux,
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
  const dbPath = getTestDbPath();

  await setupDummyInstance(dbPath, fyo, 1, 100);
  await fyo.close();
  await unlink(dbPath);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
