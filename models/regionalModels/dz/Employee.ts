import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';
import { Money } from 'pesa';
import { DateTime } from 'luxon';
import { SNMG_2026 } from './payroll';

export class Employee extends Doc {
  firstName?: string;
  lastName?: string;
  personalID?: string;
  nin?: string;
  dateOfBirth?: Date;
  hireDate?: Date;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  employmentType?: string;
  baseSalary?: Money;
  overtimeRate?: Money;
  cnasNumber?: string;
  bankDetails?: string;

  /**
   * Legal/statutory pre-checks. These are WARNINGS ONLY — they must never
   * block saving an Employee (exemptions such as part-time/apprentices exist
   * and are not modelled here). The framework exposes no non-blocking warning
   * channel, so — matching the precedent set by the SNMG check in payroll.ts —
   * warnings are emitted via console.warn and the save proceeds.
   */
  async validate() {
    await super.validate();

    const base = this.baseSalary?.float ?? 0;
    if (base > 0 && base < SNMG_2026) {
      // eslint-disable-next-line no-console
      console.warn(
        `[compliance] Employee ${
          this.name || ''
        }: base salary ${base} DZD is below the 2026 SNMG floor of ${SNMG_2026} DZD/month.`
      );
    }

    if (!this.cnasNumber && this.hireDate) {
      const daysSinceHire = Math.floor(
        DateTime.now().diff(DateTime.fromJSDate(this.hireDate), 'days').days
      );
      if (daysSinceHire > 10) {
        // eslint-disable-next-line no-console
        console.warn(
          `[compliance] Employee ${
            this.name || ''
          }: must be registered with CNAS within 10 days of hire; ${daysSinceHire} days elapsed and the CNAS number is still empty.`
        );
      }
    }
  }

  get fullName(): string {
    const parts = [this.firstName, this.lastName].filter(Boolean);
    return (parts.join(' ') || this.name) ?? '';
  }

  static getListViewSettings(): ListViewSettings {
    return {
      columns: ['name', 'firstName', 'lastName', 'department', 'baseSalary'],
    };
  }
}
