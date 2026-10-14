import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRustUtilityJson, runRustUtility } from './rustUtility.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Print-template file loading lives in Rust; this module only bridges Electron IPC. */
export async function getTemplates(posTemplateWidth) {
  if (posTemplateWidth !== undefined && !Number.isFinite(posTemplateWidth)) {
    throw new Error('POS template width must be a finite number');
  }

  const directory = resolveTemplatesDirectory();
  if (!directory) return [];

  const args = ['--print-templates', '--templates-dir', directory];
  if (posTemplateWidth !== undefined) {
    args.push('--pos-template-width', String(posTemplateWidth));
  }
  const templates = parseRustUtilityJson(await runRustUtility(args), 'print templates');
  if (!Array.isArray(templates)) {
    throw new Error('Rust utility returned an invalid print-template list');
  }
  return templates;
}

function resolveTemplatesDirectory() {
  const candidates = [
    process.resourcesPath ? path.resolve(process.resourcesPath, '../templates') : undefined,
    path.resolve(moduleDirectory, '../../templates'),
    path.resolve(process.cwd(), 'templates'),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}
