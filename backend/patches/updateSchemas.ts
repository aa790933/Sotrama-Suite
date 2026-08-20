import { Version } from 'utils/version';
import { DatabaseManager } from '../database/manager';
import { getRandomString } from '../../utils/index';

async function execute(dm: DatabaseManager) {
  const db = dm.db;
  if (!db || !db.pool) {
    return;
  }

  const version = (
    (await db.query(
      `SELECT value FROM \`singlevalue\` WHERE fieldname = ? AND parent = ?`
    )) as { value: string }[]
  )?.[0]?.value;

  /**
   * Versions after this should have the new schemas
   */
  if (version && Version.gt(version, '0.4.3-beta.0')) {
    return;
  }

  /**
   * For MariaDB, this migration patch is no longer needed since
   * migrate() handles schema creation automatically.
   * Just mark the version to prevent re-execution.
   */
  await db.query(
    `INSERT INTO \`singlevalue\` (name, parent, fieldname, value, created, modified, createdBy, modifiedBy)
     VALUES (?, 'SystemSettings', 'version', ?, NOW(), NOW(), '__SYSTEM__', '__SYSTEM__')
     ON DUPLICATE KEY UPDATE value = ?`,
    [getRandomString(), '0.5.0-beta.0', '0.5.0-beta.0']
  );
}

export default { execute, beforeMigrate: true };
