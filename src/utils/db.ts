import { Fyo } from 'fyo';

export async function connectToDatabase(
  fyo: Fyo,
  dbPath: string,
  countryCode?: string
): Promise<{ countryCode: string }> {
  // dbPath is the stable Connection identifier (stringified MariaDBConfig or id) —
  // see CONTEXT.md (Connection). The parameter name is retained for seam compatibility.
  // MariaDB errors surface via handleErrorWithDialog in the caller (see ADR 0001).
  return { countryCode: await fyo.db.connectToDatabase(dbPath, countryCode) };
}
