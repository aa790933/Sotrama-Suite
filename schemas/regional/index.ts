import { SchemaStub } from 'schemas/types';
import IndianSchemas from './in';
import SwissSchemas from './ch';
import AlgerianSchemas from './dz';

/**
 * Regional Schemas are exported by country code.
 */
export default {
  in: IndianSchemas,
  ch: SwissSchemas,
  dz: AlgerianSchemas,
} as Record<string, SchemaStub[]>;
