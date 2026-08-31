import { Fyo } from 'fyo';

export async function connectToDatabase(
  fyo: Fyo,
  dbPath: string,
  countryCode?: string
): Promise<{ countryCode: string }> {
  // dbPath is the stable Connection identifier (stringified MariaDBConfig or id) —
  // see CONTEXT.md:15. The parameter name is retained for seam compatibility.
  // No SQLite error symbols — MariaDB errors are surfaced via handleErrorWithDialog
  // in the caller (see ADR 0001).
  return { countryCode: await fyo.db.connectToDatabase(dbPath, countryCode) };
}
