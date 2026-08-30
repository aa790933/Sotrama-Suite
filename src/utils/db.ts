import { Fyo } from 'fyo';

type Conn = {
  countryCode: string;
  error?: Error;
  actionSymbol?: (typeof dbErrorActionSymbols)[keyof typeof dbErrorActionSymbols];
};

// Kept for import compatibility with src/App.vue:App.vue:59.
// No SQLite-specific symbols are produced after ADR 0001; the module is now shallow and
// will be deleted outright when App.vue's file-selected flow is updated to rely on
// ipc.checkDbAccess + handleErrorWithDialog alone.
export const dbErrorActionSymbols = {
  SelectFile: Symbol('select-file'),
  CancelSelection: Symbol('cancel-selection'),
} as const;

export async function connectToDatabase(
  fyo: Fyo,
  dbPath: string,
  countryCode?: string
): Promise<Conn> {
  // dbPath is the stable Connection identifier (stringified MariaDBConfig or id) —
  // see CONTEXT.md:15. The parameter name is retained for seam compatibility.
  return { countryCode: await fyo.db.connectToDatabase(dbPath, countryCode) };
}
