/**
 * Language files are packaged into the binary (bundled translations/*.csv).
 * Remote fetching is disabled — translations are used as-is from the bundle.
 *
 * This ensures the app works fully offline and does not depend on a
 * public GitHub repository for translation updates.
 */

import { constants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { parseCSV } from 'utils/csvParser';
import { LanguageMap } from 'utils/types';

export async function getLanguageMap(code: string): Promise<LanguageMap> {
  const contents = await getContents(code);
  return getMapFromCsv(contents);
}

function getMapFromCsv(csv: string): LanguageMap {
  const matrix = parseCSV(csv);
  const languageMap: LanguageMap = {};

  for (const row of matrix) {
    /**
     * Ignore lines that have no translations
     */
    if (!row[0] || !row[1]) {
      continue;
    }

    const source = row[0];
    const translation = row[1];
    const context = row[3];

    languageMap[source] = { translation };
    if (context?.length) {
      languageMap[source].context = context;
    }
  }

  return languageMap;
}

async function getContents(code: string) {
  const contents = await getContentsIfExists(code);
  if (!contents || contents.length === 0) {
    throwCouldNotFetchFile(code);
  }
  return contents;
}

async function getContentsIfExists(code: string): Promise<string> {
  const filePath = await getTranslationFilePath(code);
  if (!filePath) {
    return '';
  }

  return await fs.readFile(filePath, { encoding: 'utf-8' });
}

async function getTranslationFilePath(code: string) {
  let filePath = path.join(
    process.resourcesPath,
    `../translations/${code}.csv`
  );

  try {
    await fs.access(filePath, constants.R_OK);
  } catch {
    /**
     * This will be used in Development mode
     */
    filePath = path.join(__dirname, `../../translations/${code}.csv`);
  }

  try {
    await fs.access(filePath, constants.R_OK);
  } catch {
    return '';
  }

  return filePath;
}

function throwCouldNotFetchFile(code: string) {
  throw new Error(`Could not load translations for '${code}'.`);
}
