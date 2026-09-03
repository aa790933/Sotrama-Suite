import type DatabaseCore from '../database/core';

async function execute(db: DatabaseCore) {
  await db.query('ALTER TABLE Item MODIFY COLUMN hsnCode TEXT');
}

export default { execute, beforeMigrate: true };
