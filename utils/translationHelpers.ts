/** Properties of a schema which are to be translated, irrespective of nesting. */
export const schemaTranslateables = ['label', 'description', 'placeholder', 'section', 'tab'];

/**
 * Convert interpolated strings to indexed placeholders for translation catalogs.
 */
export function getIndexFormat(inp: unknown): string {
  let string: string | undefined;
  let snippets: string[] | undefined;
  if (typeof inp === 'string') string = inp;
  else if (Array.isArray(inp) && inp.every((part) => typeof part === 'string')) snippets = inp;
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

export function getSnippets(str: string): string[] {
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

export function getWhitespaceSanitized(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

export function getIndexList(str: string): number[] {
  return [...str.matchAll(/\${([^}]+)}/g)].map(([, index]) => parseInt(index, 10));
}
