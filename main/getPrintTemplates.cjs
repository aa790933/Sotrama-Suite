exports.getTemplates = (...args) =>
  import('./getPrintTemplates.mjs').then(({ getTemplates }) => getTemplates(...args));
