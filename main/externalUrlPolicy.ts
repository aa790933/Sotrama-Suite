/**
 * Parse and constrain renderer-requested external navigation before passing it
 * to Electron's shell. Credentials and non-web protocols are never accepted.
 */
export function normalizeExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 8192) {
    return null;
  }

  try {
    const url = new URL(input);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
