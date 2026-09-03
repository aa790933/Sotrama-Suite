import { emitMainProcessError, getDefaultMetaFieldValueMap } from '../helpers';
import type DatabaseCore from './core';
import { FieldValueMap, Patch } from './types';

export async function runPatches(
  patches: Patch[],
  db: DatabaseCore,
  version: string
) {
  const list: { name: string; success: boolean }[] = [];
  for (const patch of patches) {
    const success = await runPatch(patch, db, version);
    list.push({ name: patch.name, success });
  }
  return list;
}

async function runPatch(
  patch: Patch,
  db: DatabaseCore,
  version: string
): Promise<boolean> {
  let failed = false;
  try {
    await patch.patch.execute(db);
  } catch (error) {
    failed = true;
    if (error instanceof Error) {
      error.message = `Patch Failed: ${patch.name}\n${error.message}`;
      emitMainProcessError(error, { patchName: patch.name, notifyUser: false });
    }
  }

  await makeEntry(patch.name, version, failed, db);
  return true;
}

async function makeEntry(
  patchName: string,
  version: string,
  failed: boolean,
  db: DatabaseCore
) {
  const defaultFieldValueMap = getDefaultMetaFieldValueMap() as FieldValueMap;

  defaultFieldValueMap.name = patchName;
  defaultFieldValueMap.failed = failed;
  defaultFieldValueMap.version = version;

  try {
    await db.insert('PatchRun', defaultFieldValueMap);
  } catch {
    /**
     * Error is thrown if PatchRun table hasn't been migrated.
     * In this case, PatchRun will migrated post pre-migration-patches
     * are run and rerun the patch.
     */
    return;
  }
}
