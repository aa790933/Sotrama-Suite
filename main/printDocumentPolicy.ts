const MAX_HTML_BYTES = 16 * 1024 * 1024;
const MAX_WIDTH_CM = 200;
const MAX_HEIGHT_CM = 500;

export function validatePrintDocumentInput(
  html: unknown,
  width: unknown,
  height: unknown
): void {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('Print document HTML is invalid or exceeds the 16 MiB limit');
  }
  if (
    typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > MAX_WIDTH_CM ||
    typeof height !== 'number' || !Number.isFinite(height) || height <= 0 || height > MAX_HEIGHT_CM
  ) {
    throw new Error('Print document dimensions are outside the supported range');
  }
}
