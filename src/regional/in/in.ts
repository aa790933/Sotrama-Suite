import { Fyo } from 'fyo';
import { DuplicateEntryError } from 'fyo/utils/errors';

export type TaxType = 'GST' | 'IGST' | 'Exempt-GST' | 'Exempt-IGST';

export async function createIndianRecords(fyo: Fyo) {
  await createTaxes(fyo);
}

async function createTaxes(fyo: Fyo) {
  const GSTs = {
    GST: [28, 18, 12, 6, 5, 3, 0.25, 0],
    IGST: [28, 18, 12, 6, 5, 3, 0.25, 0],
    'Exempt-GST': [0],
    'Exempt-IGST': [0],
  };

  for (const type of Object.keys(GSTs)) {
    for (const percent of GSTs[type as TaxType]) {
      const name = `${type}-${percent}`;
      const details = getTaxDetails(type as TaxType, percent);

      if (await fyo.db.exists('Tax', name)) {
        continue;
      }

      const newTax = fyo.doc.getNewDoc('Tax', { name, details });
      try {
        await newTax.sync();
      } catch (error) {
        if (
          !(error instanceof DuplicateEntryError) ||
          !(await fyo.db.exists('Tax', name))
        ) {
          throw error;
        }
      }
    }
  }
}

function getTaxDetails(type: TaxType, percent: number) {
  if (type === 'GST') {
    return [
      {
        account: 'CGST',
        rate: percent / 2,
      },
      {
        account: 'SGST',
        rate: percent / 2,
      },
    ];
  }

  return [
    {
      account: type.toString().split('-')[0],
      rate: percent,
    },
  ];
}
