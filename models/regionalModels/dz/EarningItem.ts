import { Doc } from 'fyo/model/doc';
import { Money } from 'pesa';
import { EarningType } from './salarySlipLogic';

export class EarningItem extends Doc {
  type?: EarningType;
  description?: string;
  amount?: Money;
  hours?: number;
  overtimeRate?: Money;
  restDayOrHoliday?: boolean;
}
