import { ModelNameEnum } from '../../models/types';
import type DatabaseCore from '../database/core';
import { getDefaultMetaFieldValueMap } from '../helpers';

const defaultUOMs = [
  {
    name: `Unit`,
    isWhole: true,
  },
  {
    name: `Kg`,
    isWhole: false,
  },
  {
    name: `Gram`,
    isWhole: false,
  },
  {
    name: `Meter`,
    isWhole: false,
  },
  {
    name: `Hour`,
    isWhole: false,
  },
  {
    name: `Day`,
    isWhole: false,
  },
];

async function execute(db: DatabaseCore) {
  for (const uom of defaultUOMs) {
    const defaults = getDefaultMetaFieldValueMap();
    await db.insert(ModelNameEnum.UOM, { ...uom, ...defaults });
  }
}

export default { execute };
