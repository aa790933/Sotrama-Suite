import { Fyo } from 'fyo';
import NumberSeries from 'fyo/models/NumberSeries';
import { DEFAULT_SERIES_START } from 'fyo/utils/consts';
import { BaseError } from 'fyo/utils/errors';
import { Schema } from 'schemas/types';
import { getRandomString } from 'utils';
import { Doc } from './doc';

export function isNameAutoSet(schemaName: string, fyo: Fyo): boolean {
  const schema = fyo.schemaMap[schemaName]!;
  if (schema.naming === 'manual') {
    return false;
  }

  if (schema.naming === 'autoincrement') {
    return true;
  }

  if (schema.naming === 'random') {
    return true;
  }

  const numberSeries = fyo.getField(schema.name, 'numberSeries');
  if (numberSeries) {
    return true;
  }

  return false;
}

export async function setName(doc: Doc, fyo: Fyo) {
  if (doc.schema.naming === 'manual') {
    if (!doc.name || isTemporaryNameLike(doc.name, fyo, doc.schema)) {
      doc.name = await getCollisionFreeTemporaryName(
        doc.schemaName,
        fyo,
        doc.schema,
        doc.name ?? undefined
      );
    }

    return doc.name;
  }

  if (doc.schema.naming === 'autoincrement') {
    return (doc.name = await getNextId(doc.schemaName, fyo));
  }

  if (doc.numberSeries !== undefined) {
    return (doc.name = await getSeriesNext(
      doc.numberSeries as string,
      doc.schemaName,
      fyo
    ));
  }

  // name === schemaName for Single
  if (doc.schema.isSingle) {
    return (doc.name = doc.schemaName);
  }

  // Assign a random name by default
  if (!doc.name) {
    doc.name = getRandomString();
  }

  return doc.name;
}

export async function getNextId(schemaName: string, fyo: Fyo): Promise<string> {
  const next = await fyo.db.getNextAutoincrementId(schemaName);
  return String(next).padStart(9, '0');
}

/**
 * Locale-independent fallback for temporary names (`New <label> <digits>`).
 * Covers names minted under a different locale than the current one, where
 * `DocHandler.isTemporaryName` (translation-sensitive) no longer matches.
 */
const TEMPORARY_NAME_PATTERN = /^New .+ \d+$/;

export function isTemporaryNameLike(
  name: string,
  fyo: Fyo,
  schema: Schema
): boolean {
  try {
    if (fyo.doc.isTemporaryName(name, schema)) {
      return true;
    }
  } catch {
    // DocHandler unavailable (e.g. unit tests); fall through to pattern.
  }

  return TEMPORARY_NAME_PATTERN.test(name);
}

/**
 * Resolve a `manual`-naming doc's temporary name to the first free
 * `New <label> NN` slot in the database. Temporary counters in DocHandler
 * are process-memory only, so after a reload the counter restarts at `01`
 * while the previous draft still owns that primary key — the scan here is
 * what makes re-insertion collision-free across sessions.
 */
export async function getCollisionFreeTemporaryName(
  schemaName: string,
  fyo: Fyo,
  schema: Schema,
  afterName?: string
): Promise<string> {
  const label = schema.label ?? schema.name;
  let idx = parseTemporarySuffix(afterName);
  for (let attempts = 0; attempts < 10000; attempts++, idx++) {
    const candidate = fyo.t`New ${label} ${String(idx).padStart(2, '0')}`;
    if (!(await fyo.db.exists(schemaName, candidate as string))) {
      return candidate as string;
    }
  }

  return `${fyo.t`New ${label} ` as string}${getRandomString()}`;
}

function parseTemporarySuffix(name?: string): number {
  const match = name?.match(/ (\d+)$/);
  const parsed = match ? parseInt(match[1]!, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function getSeriesNext(
  prefix: string,
  schemaName: string,
  fyo: Fyo
) {
  let series: NumberSeries;

  try {
    series = (await fyo.doc.getDoc('NumberSeries', prefix)) as NumberSeries;
  } catch (e) {
    const { statusCode } = e as BaseError;
    if (!statusCode || statusCode !== 404) {
      throw e;
    }

    await createNumberSeries(prefix, schemaName, DEFAULT_SERIES_START, fyo);
    series = (await fyo.doc.getDoc('NumberSeries', prefix)) as NumberSeries;
  }

  return await series.next(schemaName);
}

export async function createNumberSeries(
  prefix: string,
  referenceType: string,
  start: number,
  fyo: Fyo
) {
  const exists = await fyo.db.exists('NumberSeries', prefix);
  if (exists) {
    return;
  }

  const series = fyo.doc.getNewDoc('NumberSeries', {
    name: prefix,
    start,
    referenceType,
  });

  await series.sync();
}
