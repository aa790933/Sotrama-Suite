import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRustUtilityJson, runRustUtility } from './rustUtility.mjs';

const LANGUAGE_CODE = /^[A-Za-z0-9_-]{1,32}$/;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Translation parsing and map semantics live in Rust; this is only host IPC glue. */
export async function getLanguageMap(code) {
  if (typeof code !== 'string' || !LANGUAGE_CODE.test(code)) {
    throw new Error('Invalid language code');
  }

  const translationsDir = resolveTranslationsDirectory();
  const output = await runRustUtility([
    '--language-map', code,
    '--translations-dir', translationsDir,
  ]);
  const languageMap = parseRustUtilityJson(output, 'language map');
  if (!languageMap || typeof languageMap !== 'object' || Array.isArray(languageMap)) {
    throw new Error('Rust translation utility returned an invalid language map');
  }
  return languageMap;
}

function resolveTranslationsDirectory() {
  const candidates = [
    process.resourcesPath ? path.resolve(process.resourcesPath, '../translations') : undefined,
    path.resolve(moduleDirectory, '../../translations'),
    path.resolve(process.cwd(), 'translations'),
  ];
  const directory = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!directory) throw new Error('Translation resources directory not found');
  return directory;
}
