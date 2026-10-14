import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { Creds } from 'utils/types';
import { rendererLog } from './helpers';
import type { Main } from 'main';

export function getUrlAndTokenString(): Creds {
  const inProduction = app.isPackaged;
  const empty: Creds = { errorLogUrl: '', telemetryUrl: '', tokenString: '' };
  let errLogCredsPath = path.join(
    process.resourcesPath,
    '../creds/log_creds.txt'
  );
  if (!fs.existsSync(errLogCredsPath)) {
    errLogCredsPath = path.join(__dirname, '..', '..', 'log_creds.txt');
  }

  if (!fs.existsSync(errLogCredsPath)) {
    // eslint-disable-next-line no-console
    !inProduction && console.log(`${errLogCredsPath} doesn't exist, can't log`);
    return empty;
  }

  let apiKey, apiSecret, errorLogUrl, telemetryUrl;
  try {
    [apiKey, apiSecret, errorLogUrl, telemetryUrl] = fs
      .readFileSync(errLogCredsPath, 'utf-8')
      .split('\n')
      .filter((f) => f.length);
  } catch (err) {
    if (!inProduction) {
      // eslint-disable-next-line no-console
      console.log(`logging error using creds at: ${errLogCredsPath} failed`);
      // eslint-disable-next-line no-console
      console.log(err);
    }
    return empty;
  }

  if (!errorLogUrl || !telemetryUrl || !apiKey || !apiSecret) {
    !inProduction &&
      // eslint-disable-next-line no-console
      console.log('incomplete telemetry creds, skipping logging');
    return empty;
  }

  return {
    errorLogUrl: encodeURI(errorLogUrl),
    telemetryUrl: encodeURI(telemetryUrl),
    tokenString: `token ${apiKey}:${apiSecret}`,
  };
}

export async function sendError(body: string, main: Main) {
  const { errorLogUrl, tokenString } = getUrlAndTokenString();
  if (!errorLogUrl || !tokenString) return;
  const headers = {
    Authorization: tokenString,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const apiBridge = require('./api.cjs') as unknown as {
      sendTelemetryRequest: (
        endpoint: string,
        options: { method: 'POST'; headers: Record<string, string>; body: string }
      ) => Promise<unknown>;
    };
    await apiBridge.sendTelemetryRequest(errorLogUrl, { method: 'POST', headers, body });
  } catch {
    rendererLog(main, new Error('Could not send error telemetry through Rust HTTPS service'));
  }
}
