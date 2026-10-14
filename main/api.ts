import {
  sendRustApiRequest,
  sendRustTelemetryRequest,
  type ApiRequestOptions,
} from './rustApiClient';

/** Thin Electron-side adapter; HTTPS execution and response parsing live in Rust. */
export function sendAPIRequest(endpoint: string, options?: ApiRequestOptions): Promise<unknown> {
  return sendRustApiRequest(endpoint, options);
}

/** Error telemetry has its own purpose and HTTPS policy; it cannot widen ERPNext IPC. */
export function sendTelemetryRequest(endpoint: string, options?: ApiRequestOptions): Promise<unknown> {
  return sendRustTelemetryRequest(endpoint, options);
}
