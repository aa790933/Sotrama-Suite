import { config } from 'dotenv';
import { MariaDBConfig } from '../core';

config();

/**
 * Build a MariaDBConfig for database tests from environment variables.
 *
 * Credentials are never hardcoded in the test files themselves. Instead they
 * are read from the environment, falling back to safe local defaults only when
 * an env var is absent.
 *
 * Recognised env vars:
 *   TEST_DB_HOST      (default: 'localhost')
 *   TEST_DB_PORT      (default: 3306)
 *   TEST_DB_USER      (default: 'sotra')
 *   TEST_DB_PASSWORD  (default: 'password')
 *
 * `database` is supplied by each caller (e.g. 'test_books_core', 'test') so it
 * can still be overridden per script.
 */
export function getTestDbConfig(database: string): MariaDBConfig {
  const port = Number(process.env.TEST_DB_PORT ?? 3306);
  return {
    host: process.env.TEST_DB_HOST ?? 'localhost',
    port: Number.isNaN(port) ? 3306 : port,
    user: process.env.TEST_DB_USER ?? 'sotra',
    password: process.env.TEST_DB_PASSWORD ?? 'password',
    database,
  };
}
