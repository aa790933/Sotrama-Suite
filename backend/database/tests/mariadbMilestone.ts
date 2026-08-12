import DatabaseCore, { MariaDBConfig } from '../core';

const config: MariaDBConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '20012005',
  database: 'test',
};

async function main(): Promise<void> {
  const db = new DatabaseCore(undefined, config);

  try {
    console.log('=== Phase 1: Connect ===');
    await db.connect();
    console.log('Connected to MariaDB successfully.\n');

    console.log('=== Phase 2: Create table ===');
    await db.query(`
      CREATE TABLE IF NOT EXISTS test_milestone (
        id INT AUTO_INCREMENT PRIMARY KEY,
        value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Table test_milestone created.\n');

    console.log('=== Phase 3: Insert test row ===');
    await db.query(`INSERT INTO test_milestone (value) VALUES (?)`, ['hello-mariadb']);
    console.log('Insert completed.\n');

    console.log('=== Phase 4: Read rows back ===');
    const rows = await db.query(`SELECT id, value FROM test_milestone ORDER BY id`) as Array<{
      id: number;
      value: string;
    }>;
    const found = rows.find((r) => r.value === 'hello-mariadb');
    if (!found) {
      throw new Error('Verification failed: inserted value not found on read.');
    }
    console.log(`Verification passed: found matching row with id=${found.id}, value="${found.value}"\n`);

    console.log('=== Phase 5: Drop table ===');
    await db.query(`DROP TABLE IF EXISTS test_milestone`);
    console.log('');

    console.log('=== RESULT: ALL PHASES PASSED ===');
  } catch (err) {
    console.error('=== RESULT: FAILED ===');
    console.error(err);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main();
