import { DatabaseManager } from '../database/manager';

async function execute(dm: DatabaseManager) {
  await dm.db?.query('ALTER TABLE Item MODIFY COLUMN hsnCode TEXT');
}

export default { execute, beforeMigrate: true };
