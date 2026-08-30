import type { HostType } from '../setup/types';

/**
 * Coerce an untrusted persisted value into a HostType.
 * Returns null for anything that is not exactly 'host' or 'client'
 * (missing key, legacy installs, corrupted config).
 */
export function normalizeHostRole(value: unknown): HostType | null {
  return value === 'host' || value === 'client' ? value : null;
}

/**
 * Only a machine whose persisted role is 'host' may run the local
 * MariaDB installation path. Clients and undecided/legacy (null)
 * installations must never install or provision a local server.
 */
export function canInstallMariaDB(role: HostType | null): boolean {
  return role === 'host';
}
