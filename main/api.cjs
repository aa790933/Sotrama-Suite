exports.sendAPIRequest = (...args) =>
  import('./api.mjs').then(({ sendAPIRequest }) => sendAPIRequest(...args));
exports.sendTelemetryRequest = (...args) =>
  import('./api.mjs').then(({ sendTelemetryRequest }) => sendTelemetryRequest(...args));
