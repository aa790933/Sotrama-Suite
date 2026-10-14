/** Properties of a schema which are to be translated, irrespective of nesting. */
export const schemaTranslateables = ['label', 'description', 'placeholder', 'section', 'tab'];

/** Convert interpolated strings to indexed placeholders for translation catalogs.
 * @param {unknown} inp
 * @returns {string}
 */
export function getIndexFormat(inp) {
  let string;
  let snippets;
  if (typeof inp === 'string') string = inp;
  else if (Array.isArray(inp)) snippets = inp;
  else throw new Error(`invalid input ${String(inp)} of type ${typeof inp}`);
  if (snippets === undefined) snippets = getSnippets(string);
  if (snippets.length === 1) return snippets[0];
  let str = '';
  snippets.forEach((snippet, index) => {
    if (index === snippets.length - 1) str += snippet;
    else str += snippet + '${' + String(index) + '}';
  });
  return str;
}

/** @param {string} str @returns {string[]} */
export function getSnippets(str) {
  let start = 0;
  const snippets = [...str.matchAll(/\${[^}]+}/g)].map((match) => {
    const end = match.index;
    if (end === undefined) return '';
    const snippet = str.slice(start, end);
    start = end + match[0].length;
    return snippet;
  });
  snippets.push(str.slice(start));
  return snippets;
}

/** @param {string} str @returns {string} */
export function getWhitespaceSanitized(str) {
  return str.replace(/\s+/g, ' ').trim();
}

/** @param {string} str @returns {number[]} */
export function getIndexList(str) {
  return [...str.matchAll(/\${([^}]+)}/g)].map(([, index]) => parseInt(index));
}
