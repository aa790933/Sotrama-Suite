exports.getLanguageMap = (...args) =>
  import('./getLanguageMap.mjs').then(({ getLanguageMap }) => getLanguageMap(...args));
