import { sendRustApiRequest, sendRustTelemetryRequest } from './rustApiClient.mjs';

/** Thin Electron-side adapter; HTTPS execution and response parsing live in Rust. */
export function sendAPIRequest(endpoint, options) {
  return sendRustApiRequest(endpoint, options);
}

/** Error telemetry has its own purpose and HTTPS policy; it cannot widen ERPNext IPC. */
export function sendTelemetryRequest(endpoint, options) {
  return sendRustTelemetryRequest(endpoint, options);
}
