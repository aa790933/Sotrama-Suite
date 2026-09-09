import { DEFAULT_LANGUAGE } from 'fyo/utils/consts';
import { setLanguageMapOnTranslationString } from 'fyo/utils/translation';
import { fyo } from 'src/initFyo';
import { systemLanguageRef } from './refs';

// Language: Language Code in books/translations
export const languageCodeMap: Record<string, string> = {
  Arabic: 'ar',
  Catalan: 'ca-ES',
  Danish: 'da',
  Dutch: 'nl',
  English: 'en',
  French: 'fr',
  German: 'de',
  Gujarati: 'gu',
  Hindi: 'hi',
  Indonesian: 'id',
  Korean: 'ko',
  Nepali: 'np',
  Persian: 'fa',
  Portuguese: 'pt',
  'Simplified Chinese': 'zh-CN',
  'Traditional Chinese': 'zh-Hant',
  Spanish: 'es',
  Swedish: 'sv',
  Albanian: 'sq',
  Turkish: 'tr',
};

export async function setLanguageMap(
  initLanguage?: string,
  dontReload = false
) {
  const oldLanguage = fyo.config.get('language') as string;
  initLanguage ??= oldLanguage;
  const { code, language, usingDefault } = getLanguageCode(
    initLanguage,
    oldLanguage
  );

  let success = true;
  if (code === 'en') {
    setLanguageMapOnTranslationString(undefined);
    // Switching back to English must also reset schema labels when a
    // database is connected; otherwise French/etc. labels persist.
    // Pre-connect (renderer startup) there is nothing to reset.
    if (fyo.db.isConnected) {
      try {
        await fyo.db.translateSchemaMap(undefined);
      } catch {
        success = false;
      }
    }
  } else {
    success = await fetchAndSetLanguageMap(code);
  }

  if (success && !usingDefault) {
    fyo.config.set('language', language);
    systemLanguageRef.value = language;
  }

  if (!dontReload && success && initLanguage !== oldLanguage) {
    // Canonicalize the persisted route before the full window reload so
    // the restored navigation never contains a stale translated pageTitle
    // segment (routes are canonical/slug-based; i18n is visual only).
    try {
      const lastRoute = localStorage.getItem('lastRoute');
      if (lastRoute) {
        localStorage.setItem('lastRoute', canonicalizeRoute(lastRoute));
      }
    } catch {
      // localStorage may be unavailable; reload still proceeds.
    }
    ipc.reloadWindow();
  }
  return success;
}

/**
 * Strip the optional display-only `:pageTitle` segment from list routes.
 * `/list/Payment/Sales Payments` -> `/list/Payment`. All other routes pass
 * through unchanged. Keeps navigation canonical across language switches.
 */
export function canonicalizeRoute(fullPath: string): string {
  const [path, query] = fullPath.split('?');
  const segments = path.split('/');
  // ['', 'list', schemaName, pageTitle?, ...rest]
  if (segments.length >= 4 && segments[1] === 'list') {
    const canonical = segments.slice(0, 3).join('/');
    return query ? `${canonical}?${query}` : canonical;
  }
  return fullPath;
}

function getLanguageCode(initLanguage: string, oldLanguage: string) {
  let language = initLanguage ?? oldLanguage;
  let usingDefault = false;

  if (!language) {
    language = DEFAULT_LANGUAGE;
    usingDefault = true;
  }
  const code = languageCodeMap[language] ?? 'en';
  return { code, language, usingDefault };
}

async function fetchAndSetLanguageMap(code: string) {
  const { success, message, languageMap } = await ipc.getLanguageMap(code);

  if (!success) {
    const { showToast } = await import('src/utils/interactive');
    showToast({ type: 'error', message });
  } else {
    setLanguageMapOnTranslationString(languageMap);
    await fyo.db.translateSchemaMap(languageMap);
  }

  return success;
}
