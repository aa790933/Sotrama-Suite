export function setDarkMode(darkMode: boolean): void {
  if (darkMode) {
    document.documentElement.classList.add(
      'dark',
      'custom-scroll',
      'custom-scroll-thumb1'
    );
    return;
  }
  document.documentElement.classList.remove('dark');
}

const FONT_SIZE_OPTIONS = [14, 15, 16, 18, 20] as const;
export type AppFontSize = (typeof FONT_SIZE_OPTIONS)[number];

/** Apply a validated, app-wide font size preference. */
export function setAppFontSize(value: unknown): AppFontSize {
  const fontSize = Number(value);
  const safeFontSize = FONT_SIZE_OPTIONS.includes(fontSize as AppFontSize)
    ? (fontSize as AppFontSize)
    : 14;

  document.documentElement.style.fontSize = `${safeFontSize}px`;
  return safeFontSize;
}
