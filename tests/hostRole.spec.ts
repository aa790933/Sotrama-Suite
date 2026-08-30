import test from 'tape';
import { canInstallMariaDB, normalizeHostRole } from '../src/utils/hostRole';

test('normalizeHostRole accepts exact persisted roles', (t) => {
  t.equal(normalizeHostRole('host'), 'host');
  t.equal(normalizeHostRole('client'), 'client');
  t.end();
});

test('normalizeHostRole returns null for missing/legacy/corrupt values', (t) => {
  // Backward compatibility: pre-role installations store nothing at all.
  t.equal(normalizeHostRole(null), null);
  t.equal(normalizeHostRole(undefined), null);
  t.equal(normalizeHostRole(''), null);
  t.equal(normalizeHostRole(0), null);
  t.equal(normalizeHostRole(1), null);
  t.equal(normalizeHostRole({}), null);
  t.equal(normalizeHostRole(['host']), null);
  t.end();
});

test('normalizeHostRole is strict about spelling and case', (t) => {
  t.equal(normalizeHostRole('HOST'), null);
  t.equal(normalizeHostRole('Client'), null);
  t.equal(normalizeHostRole('server'), null);
  t.equal(normalizeHostRole('host '), null);
  t.end();
});

test('canInstallMariaDB: only the host role may install MariaDB locally', (t) => {
  t.equal(canInstallMariaDB('host'), true);
  t.equal(canInstallMariaDB('client'), false);
  t.end();
});

test('canInstallMariaDB: undecided/legacy installs never enter install path', (t) => {
  // Guarantees a stored client role (or absent role) can never silently
  // provision or re-provision a local MariaDB server.
  t.equal(canInstallMariaDB(normalizeHostRole(undefined)), false);
  t.equal(canInstallMariaDB(normalizeHostRole(null)), false);
  t.equal(canInstallMariaDB(normalizeHostRole('client')), false);
  t.equal(canInstallMariaDB(normalizeHostRole('host')), true);
  t.end();
});
