export function setDarkMode(darkMode: boolean): void {
  const root = document.documentElement;

  if (darkMode) {
    root.classList.add('dark', 'custom-scroll', 'custom-scroll-thumb1');
    root.style.colorScheme = 'dark';
    return;
  }

  // Remove every dark-only class together so light mode restores its own
  // scrollbar palette instead of retaining dark scrollbar styles.
  root.classList.remove('dark', 'custom-scroll', 'custom-scroll-thumb1');
  root.style.colorScheme = 'light';
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
