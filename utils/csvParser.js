/** @param {string} text @returns {string[][]} */
function parseCSV(text) {
  //  Works on RFC 4180 csv
  let rows = splitCsvBlock(text);
  if (rows.length === 1) {
    rows = splitCsvBlock(text, '\n');
  }
  return rows.map(splitCsvLine);
}

/** @param {unknown[][]} matrix @returns {string} */
function generateCSV(matrix) {
  // Generates RFC 4180 csv
  const formattedRows = getFormattedRows(matrix);
  return formattedRows.join('\r\n');
}

/** @param {string} text @param {string} [splitter] @returns {string[]} */
function splitCsvBlock(text, splitter = '\r\n') {
  if (!text.endsWith(splitter)) {
    text += splitter;
  }
  const lines = [];
  let line = '';
  let inDq = false;

  for (let i = 0; i <= text.length; i++) {
    const c = text[i];

    if (
      c === '"' &&
      ((text[i + 1] === '"' && text[i + 2] === '"') || text[i + 1] !== '"')
    ) {
      inDq = !inDq;
    }

    const isEnd = [...splitter]
      .slice(1)
      .map((s, j) => text[i + j + 1] === s)
      .every(Boolean);

    if (!inDq && c === splitter[0] && isEnd) {
      lines.push(line);
      line = '';
      i = i + splitter.length - 1;
      continue;
    }

    line += c;
  }

  return lines;
}

/** @param {string} line @returns {string[]} */
function splitCsvLine(line) {
  line += ',';

  const items = [];
  let item = '';
  let inDq = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (
      c === '"' &&
      ((line[i + 1] === '"' && line[i + 2] === '"') || line[i + 1] !== '"')
    ) {
      inDq = !inDq;
    }

    if (!inDq && c === ',') {
      item = unwrapDq(item);
      item = item.replaceAll('""', '"');
      items.push(item);
      item = '';
      continue;
    }

    item += c;
  }

  return items;
}

/** @param {string} item @returns {string} */
function unwrapDq(item) {
  const s = item.at(0);
  const e = item.at(-1);
  if (s === '"' && e === '"') {
    return item.slice(1, -1);
  }

  return item;
}

/** @param {unknown[][]} matrix @returns {string[]} */
function getFormattedRows(matrix) {
  const formattedMatrix = [];
  for (const row of matrix) {
    const formattedRow = [];
    for (const item of row) {
      const formattedItem = getFormattedItem(item);
      formattedRow.push(formattedItem);
    }
    formattedMatrix.push(formattedRow.join(','));
  }

  return formattedMatrix;
}

/** @param {unknown} item @returns {string} */
function getFormattedItem(item) {
  if (typeof item === 'string') {
    return formatStringToCSV(item);
  }

  if (item === null || item === undefined) {
    return '';
  }

  if (item instanceof Date) {
    return formatStringToCSV(item.toISOString());
  }

  if (typeof item === 'object') {
    return JSON.stringify(item);
  }

  return String(item);
}

/** @param {string} item @returns {string} */
function formatStringToCSV(item) {
  let shouldDq = false;
  if (item.match(/^".*"$/)) {
    shouldDq = true;
    item = item.slice(1, -1);
  }

  if (item.match(/"/)) {
    shouldDq = true;
    item = item.replaceAll('"', '""');
  }

  if (item.match(/,|\s/)) {
    shouldDq = true;
  }

  if (shouldDq) {
    return '"' + item + '"';
  }

  return item;
}

module.exports = { parseCSV, generateCSV, splitCsvLine };
