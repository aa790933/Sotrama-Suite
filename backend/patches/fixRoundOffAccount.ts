import { ModelNameEnum } from '../../models/types';
import type DatabaseCore from '../database/core';

const FIELDNAME = 'roundOffAccount';

async function execute(db: DatabaseCore) {
  const accounts = await db.getSingleValues(FIELDNAME);
  if (!accounts.length) {
    await testAndSetRoundOffAccount(db);
  }

  await db.delete(ModelNameEnum.AccountingSettings, FIELDNAME);

  let isSet = false;
  for (const { parent, value } of accounts) {
    if (parent !== (ModelNameEnum.AccountingSettings as string)) {
      continue;
    }

    isSet = await setRoundOffAccountIfExists(value as string, db);
    if (isSet) {
      break;
    }
  }

  if (!isSet) {
    await testAndSetRoundOffAccount(db);
  }
}

async function testAndSetRoundOffAccount(db: DatabaseCore) {
  const isSet = await setRoundOffAccountIfExists('Round Off', db);
  if (!isSet) {
    await setRoundOffAccountIfExists('Rounded Off', db);
  }

  return;
}

async function setRoundOffAccountIfExists(
  roundOffAccount: string,
  db: DatabaseCore
) {
  const exists = await db.exists(ModelNameEnum.Account, roundOffAccount);
  if (!exists) {
    return false;
  }

  await db.insert(ModelNameEnum.AccountingSettings, {
    roundOffAccount,
  });
  return true;
}

export default { execute, beforeMigrate: true };
