exports.closeRustApiClient = (...args) =>
  import('./rustApiClient.mjs').then(({ closeRustApiClient }) => closeRustApiClient(...args));
